import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { ColorPalette } from './palette';
import type { Tag } from './tags';
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
  //
  // Desde la tanda 9 `reminders` es una lista, así que este índice es
  // **multiclave**: un día con tres avisos aporta tres entradas. Sigue siendo
  // parcial, y por serlo el cron tiene que pedir la ventana **también** en
  // notación de punto para que el planificador lo dé por elegible; está
  // explicado donde se consulta, en `api/cron/reminders.ts`. El de antes,
  // `reminder.at_1`, lo borra la migración: ya no lo usa nadie y solo cuesta
  // escrituras.
  cache.remindersIndex ??= days.createIndex(
    { 'reminders.at': 1 },
    { partialFilterExpression: { 'reminders.at': { $exists: true } } },
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
 * Una imagen adjunta. Desde la tanda 8 **aquí no hay bytes**: los guarda
 * Cloudinary y esto es solo el metadato que dice cuál es y dónde está.
 *
 * Vivía ya fuera del día porque seis adjuntos eran más de cuatro megas de data
 * URL; ahora seguiría cabiendo, pero se queda fuera igual: el día lo bajan
 * enteros los 366 documentos del año y esto solo se lee al abrir una nota.
 */
export type ImageDoc = {
  userId: ObjectId;
  key: string;
  /** Posición dentro de la nota, desde cero. Es también parte del `publicId`. */
  index: number;
  /**
   * `{CLOUDINARY_FOLDER}/{userId}/{key}/{index}`. Ver `publicIdFor` en
   * `cloudinary.ts`. Se guarda entero y no se recalcula al leer: así una
   * imagen subida bajo otra carpeta se sigue sirviendo mientras no se mueva.
   */
  publicId: string;
  /** La versión que devolvió Cloudinary. Hace falta para firmar la URL. */
  version: number;
  /**
   * Hash del contenido. Es lo que va al navegador dentro de la referencia y de
   * lo que vive la caché del proxy: otros bytes, otra URL. Ver `makeRef`.
   */
  etag: string;
  /** `jpg`, `png` o `webp`. Hace falta para construir la URL firmada. */
  format: string;
  bytes: number;
  width: number;
  height: number;
  updatedAt: number;
};

/**
 * Ajustes de una persona que no son preferencias de un dispositivo.
 *
 * El `chatId` de Telegram vive aquí y no en `localStorage` porque es el destino
 * de una alerta que manda el servidor: el navegador ni la manda ni tiene por
 * qué saberlo. El token del bot **no** está aquí — es de la aplicación, vive en
 * el entorno, y una filtración de la base no debe ser también una del bot.
 *
 * Desde la tanda 11 comparten documento la paleta y el catálogo de etiquetas,
 * que son de la persona y no del aparato desde el que se escriben. Van con su
 * **propia** marca de tiempo, `prefsAt`, y no con `updatedAt`: ver abajo.
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
  /**
   * Cómo llama esta persona a cada categoría y de qué tono la quiere. Solo lo
   * retocado; lo demás sale de fábrica. Ver `palette.ts`.
   */
  palette?: ColorPalette;
  /**
   * El catálogo de etiquetas.
   *
   * **Ausente y `[]` no son lo mismo.** Ausente es que nadie ha elegido nunca
   * un catálogo, y entonces manda el de fábrica; `[]` es un catálogo vacío a
   * propósito, que es una respuesta legítima y que hay que respetar, o las
   * siete de fábrica resucitarían en cuanto alguien las borrara todas.
   */
  tags?: Tag[];
  /**
   * Cuándo se tocaron las preferencias, por el reloj de quien las tocó. Es el
   * árbitro de su fusión.
   *
   * Va aparte de `updatedAt` y no en su lugar, y la razón es la misma que
   * separa `sent` de `done` en un recordatorio: son dos cosas con dos autores.
   * `updatedAt` lo sube también el servidor —al marcar el bot como bloqueado,
   * por ejemplo—, y si fuera el árbitro, un bloqueo de Telegram haría que las
   * preferencias del servidor le ganaran a una edición local que aún no hubiera
   * subido, borrándola.
   */
  prefsAt?: number;
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
