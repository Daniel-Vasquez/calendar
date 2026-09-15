import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import {
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_FOLDER,
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
 * La carpeta raíz de todo lo que sube la aplicación. Se normaliza aquí —sin
 * barras sueltas a los lados— porque va pegada con `/` a lo que viene detrás y
 * un `planificador/` de más dejaría un `//` dentro del `public_id`, que
 * Cloudinary acepta y luego nadie sabe volver a nombrar.
 *
 * El respaldo cubre el caso de que alguien la defina vacía: el valor por
 * defecto de `astro.config.mjs` solo actúa cuando la variable **no está**.
 */
const FOLDER = CLOUDINARY_FOLDER.replace(/^\/+|\/+$/g, '') || 'planificador';

/**
 * Dónde va cada imagen. Determinista a propósito: la posición del adjunto ya
 * dice su nombre, así que no hay que guardar «qué id me devolvió» para poder
 * volver a escribir encima.
 *
 * `userId` es siempre el de la sesión, nunca lo que venga en el cuerpo de la
 * petición. Y es el **identificador** que da Better Auth —el `ObjectId` en
 * hexadecimal—, no el nombre ni el correo: es único, no cambia si la persona
 * se renombra, y son treinta y dos caracteres de `[0-9a-f]` que no pueden
 * llevar un espacio, un acento ni una barra dentro. Un nombre de usuario sí, y
 * cualquiera de esas tres cosas parte el `public_id` en dos.
 *
 * La carpeta no es la frontera de seguridad —eso lo hace la firma—, pero deja
 * el panel de Cloudinary legible y convierte «borrar todo lo de una persona»
 * en borrar un prefijo.
 *
 * Quien cambie la forma de este nombre tiene que mover lo ya subido: los
 * `publicId` guardados en `images` son absolutos y no se recalculan solos. Ver
 * `scripts/migrate-image-folders.mjs`.
 */
export function publicIdFor(userId: string, key: string, index: number): string {
  return `${FOLDER}/${userId}/${key}/${index}`;
}

/**
 * Dónde **enseña** la biblioteca de Cloudinary una imagen, que desde las
 * *carpetas dinámicas* no es lo mismo que dónde se sirve.
 *
 * Esta cuenta está en `folder_mode: dynamic`, y ahí el `public_id` es solo el
 * identificador con el que se pide el archivo: las barras que lleva dentro son
 * caracteres, no carpetas. Lo que decide en qué carpeta sale en el panel es un
 * campo aparte, `asset_folder`, y si no se manda queda vacío — y entonces la
 * imagen aparece en *Home* aunque su `public_id` diga `planificador/…`. Eso es
 * exactamente lo que pasó con las primeras siete.
 *
 * Las dos piezas se sacan del `public_id` por la cola y no por la cabeza, así
 * que da igual cuántas barras traiga `CLOUDINARY_FOLDER`: los dos últimos
 * tramos son siempre el día y la posición.
 *
 * - `asset_folder`: `{FOLDER}/{userId}`, que es la carpeta por persona.
 * - `display_name`: `{día}-{posición}`, porque dentro de esa carpeta el nombre
 *   que saca el panel es el último tramo del `public_id` y serían todas «0».
 *
 * En una cuenta de carpetas fijas los dos campos sobran y Cloudinary los
 * ignora; allí la carpeta la da el `public_id`, que ya es la correcta.
 */
function placementOf(publicId: string): { asset_folder: string; display_name: string } {
  const parts = publicId.split('/');
  return {
    asset_folder: parts.slice(0, -2).join('/'),
    display_name: parts.slice(-2).join('-'),
  };
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
    // Dónde sale en el panel. Ver `placementOf`: con carpetas dinámicas esto
    // no se deduce del `public_id`, hay que decirlo. Va aquí y no en `folder`
    // porque `folder` significa cosas distintas en cada modo de carpetas: en
    // el fijo se antepone al `public_id` y dejaría `planificador/planificador/…`.
    ...placementOf(publicId),
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
 *
 * `rename` no admite `asset_folder` ni `display_name`, así que la carpeta del
 * panel **no se toca aquí** — y no hace falta: reordenar mueve la imagen
 * dentro del mismo día de la misma persona, y la carpeta es por persona. Lo
 * que sí se queda atrás es el `display_name`, que seguirá diciendo la posición
 * de antes. Es cosmética de la biblioteca, no afecta a lo que se sirve, y
 * arreglarla costaría una llamada a la API Admin por reordenación cuando el
 * plan da 500 a la hora. `migrate-image-folders.mjs` los vuelve a cuadrar cada
 * vez que se pasa.
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
