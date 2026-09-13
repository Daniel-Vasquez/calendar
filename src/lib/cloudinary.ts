import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import {
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME,
} from 'astro:env/server';

/**
 * Dónde viven los bytes de los adjuntos. Solo lo importa el servidor: la
 * *API Secret* firma cada subida y cada URL, y no puede asomarse al navegador
 * ni de lejos.
 *
 * La configuración va **explícita**. El SDK sabe leerse solo la variable
 * `CLOUDINARY_URL` de `process.env`, y en producción funcionaría; en
 * `astro dev` no, porque lo del `.env` llega por `astro:env` y no por
 * `process.env`. Esa asimetría es la que costó dos despliegues con
 * `BETTER_AUTH_URL`, así que aquí se declaran las tres piezas por separado y
 * se pasan a mano. `CLOUDINARY_URL` no se usa para nada.
 */
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

/** Las dos medidas que se sirven. Ni una más: ver `signedUrl`. */
export type ImageSize = 'thumb' | 'view';

/**
 * Las derivadas que se piden al subir, y las únicas que se pueden pedir al
 * servir. Son las mismas dos medidas que antes calculaba el navegador: 192
 * para la miniatura de la agenda y 1280 para la vista del visor.
 *
 * `limit` no amplía lo pequeño ni recorta lo apaisado: solo reduce lo que se
 * pase del lado mayor, que es justo lo que hacía `draw()` en `image.ts`.
 */
const TRANSFORMS: Record<ImageSize, Record<string, unknown>> = {
  thumb: { width: 192, height: 192, crop: 'limit', quality: 'auto:eco' },
  view: { width: 1280, height: 1280, crop: 'limit', quality: 'auto:good' },
};

/** Opciones comunes a todas las llamadas. Un `type` distinto es otro recurso. */
const AUTHENTICATED = { type: 'authenticated', resource_type: 'image' } as const;

/**
 * Dónde va cada imagen. Determinista a propósito: la posición del adjunto ya
 * dice su nombre, así que no hay que guardar «qué id me devolvió» para poder
 * volver a escribir encima.
 *
 * `userId` es siempre el de la sesión, nunca lo que venga en el cuerpo de la
 * petición. La carpeta no es la frontera de seguridad —eso lo hace la firma—,
 * pero deja el panel de Cloudinary legible y convierte «borrar todo lo de una
 * persona» en borrar un prefijo.
 */
export function publicIdFor(userId: string, key: string, index: number): string {
  return `uploads/users/${userId}/${key}/${index}`;
}

/** Lo que se guarda en Mongo de una imagen ya subida. */
export type StoredImage = {
  publicId: string;
  version: number;
  /**
   * Hash del contenido. Es el testigo de caché que viaja en la referencia: ver
   * `makeRef` en `image.ts`, que explica por qué no vale la `version`.
   */
  etag: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
};

function stored(result: UploadApiResponse): StoredImage {
  return {
    publicId: result.public_id,
    version: result.version,
    etag: result.etag,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}

/**
 * Sube una imagen y deja hechas sus dos derivadas.
 *
 * El cargador acepta la data URI tal cual, así que el navegador sigue mandando
 * lo mismo que mandaba a Mongo y todo el cambio se queda de este lado.
 *
 * `overwrite` porque reemplazar el adjunto 2 de un día es escribir en el mismo
 * sitio: sin él quedarían dos versiones vivas de la misma posición. Y las
 * derivadas se piden **eager y en el acto** —no `eager_async`— para que la
 * primera petición del proxy encuentre la miniatura hecha en vez de esperar a
 * que Cloudinary la genere.
 */
export async function uploadImage(publicId: string, dataUrl: string): Promise<StoredImage> {
  const result = await cloudinary.uploader.upload(dataUrl, {
    ...AUTHENTICATED,
    public_id: publicId,
    overwrite: true,
    eager: [TRANSFORMS.thumb, TRANSFORMS.view],
    eager_async: false,
  });
  return stored(result);
}

/**
 * Mueve una imagen ya subida a otra posición.
 *
 * Hace falta porque el nombre lleva el índice dentro: quitar el primero de tres
 * adjuntos deja al segundo viviendo en `…/1` cuando ya es el `…/0`. El
 * navegador no puede volver a subirlo —hace rato que soltó los bytes y solo
 * guarda la referencia—, así que el arreglo es un cambio de nombre, que no
 * mueve bytes y cuesta una llamada.
 */
export async function renameImage(from: string, to: string, etag: string): Promise<StoredImage> {
  const result = await cloudinary.uploader.rename(from, to, {
    ...AUTHENTICATED,
    to_type: 'authenticated',
    overwrite: true,
  });
  // Renombrar no devuelve `etag` —no hay bytes nuevos que resumir—, así que se
  // arrastra el que ya se guardó: son los mismos bytes en otro sitio.
  return { ...stored(result), etag };
}

/**
 * Borra una imagen. `invalidate` porque el nombre es determinista: la próxima
 * que ocupe esa posición se llamará igual, y sin purgar el CDN podría servirse
 * la anterior desde una caché intermedia.
 *
 * No lanza. Un `destroy` que falle deja un huérfano que ocupa sitio y que no
 * ve nadie; tumbar por eso el borrado del día sería mucho peor, porque lo que
 * la persona quería —que el adjunto desaparezca de su calendario— sí se puede
 * cumplir.
 */
export async function destroyImage(publicId: string): Promise<boolean> {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      ...AUTHENTICATED,
      invalidate: true,
    });
    return result.result === 'ok' || result.result === 'not found';
  } catch (error) {
    console.error('[cloudinary] no se pudo borrar', publicId, error);
    return false;
  }
}

/**
 * URL firmada de una de las dos medidas. **No sale nunca de la función**: la
 * usa el proxy para traerse los bytes y devolverlos él.
 *
 * Y no sale porque una URL firmada de Cloudinary **no caduca**. Para que
 * caducara haría falta autenticación por token, que es plan *Advanced*; con
 * una firma perpetua, una dirección que se escape por un historial o por un
 * «Copiar dirección de la imagen» vale para siempre y para cualquiera.
 *
 * El tamaño llega como `ImageSize` y no como cadena de transformación a
 * propósito: aceptar lo que mande el cliente convertiría esto en un proxy de
 * transformaciones abierto, y las transformaciones son lo que gasta créditos.
 */
export function signedUrl(image: StoredImage, size: ImageSize): string {
  return cloudinary.url(image.publicId, {
    ...AUTHENTICATED,
    sign_url: true,
    secure: true,
    version: image.version,
    format: image.format,
    transformation: [TRANSFORMS[size]],
  });
}
