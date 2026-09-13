import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getImages } from '../../../lib/mongo';
import { MAX_IMAGES_PER_DAY, type ImageSize } from '../../../lib/image';
import { signedUrl } from '../../../lib/cloudinary';
import { isDateKey } from '../../../lib/wire';

export const prerender = false;

/**
 * Los bytes de un adjunto, servidos por la casa.
 *
 * Es el único sitio por el que se puede ver una imagen, y la razón de que
 * exista es que **una URL firmada de Cloudinary no caduca**. Para que caducara
 * haría falta autenticación por token, que es plan *Advanced*; con una firma
 * perpetua, una dirección que se escapara por un historial, por un registro o
 * por un «Copiar dirección de la imagen» valdría para siempre y para
 * cualquiera. Aquí la firma no sale nunca de la función: sin cookie de sesión
 * no hay bytes, y punto.
 *
 * El precio es que el tráfico pasa dos veces —Cloudinary, función, navegador—,
 * y lo que lo mantiene en una vez por imagen y dispositivo es la caché de más
 * abajo.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Las dos medidas y nada más. Ver abajo por qué no se acepta una cualquiera. */
function isSize(value: unknown): value is ImageSize {
  return value === 'thumb' || value === 'view';
}

export const GET: APIRoute = async ({ locals, url }) => {
  const id = locals.user?.id;
  if (!id || !ObjectId.isValid(id)) return json(401, { error: 'No autenticado' });
  const userId = new ObjectId(id);

  const key = url.searchParams.get('key');
  if (!isDateKey(key)) return json(400, { error: 'Falta una clave de día válida' });

  const index = Number(url.searchParams.get('i') ?? '0');
  if (!Number.isInteger(index) || index < 0 || index >= MAX_IMAGES_PER_DAY) {
    return json(400, { error: 'Posición fuera de rango' });
  }

  /*
   * El tamaño llega como palabra —`thumb` o `view`— y no como cadena de
   * transformación. Admitir lo que mandara el cliente convertiría esto en un
   * proxy de transformaciones abierto, y las transformaciones son justo lo que
   * gasta créditos del plan.
   */
  const size = url.searchParams.get('size') ?? 'view';
  if (!isSize(size)) return json(400, { error: 'Tamaño no admitido' });

  const token = url.searchParams.get('v') ?? '';

  /*
   * **El testigo manda sobre la posición.** Quitar un adjunto que no es el
   * último corre una posición a los de detrás en el navegador al instante,
   * mientras que aquí no lo hacen hasta que sube la cola. Entre una cosa y la
   * otra, buscar por posición devolvería la imagen equivocada — y con la caché
   * de un año de más abajo, la dejaría equivocada para siempre.
   *
   * Buscando por `etag` eso no puede pasar: lo que se devuelve es siempre el
   * contenido que la dirección dice llevar. La posición queda de respaldo para
   * lo que no traiga un testigo reconocible (una miniatura de antes de la
   * tanda 8, por ejemplo), y entonces la respuesta **no se cachea a largo
   * plazo**, porque no se puede garantizar que sea lo que se pedía.
   */
  let image = null;
  let exact = false;
  try {
    const images = await getImages();
    // `userId` sale de la sesión: preguntar por el día de otra persona no
    // encuentra nada, que es la comprobación de propiedad entera.
    if (/^[A-Za-z0-9]{1,40}$/.test(token)) {
      image = await images.findOne({ userId, key, etag: token });
      exact = image !== null;
    }
    image ??= await images.findOne({ userId, key, index });
  } catch (error) {
    console.error('[images/raw] no se pudo leer el metadato:', error);
    return json(503, { error: 'La base de datos no responde' });
  }

  // Sin `publicId` el documento se quedó sin migrar: sus bytes no están en el
  // almacén. Es un 404 —esa imagen no está— y no un 502, que diría que el
  // almacén no responde cuando el almacén no tiene nada que responder.
  if (!image?.publicId) return json(404, { error: 'Esa imagen no existe' });

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl(image, size));
  } catch (error) {
    console.error('[images/raw] no se pudo traer la imagen:', error);
    return json(502, { error: 'El almacén de imágenes no responde' });
  }

  if (!upstream.ok || !upstream.body) {
    console.error('[images/raw] el almacén respondió', upstream.status, image.publicId);
    return json(502, { error: 'El almacén de imágenes no responde' });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? `image/${image.format}`,
      /*
       * Para siempre, y sin miedo: la dirección lleva el testigo del contenido
       * dentro (ver `rawSrc`), así que otra imagen es otra URL y esta nunca va
       * a devolver algo distinto de lo que ya se guardó. Sin esto, cada
       * pintada de la galería sería una invocación de la función y un viaje al
       * almacén.
       *
       * `private` porque es de una persona: ninguna caché compartida debe
       * quedarse con ella.
       *
       * Cuando ha habido que caer en la posición, un minuto: suficiente para
       * que pintar la agenda no sea una ráfaga de peticiones, y poco para que
       * una confusión no sobreviva a la siguiente subida.
       */
      'cache-control': exact
        ? 'private, max-age=31536000, immutable'
        : 'private, max-age=60',
      // La respuesta depende de quién pregunta, y la sesión va en la cookie:
      // sin esto, una caché intermedia podría dar la imagen de una persona a
      // la siguiente que pidiera la misma dirección.
      vary: 'Cookie',
    },
  });
};
