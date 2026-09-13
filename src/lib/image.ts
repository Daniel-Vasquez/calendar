/**
 * Imágenes adjuntas a una nota.
 *
 * Los bytes viven en Cloudinary desde la tanda 8. Aquí se preparan —validar,
 * redimensionar, comprimir— y aquí se resuelve la otra mitad: **qué `src`
 * pintar**, que es distinto según el adjunto haya llegado ya al almacén o no.
 *
 * Por eso un adjunto tiene dos formas y las dos son válidas en el mismo array:
 *
 * - una **data URL**, mientras está recién elegido y sin subir. Es lo único
 *   que este navegador tiene de él, así que se pinta tal cual;
 * - una **referencia** `cld:{publicId}@{version}` en cuanto el servidor
 *   confirma la subida. Ya no lleva bytes: se piden al proxy.
 *
 * Quien pinta no necesita saber cuál es cuál —para eso está `srcOf`—, pero
 * quien sanea sí: ver `isImageDataUrl` e `isImageRef`.
 */

/** Formatos admitidos, por tipo MIME y por extensión: Windows a veces manda `type` vacío. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/** Valor del atributo `accept` del selector: tipos y extensiones a la vez. */
export const IMAGE_ACCEPT = [...IMAGE_TYPES, ...IMAGE_EXTENSIONS].join(',');

/**
 * Imágenes que admite una nota. Ya no lo impone la cuota del navegador —los
 * bytes están en Cloudinary—, pero el tope se queda: seis adjuntos son seis
 * peticiones al subir y seis al abrir la galería, y el plan gratuito se mide
 * en créditos.
 */
export const MAX_IMAGES_PER_DAY = 6;

/** Archivos mayores no se intentan ni abrir: decodificarlos cuesta memoria. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/** Lado mayor tras redimensionar; suficiente para una vista previa nítida. */
const MAX_SIDE = 1280;

/**
 * Tope de la data URL que se manda a subir.
 *
 * Lo mandaba la cuota de localStorage, cuando la copia completa se guardaba
 * aquí; ahora manda el cuerpo de una función de Vercel, que son 4,5 MB. Se
 * queda en los mismos 700 KB de siempre: una imagen por petición cabe con
 * muchísimo margen, y bajarlo de ahí solo serviría para que una foto normal se
 * rechazara.
 */
const MAX_DATA_URL_LENGTH = 700_000;

export type ImageResult = { ok: true; dataUrl: string } | { ok: false; reason: string };

type ImageMime = (typeof IMAGE_TYPES)[number];

export function isImageFile(file: File): boolean {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** Solo se guarda lo que el propio navegador podría haber generado. */
export function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_DATA_URL_LENGTH &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
  );
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}

/**
 * Codifica el lienzo probando WebP primero. Si el navegador no sabe generarlo
 * (`toDataURL` devuelve PNG en su lugar), cae al formato de origen: JPEG para
 * fotos y PNG para lo que pueda llevar transparencia.
 */
function encode(canvas: HTMLCanvasElement, sourceType: ImageMime, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality);
  if (webp.startsWith('data:image/webp')) return webp;
  const fallback = sourceType === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(fallback, quality);
}

