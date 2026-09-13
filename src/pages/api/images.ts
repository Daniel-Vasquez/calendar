import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getImages } from '../../lib/mongo';
import {
  isImageDataUrl,
  isImageRef,
  makeRef,
  MAX_IMAGES_PER_DAY,
  publicIdOf,
} from '../../lib/image';
import {
  destroyImage,
  publicIdFor,
  renameImage,
  uploadImage,
  type StoredImage,
} from '../../lib/cloudinary';
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

/**
 * Las imágenes de un día, en orden. Se piden al abrir la nota o la galería.
 *
 * Bajan **referencias, no bytes**: `cld:{publicId}@{version}`. Con ellas el
 * navegador sabe qué pedirle al proxy y cuándo su copia cacheada ha quedado
 * vieja, y la respuesta pasa de megas a unos cientos de bytes.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  const key = url.searchParams.get('key');
  if (!isDateKey(key)) return json(400, { error: 'Falta una clave de día válida' });

  try {
    const images = await getImages();
    const found = await images
      .find({ userId, key }, { projection: { _id: 0, publicId: 1, etag: 1, version: 1, index: 1 } })
      .sort({ index: 1 })
      .toArray();

    return json(200, {
      key,
      images: found
        /*
         * Sin `publicId` no hay nada que servir: es un documento que se quedó
         * sin migrar y del que solo queda el metadato. Se omite en vez de
         * mandar una referencia que no apunta a ninguna parte, y así el día se
         * comporta como el de un dispositivo al que aún no le han llegado las
         * imágenes —que es exactamente lo que pasa— en lugar de enseñar un
         * hueco roto.
         */
        .filter((image) => image.publicId)
        // El `etag` puede faltar en las que subieron antes de que la
        // referencia lo llevara. La versión sirve de testigo mientras tanto:
        // no distingue contenidos, pero el proxy ya se guarda de eso.
        .map((image) => makeRef(image.publicId, image.etag ?? String(image.version))),
    });
  } catch (error) {
    console.error('[images] no se pudieron leer:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

/**
 * Coloca una imagen en una posición del día. Una sola, no el conjunto.
 *
 * Llega de dos formas y las dos son legítimas:
 *
 * - `dataUrl`, una imagen recién elegida en el navegador. Sube a Cloudinary.
 *   El contrato no ha cambiado con la tanda 8 —el cargador acepta la data URI
 *   tal cual—, así que `flushImages` manda lo mismo que mandaba a Mongo.
 * - `ref`, una que **ya estaba subida** y ahora ocupa otro sitio. Pasa al
 *   quitar un adjunto que no era el último: los de detrás corren una posición,
 *   y como el nombre lleva el índice dentro hay que moverla. El navegador no
 *   puede volver a subirla —soltó los bytes al confirmarse la subida—, así que
 *   manda la referencia y aquí se renombra.
 *
 * Se sigue subiendo de una en una y no el día entero: seis adjuntos rondan los
 * cuatro megas y el cuerpo de una función de Vercel tiene un tope de 4,5 MB.
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

  const { key, index, dataUrl, ref, updatedAt } = payload;
  if (!isDateKey(key)) return json(400, { error: 'Clave de día no válida' });
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_IMAGES_PER_DAY) {
    return json(400, { error: 'Posición fuera de rango' });
  }
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    return json(400, { error: 'Falta la marca de tiempo' });
  }
  // Una cosa o la otra, nunca las dos ni ninguna.
  const moving = dataUrl === undefined;
  // Solo se acepta lo que el propio navegador podría haber generado: la misma
  // comprobación que guardaba la puerta de localStorage.
  if (!moving && !isImageDataUrl(dataUrl)) {
    return json(400, { error: 'La imagen no tiene un formato admitido' });
  }
  if (moving && !isImageRef(ref)) return json(400, { error: 'Falta la imagen' });

  // El destino no se negocia: sale de la sesión y de la posición, nunca del
  // cuerpo de la petición.
  const owner = userId.toHexString();
  const target = publicIdFor(owner, key, index);

  try {
    const images = await getImages();

    /** Lo que se guarda y lo que se devuelve, sea cual sea el camino. */
    const write = async (stored: StoredImage) => {
      await images.updateOne(
        { userId, key, index },
        {
          $set: { userId, key, index, ...stored, updatedAt },
          // El `dataUrl` de antes de la tanda 8, si lo hubiera. Sin esto, una
          // imagen que ya está en Cloudinary seguiría arrastrando su copia en
          // base64 dentro de Mongo, que es justo lo que esto viene a quitar.
          $unset: { dataUrl: '' },
        },
        { upsert: true },
      );
      return json(200, { ok: true, ref: makeRef(stored.publicId, stored.etag) });
    };

    if (!moving) return await write(await uploadImage(target, dataUrl as string));

    const from = publicIdOf(ref as string);

    // Ya está donde tiene que estar: no hay bytes que mover, solo la marca de
    // tiempo que refrescar. Pasa siempre que se añade un adjunto al final,
    // porque los de delante se reenvían sin haberse movido.
    if (from === target) {
      const current = await images.findOne({ userId, key, index });
      if (current?.publicId === target) {
        await images.updateOne({ userId, key, index }, { $set: { updatedAt } });
        return json(200, { ok: true, ref: makeRef(current.publicId, current.etag) });
      }
      return json(410, { error: 'Esa imagen ya no existe' });
    }

    /*
     * El documento de origen es la única prueba de que esa imagen es de quien
     * pregunta: se busca por `userId` y `publicId` a la vez, así que una
     * referencia ajena no encuentra nada y no se renombra nada.
     */
    const source = await images.findOne({ userId, publicId: from });

    if (!source) {
      /*
       * No está. Lo más probable es que **el renombrado ya se hiciera** en un
       * intento anterior que se cortó más adelante: `flushImages` reenvía el
       * día entero al reintentar, y este es el segundo paso por la misma
       * imagen. Si la posición ya tiene dueño, se devuelve el suyo y el
       * navegador se pone al día; si no, esa imagen se perdió y se dice.
       */
      const current = await images.findOne({ userId, key, index });
      if (current) return json(200, { ok: true, ref: makeRef(current.publicId, current.etag) });
      return json(410, { error: 'Esa imagen ya no existe' });
    }

    const moved = await renameImage(from, target, source.etag);
    const respuesta = await write(moved);
    /*
     * El origen se queda vacío: su documento sobra. Si esa posición sigue
     * ocupada en el día, el `PUT` que venga detrás la volverá a escribir.
     *
     * El `publicId` en el filtro no es decoración: si por lo que fuera el
     * documento de origen resultara ser el de esta misma posición, la
     * escritura de arriba acaba de dejarle el `publicId` nuevo y este borrado
     * no encuentra nada — en vez de llevarse por delante lo recién guardado.
     */
    await images.deleteOne({ _id: source._id, publicId: from });
    return respuesta;
  } catch (error) {
    console.error('[images] no se pudo guardar:', error);
    return json(503, { error: 'No se pudo guardar la imagen' });
  }
};

/**
 * Recorta la cola de un día: borra de `from` en adelante. Es lo que deja el
 * conjunto del servidor igual que el de aquí cuando se quitan adjuntos, y con
 * `from=0` vacía el día entero.
 *
 * Borra **en los dos sitios**. Quedarse solo con el metadato dejaría la imagen
 * viva en Cloudinary, sin nadie que la mire y ocupando cuota para siempre.
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
    const doomed = await images
      .find({ userId, key, index: { $gte: from } }, { projection: { _id: 0, publicId: 1 } })
      .toArray();

    // Primero los bytes y después el metadato: al revés, un fallo a mitad
    // dejaría un huérfano del que ya no quedaría ni el nombre.
    await Promise.all(doomed.map((image) => destroyImage(image.publicId)));

    const result = await images.deleteMany({ userId, key, index: { $gte: from } });
    return json(200, { deleted: result.deletedCount });
  } catch (error) {
    console.error('[images] no se pudieron borrar:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};
