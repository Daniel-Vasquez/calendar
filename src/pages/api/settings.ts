import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getSettings } from '../../lib/mongo';
import { sanitizePrefs, type WirePrefs } from '../../lib/prefs';

export const prerender = false;

/**
 * Las preferencias de quien ha entrado: la paleta y el catálogo de etiquetas.
 *
 * Va aparte de `/api/telegram` aunque las dos cosas vivan en el mismo documento
 * de `settings`, y es a propósito: aquello vincula un chat —un flujo con
 * códigos, caducidad y llamadas a Telegram— y esto guarda dos campos. Meterlos
 * en la misma ruta obligaría a un `action` en el cuerpo y a que un fallo de
 * Telegram pudiera tumbar el guardado de una paleta.
 *
 * Lo que **no** está aquí son las etiquetas que lleva puestas un día: esas son
 * contenido del día y viajan con él, por `/api/days`. Ver `tags.ts`.
 */

function ownerOf(locals: App.Locals): ObjectId | null {
  const id = locals.user?.id;
  return id && ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Lo que la cuenta sabe. Sin nada guardado devuelve `prefsAt: 0`, que es lo que
 * el navegador lee como «el servidor no opina» y hace ganar a lo de aquí.
 */
export const GET: APIRoute = async ({ locals }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  try {
    const settings = await getSettings();
    const doc = await settings.findOne(
      { userId },
      { projection: { _id: 0, palette: 1, tags: 1, prefsAt: 1 } },
    );

    return json(200, {
      ...(doc?.palette ? { palette: doc.palette } : {}),
      // `Array.isArray` y no «si es verdadero»: un catálogo vacío a propósito
      // tiene que viajar como `[]`, no desaparecer del cuerpo.
      ...(Array.isArray(doc?.tags) ? { tags: doc.tags } : {}),
      prefsAt: doc?.prefsAt ?? 0,
    } satisfies WirePrefs);
  } catch (error) {
    console.error('[settings] no se pudieron leer las preferencias:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

/**
 * Guarda las preferencias, si lo que llega es más reciente que lo guardado.
 *
 * **Solo se escribe lo que venga.** Un campo ausente significa «de esto no
 * opino» y deja intacto lo que hubiera, que es justo al revés que en
 * `/api/days`, donde un opcional ausente se borra. La diferencia no es un
 * descuido: allí el navegador manda siempre el día entero, así que una ausencia
 * solo puede querer decir que se ha quitado; aquí un dispositivo puede tener
 * paleta y no haber guardado nunca un catálogo, y borrar por eso el catálogo de
 * la cuenta sería perder lo que alguien escribió en otro sitio.
 */
export const PUT: APIRoute = async ({ locals, request }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'El cuerpo no es JSON válido' });
  }

  const prefs = sanitizePrefs(payload);
  if (!prefs) return json(400, { error: 'Preferencias no reconocibles' });

  const fields: Record<string, unknown> = { userId, prefsAt: prefs.prefsAt, updatedAt: Date.now() };
  if (prefs.palette) fields.palette = prefs.palette;
  if (prefs.tags) fields.tags = prefs.tags;

  try {
    const settings = await getSettings();

    /*
     * El filtro es la mitad del mecanismo, igual que en `/api/days`: si lo
     * guardado es igual de reciente o más, no encaja y no se escribe nada. El
     * `$or` está porque un documento puede existir ya —lo crea la vinculación
     * de Telegram— sin haber tenido nunca preferencias.
     */
    const result = await settings.updateOne(
      { userId, $or: [{ prefsAt: { $exists: false } }, { prefsAt: { $lt: prefs.prefsAt } }] },
      { $set: fields },
      { upsert: true },
    );

    const applied = result.modifiedCount + result.upsertedCount;
    return json(200, { applied });
  } catch (error) {
    // El filtro que descarta lo viejo hace que el `upsert` intente insertar un
    // duplicado, y el índice único lo rechaza con E11000. Eso *es* el resultado
    // esperado —el servidor ya tenía algo más reciente—, así que se cuenta como
    // descartado en vez de tratarse como avería. Mismo caso que en `days.ts`.
    if ((error as { code?: number })?.code === 11000) return json(200, { applied: 0 });

    console.error('[settings] no se pudieron guardar las preferencias:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};
