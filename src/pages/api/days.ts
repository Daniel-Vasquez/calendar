import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getDays } from '../../lib/mongo';
import { MAX_DAYS_PER_REQUEST, sanitizeWireDay, type WireDay } from '../../lib/wire';

export const prerender = false;

/**
 * Los días del usuario que ha entrado. Nunca se acepta un identificador que
 * venga del cliente: el único que cuenta es el de la sesión.
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
 * Todo lo que el servidor sabe de este usuario, lápidas incluidas: el
 * navegador las necesita para saber qué borrar, y sin ellas un día eliminado
 * en otro dispositivo volvería a aparecer.
 */
export const GET: APIRoute = async ({ locals }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  try {
    const days = await getDays();
    const found = await days
      .find({ userId }, { projection: { _id: 0, userId: 0 } })
      .toArray();

    return json(200, { days: found });
  } catch (error) {
    console.error('[days] no se pudieron leer:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

/**
 * Sube un lote de días. Cada uno se acepta solo si su marca de tiempo es más
 * reciente que la guardada: dos dispositivos que escriben el mismo día no se
 * pisan por orden de llegada, sino por orden de edición.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'El cuerpo no es JSON válido' });
  }

  const raw = (payload as { days?: unknown })?.days;
  if (!Array.isArray(raw)) return json(400, { error: 'Falta la lista `days`' });
  if (raw.length === 0) return json(200, { applied: 0, skipped: 0 });
  if (raw.length > MAX_DAYS_PER_REQUEST) {
    return json(413, { error: `Máximo ${MAX_DAYS_PER_REQUEST} días por petición` });
  }

  // Lo que no se entienda se descarta aquí, no a mitad de la escritura.
  const clean: WireDay[] = [];
  for (const value of raw) {
    const day = sanitizeWireDay(value);
    if (day) clean.push(day);
  }
  if (clean.length === 0) return json(400, { error: 'Ningún día reconocible' });

  const operations = clean.map((day) => {
    // `$set` solo escribe los campos que vienen, así que un opcional que ha
    // *desaparecido* seguiría en el documento: apagar el recordatorio en el
    // portátil dejaría el suyo intacto en la base, y el móvil se lo bajaría de
    // vuelta en la siguiente lectura. Un campo ausente se borra a propósito.
    const gone: Record<string, ''> = {};
    if (!day.reminder) gone.reminder = '';
    if (!day.thumb) gone.thumb = '';

    return {
      updateOne: {
        // El filtro es la mitad del mecanismo: si lo guardado es igual de
        // reciente o más, no encaja y no se escribe nada.
        filter: { userId, key: day.key, updatedAt: { $lt: day.updatedAt } },
        // El `$unset` solo va si tiene algo que borrar: Mongo rechaza un
        // operador de actualización vacío, y un día con aviso y miniatura no
        // deja nada que quitar.
        update: {
          $set: { ...day, userId },
          ...(Object.keys(gone).length ? { $unset: gone } : {}),
        },
        upsert: true,
      },
    };
  });

  try {
    const days = await getDays();
    // Sin orden: un día rechazado no debe frenar a los que vienen detrás.
    const result = await days.bulkWrite(operations, { ordered: false });
    const applied = result.modifiedCount + result.upsertedCount;
    return json(200, { applied, skipped: clean.length - applied });
  } catch (error) {
    // El filtro que descarta lo viejo hace que el `upsert` intente insertar un
    // duplicado, y el índice único lo rechaza con E11000. Eso *es* el
    // resultado esperado —el servidor ya tenía algo mejor—, así que se cuenta
    // como descartado en vez de tratarse como avería.
    const failures = errorsOf(error);
    if (failures.length && failures.every((code) => code === 11000)) {
      const applied = appliedOf(error);
      return json(200, { applied, skipped: clean.length - applied });
    }

    console.error('[days] no se pudieron guardar:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

/** Códigos de los errores individuales de un `bulkWrite` sin orden. */
function errorsOf(error: unknown): number[] {
  const errors = (error as { writeErrors?: { code?: number }[] })?.writeErrors;
  if (!Array.isArray(errors)) return [];
  return errors.map((entry) => entry?.code ?? 0);
}

/** Cuántas escrituras sí salieron adelante pese al error parcial. */
function appliedOf(error: unknown): number {
  const result = (error as { result?: { nModified?: number; nUpserted?: number } })?.result;
  return (result?.nModified ?? 0) + (result?.nUpserted ?? 0);
}
