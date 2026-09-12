import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getImages } from '../../lib/mongo';
import { isImageDataUrl, MAX_IMAGES_PER_DAY } from '../../lib/image';
import { isDateKey } from '../../lib/wire';

export const prerender = false;

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

/** Las imágenes de un día, en orden. Se piden al abrir la nota o la galería. */
export const GET: APIRoute = async ({ locals, url }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  const key = url.searchParams.get('key');
  if (!isDateKey(key)) return json(400, { error: 'Falta una clave de día válida' });

  try {
    const images = await getImages();
    const found = await images
      .find({ userId, key }, { projection: { _id: 0, dataUrl: 1, index: 1 } })
      .sort({ index: 1 })
      .toArray();

    return json(200, { key, images: found.map((image) => image.dataUrl) });
  } catch (error) {
    console.error('[images] no se pudieron leer:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

/**
 * Sube una imagen suelta, no el conjunto del día.
 *
 * Seis adjuntos rondan los cuatro megas, y el cuerpo de una función de Vercel
 * tiene un tope de 4,5 MB: mandarlos juntos quedaría al filo de fallar. De una
 * en una nunca se pasa de los setecientos kilobytes.
 */
export const PUT: APIRoute = async ({ locals, request }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'El cuerpo no es JSON válido' });
  }

  const { key, index, dataUrl, updatedAt } = payload;
  if (!isDateKey(key)) return json(400, { error: 'Clave de día no válida' });
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_IMAGES_PER_DAY) {
    return json(400, { error: 'Posición fuera de rango' });
  }
  // Solo se acepta lo que el propio navegador podría haber generado: la misma
  // comprobación que guarda la puerta de localStorage.
  if (!isImageDataUrl(dataUrl)) return json(400, { error: 'La imagen no tiene un formato admitido' });
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    return json(400, { error: 'Falta la marca de tiempo' });
  }

  try {
    const images = await getImages();
    await images.updateOne(
      { userId, key, index },
      { $set: { userId, key, index, dataUrl, updatedAt } },
      { upsert: true },
    );
    return json(200, { ok: true });
  } catch (error) {
    console.error('[images] no se pudo guardar:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

/**
 * Recorta la cola de un día: borra de `from` en adelante. Es lo que deja el
 * conjunto del servidor igual que el de aquí cuando se quitan adjuntos, y con
 * `from=0` vacía el día entero.
 */
export const DELETE: APIRoute = async ({ locals, url }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  const key = url.searchParams.get('key');
  if (!isDateKey(key)) return json(400, { error: 'Falta una clave de día válida' });

  const from = Number(url.searchParams.get('from') ?? '0');
  if (!Number.isInteger(from) || from < 0) return json(400, { error: 'Posición no válida' });

  try {
    const images = await getImages();
    const result = await images.deleteMany({ userId, key, index: { $gte: from } });
    return json(200, { deleted: result.deletedCount });
  } catch (error) {
    console.error('[images] no se pudieron borrar:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};
