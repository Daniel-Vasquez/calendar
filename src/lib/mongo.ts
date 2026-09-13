import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { WireDay } from './wire';
import { MONGODB_DB, MONGODB_URI } from 'astro:env/server';

/** Base que se usa cuando ni la variable ni la URI dicen cuál. */
const DEFAULT_DB = 'planificador';

/**
 * Nombre de la base, por orden de preferencia: la variable explícita, la que
 * venga en la ruta de la URI y, si ninguna lo dice, `DEFAULT_DB`.
 *
 * El driver, llamado sin nombre, cae en `test` cuando la URI no trae ninguno.
 * Es un fallo silencioso de los caros: todo parece funcionar y los datos
 * acaban en una base que nadie mira.
 */
function databaseName(uri: string): string {
  if (MONGODB_DB) return MONGODB_DB;
  try {
    const path = new URL(uri).pathname.replace(/^\//, '');
    if (path) return decodeURIComponent(path);
  } catch {
    /* URI con una forma rara: mejor un nombre conocido que `test`. */
  }
  return DEFAULT_DB;
}

type MongoCache = {
  client: MongoClient | null;
  db: Db | null;
  /** Conexión en curso. Ver `connect`. */
  connecting: Promise<MongoClient> | null;
  /** Creación del índice de `days`. Ver `getDays`. */
  daysIndex: Promise<unknown> | null;
  /** Creación del índice de `images`. Ver `getImages`. */
  imagesIndex: Promise<unknown> | null;
  /** Creación del índice de `settings`. Ver `getSettings`. */
  settingsIndex: Promise<unknown> | null;
  /** Creación del índice por hora de aviso. Ver `getDays`. */
  remindersIndex: Promise<unknown> | null;
  /** Creación del índice de `allowlist`. Ver `getAllowlist`. */
  allowlistIndex: Promise<unknown> | null;
};

/**
 * El cliente vive en `globalThis` a propósito.
 *
 * Una función de Vercel puede reutilizar el proceso entre invocaciones o
 * arrancar uno nuevo, y crear un `MongoClient` por petición agota el límite de
 * conexiones de Atlas en cuanto hay algo de tráfico. Guardarlo aquí lo hace
 * sobrevivir a las invocaciones calientes, y de paso al recargado en caliente
 * de `astro dev`, que si no dejaría un cliente huérfano en cada guardado.
 */
const globalForMongo = globalThis as typeof globalThis & { __planificadorMongo?: MongoCache };
const cache: MongoCache = (globalForMongo.__planificadorMongo ??= {
  client: null,
  db: null,
  connecting: null,
  daysIndex: null,
  imagesIndex: null,
  settingsIndex: null,
  remindersIndex: null,
  allowlistIndex: null,
});

/**
 * El constructor no abre ninguna conexión —eso ocurre en la primera operación,
 * o antes si se llama a `connect`—, así que esto es seguro en el momento de
 * cargar el módulo. Better Auth necesita su `Db` justo así, sin poder esperar.
 */
export function getClient(): MongoClient {
  return (cache.client ??= new MongoClient(MONGODB_URI, {
    // Una función serverless atiende una petición cada vez: un pool grande
    // solo sirve para consumir la cuota de conexiones del clúster.
    maxPoolSize: 10,
    // El valor de fábrica son 30 s, más de lo que dura la propia función en
    // el plan Hobby. Antes que agotar el tiempo sin decir nada, conviene
    // fallar a tiempo y poder devolver un error con sentido.
    serverSelectionTimeoutMS: 8000,
  }));
}

export function getDb(): Db {
  return (cache.db ??= getClient().db(databaseName(MONGODB_URI)));
}

/**
 * Fuerza la conexión y la comparte. Solo hace falta cuando quieres *saber* que
 * Atlas responde —el diagnóstico de `/api/health`—; para operar basta `getDb`,
 * que conecta sola al primer uso.
 */
export async function connect(): Promise<Db> {
  const client = getClient();

  // Se cachea la promesa, no solo el cliente: en un arranque en frío dos
  // peticiones simultáneas dispararían dos conexiones a la vez.
  cache.connecting ??= client.connect();

  try {
    await cache.connecting;
  } catch (error) {
    // Sin esto, un fallo puntual dejaría una promesa rechazada en la caché y
    // todas las peticiones siguientes heredarían ese mismo error para siempre.
    cache.connecting = null;
    throw error;
  }

  return getDb();
}

/** Nombre de la base a la que se está apuntando, para diagnósticos. */
export function currentDatabaseName(): string {
  return databaseName(MONGODB_URI);
}

/** Un día tal y como se guarda: el formato de la red, más de quién es. */
export type DayDoc = WireDay & { userId: ObjectId };

/**
 * La colección de días, con su índice garantizado.
 *
 * El índice único sobre `{userId, key}` no es solo para buscar rápido: es lo
 * que impide que existan dos versiones del mismo día, y de lo que se sirve la
 * escritura para descartar una subida vieja sin tener que leer antes.
 *
 * `createIndex` es idempotente, y la promesa cacheada hace que el viaje ocurra
 * una vez por proceso y no en cada petición.
 */
export async function getDays(): Promise<Collection<DayDoc>> {
  const days = getDb().collection<DayDoc>('days');
  cache.daysIndex ??= days.createIndex({ userId: 1, key: 1 }, { unique: true });

  // El cron pregunta por hora de aviso y no por usuario, que es al revés que
  // todo lo demás: sin este índice recorrería todos los días de todo el mundo
  // en cada pasada. Parcial porque la inmensa mayoría no llevan recordatorio,
  // y el índice solo tiene que conocer a los que sí.
  cache.remindersIndex ??= days.createIndex(
    { 'reminder.at': 1 },
    { partialFilterExpression: { 'reminder.at': { $exists: true } } },
  );

  try {
    await Promise.all([cache.daysIndex, cache.remindersIndex]);
  } catch (error) {
    cache.daysIndex = null;
    cache.remindersIndex = null;
    throw error;
  }
  return days;
}

/**
 * Una imagen adjunta. Vive fuera del día a propósito: seis adjuntos son más de
 * cuatro megas de data URL, y con ellos dentro el documento del día dejaría de
 * poder bajarse con el resto del año.
 */
export type ImageDoc = {
  userId: ObjectId;
  key: string;
  /** Posición dentro de la nota, desde cero. */
  index: number;
  dataUrl: string;
  updatedAt: number;
};

/**
 * Ajustes de una persona que no son preferencias de un dispositivo.
 *
 * El `chatId` de Telegram vive aquí y no en `localStorage` porque es el destino
 * de una alerta que manda el servidor: el navegador ni la manda ni tiene por
 * qué saberlo. El token del bot **no** está aquí — es de la aplicación, vive en
 * el entorno, y una filtración de la base no debe ser también una del bot.
 */
export type SettingsDoc = {
  userId: ObjectId;
  telegram?: {
    /** A dónde se manda. Ausente mientras no se haya vinculado. */
    chatId?: number;
    /** Cómo llamar al chat al enseñarlo en los ajustes. */
    name?: string;
    linkedAt?: number;
    /** Vinculación a medias: el código que se metió en el enlace `?start=`. */
    pending?: { code: string; createdAt: number };
    /**
     * Cuándo contestó Telegram que el bot está bloqueado. Mientras esté puesto
     * no se insiste: sin esto, cada pasada del cron volvería a intentarlo con
     * alguien que ya dijo que no.
     */
    blockedAt?: number;
  };
  updatedAt: number;
};

/** Los ajustes del usuario, con su índice garantizado. Uno por persona. */
export async function getSettings(): Promise<Collection<SettingsDoc>> {
  const settings = getDb().collection<SettingsDoc>('settings');
  cache.settingsIndex ??= settings.createIndex({ userId: 1 }, { unique: true });
  try {
    await cache.settingsIndex;
  } catch (error) {
    cache.settingsIndex = null;
    throw error;
  }
  return settings;
}

/**
 * Quién puede crearse una cuenta.
 *
 * Vive en Mongo y no en una variable de entorno por una razón práctica: el
 * panel de Vercel no enseña el valor actual al editar, así que cambiar una
 * lista allí es escribir a ciegas y borrar de un tecleo a quien no recordabas.
 * Aquí se lee siempre, se cambia sin desplegar, y no es un secreto — saber qué
 * correos pueden registrarse no le abre la puerta a nadie: sigue haciendo falta
 * la contraseña.
 *
 * Solo mira a quien **se da de alta**. Quien ya tiene cuenta entra igual, esté
 * o no en la lista.
 */
export type AllowlistDoc = {
  /** En minúsculas y sin espacios; es también la clave única. */
  email: string;
  /** Para poder distinguir después quién invitó a quién, o cuándo. */
  note?: string;
  addedAt: number;
};

/** La lista de invitados, con su índice garantizado. */
export async function getAllowlist(): Promise<Collection<AllowlistDoc>> {
  const allowlist = getDb().collection<AllowlistDoc>('allowlist');
  cache.allowlistIndex ??= allowlist.createIndex({ email: 1 }, { unique: true });
  try {
    await cache.allowlistIndex;
  } catch (error) {
    cache.allowlistIndex = null;
    throw error;
  }
  return allowlist;
}

/** Normaliza un correo para guardarlo y para compararlo. Siempre el mismo. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** La colección de imágenes, con su índice garantizado. */
export async function getImages(): Promise<Collection<ImageDoc>> {
  const images = getDb().collection<ImageDoc>('images');
  cache.imagesIndex ??= images.createIndex({ userId: 1, key: 1, index: 1 }, { unique: true });
  try {
    await cache.imagesIndex;
  } catch (error) {
    cache.imagesIndex = null;
    throw error;
  }
  return images;
}
