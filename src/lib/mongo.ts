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
  try {
    await cache.daysIndex;
  } catch (error) {
    cache.daysIndex = null;
    throw error;
  }
  return days;
}