function sourceType(file: File): ImageMime {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) return file.type as ImageMime;
  const name = file.name.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function draw(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Valida, redimensiona y comprime una imagen elegida por el usuario hasta
 * dejarla en una data URL que quepa en una petición. Si aun reduciéndola sigue
 * pesando demasiado, se rechaza con un motivo legible.
 *
 * Sigue haciéndose aquí y no en el servidor aunque los bytes ya no se guarden
 * en este navegador: es lo que mantiene cada archivo pequeño, y subir los doce
 * megas de una foto de móvil para reducirlos allí sería pagar el viaje entero
 * para tirarlo.
 */
export async function prepareImage(file: File): Promise<ImageResult> {
  if (!isImageFile(file)) {
    return { ok: false, reason: 'Solo se admiten imágenes JPG, PNG o WebP.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: 'La imagen supera los 12 MB.' };
  }

  let img: HTMLImageElement;
  try {
    img = await loadBitmap(file);
  } catch {
    return { ok: false, reason: 'No se pudo leer la imagen.' };
  }

  const type = sourceType(file);
  // Dos intentos: el segundo aprieta tamaño y calidad para capturas enormes.
  const attempts: Array<[number, number]> = [
    [MAX_SIDE, 0.82],
    [800, 0.7],
  ];

  try {
    for (const [side, quality] of attempts) {
      const dataUrl = encode(draw(img, side), type, quality);
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) return { ok: true, dataUrl };
    }
  } catch {
    return { ok: false, reason: 'No se pudo procesar la imagen.' };
  }

  return { ok: false, reason: 'La imagen sigue siendo demasiado grande tras reducirla.' };
}

/**
 * Bytes aproximados de una data URL. Solo tienen tamaño las que aún no han
 * subido: de una referencia no se sabe aquí lo que pesa, y devolver cero deja
 * que la cuenta del modal siga sumando sin casos especiales.
 */
export function dataUrlBytes(dataUrl: string): number {
  if (!dataUrl.startsWith('data:')) return 0;
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((payload.length * 3) / 4);
}

/* --- Lo que baja: referencias, no bytes ---------------------------------- */

/** Las dos medidas que sirve el proxy. Ha de decir lo mismo que `cloudinary.ts`. */
export type ImageSize = 'thumb' | 'view';

/**
 * Un adjunto ya subido: `cld:{publicId}@{etag}`.
 *
 * El testigo va pegado para que **una imagen distinta sea otra URL**. De eso
 * vive la caché eterna del proxy: sin él, reemplazar el adjunto 2 de un día
 * dejaría a los navegadores enseñando el anterior durante un año.
 *
 * Y es el `etag` —el hash del contenido— y no la `version` de Cloudinary, que
 * era lo natural, porque la `version` **no cambia al renombrar**: quitar la
 * primera de dos imágenes corre la segunda al sitio de la primera con su
 * versión intacta, y si las dos se subieron en el mismo segundo la dirección
 * saldría idéntica con otro contenido detrás. Con el hash eso no puede pasar,
 * y dos veces la misma imagen comparten caché, que es lo correcto.
 */
export function makeRef(publicId: string, etag: string): string {
  return `cld:${publicId}@${etag}`;
}

/**
 * ¿Es la referencia de un adjunto subido?
 *
 * Hace falta aparte de `isImageDataUrl` y no en su lugar: aquella guarda la
 * puerta de **subida** —solo se acepta lo que el navegador podría haber
 * generado— y esta la de **bajada**. Sin las dos, el saneado del cliente
 * tiraría todo lo que viene del servidor por no ser una data URL.
 */
export function isImageRef(value: unknown): value is string {
  return typeof value === 'string' && /^cld:[A-Za-z0-9_\-./]{1,200}@[A-Za-z0-9]{1,40}$/.test(value);
}

/** El `public_id` de una referencia. Lo usa el servidor; el navegador no lo mira. */
export function publicIdOf(ref: string): string {
  return ref.slice(4, ref.lastIndexOf('@'));
}

/** El testigo de caché de una referencia. Ver `makeRef`. */
export function tokenOf(ref: string): string {
  return ref.slice(ref.lastIndexOf('@') + 1);
}

/**
 * De dónde saca el navegador los bytes de una imagen ya subida.
 *
 * Es el proxy y no una URL de Cloudinary: la firma no sale nunca de la
 * función. Ver `signedUrl` en `cloudinary.ts`, que explica por qué.
 *
 * `v` no lo lee el servidor —lo que hace falta para firmar está en la base—,
 * está para que la dirección cambie cuando cambia la imagen y la respuesta
 * pueda cachearse para siempre.
 */
export function rawSrc(key: string, index: number, size: ImageSize, token: string): string {
  const query = new URLSearchParams({ key, i: String(index), size, v: token });
  return `/api/images/raw?${query}`;
}

/**
 * El `src` de un adjunto, esté subido o no. **Todo lo que pinta una imagen
 * sale de aquí**, y no de una cadena repartida por los componentes: si algún
 * día el plan permite URLs firmadas con caducidad, el proxy desaparece
 * cambiando esta función y nada más.
 */
export function srcOf(image: string, key: string, index: number, size: ImageSize): string {
  // Recién elegida y aún sin subir: los únicos bytes que hay son estos.
  if (!isImageRef(image)) return image;
  return rawSrc(key, index, size, tokenOf(image));
}

/**
 * El `src` de la miniatura que acompaña al día.
 *
 * `thumb` ya no es una miniatura en base64 sino el testigo de la primera
 * imagen (ver `wire.ts`), así que esto es la otra mitad de aquel campo: con él
 * y con la clave del día ya se sabe qué pedirle al proxy.
 */
export function thumbSrc(key: string, token: string): string {
  return rawSrc(key, 0, 'thumb', token);
}

/**
 * ¿Es una `thumb` de las de ahora? Es el testigo de una referencia, no una
 * imagen. Una miniatura en base64 de las de antes se descarta aquí: el día se
 * queda sin vista previa hasta que llegue la suya, que es lo que hacen la
 * migración y la primera resubida de ese día.
 */
export function isThumb(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{1,40}$/.test(value);
}
