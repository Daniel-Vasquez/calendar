/**
 * Imágenes adjuntas a una nota. Viven como data URL dentro del mismo JSON que
 * el resto del día: así caben en localStorage y viajan con la exportación
 * sin necesidad de un almacén aparte.
 */

/** Formatos admitidos, por tipo MIME y por extensión: Windows a veces manda `type` vacío. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/** Valor del atributo `accept` del selector: tipos y extensiones a la vez. */
export const IMAGE_ACCEPT = [...IMAGE_TYPES, ...IMAGE_EXTENSIONS].join(',');

/**
 * Imágenes que admite una nota. Con la cuota de localStorage repartida entre
 * todo el año, más adjuntos por día agotarían el espacio en pocas notas.
 */
export const MAX_IMAGES_PER_DAY = 6;

/** Archivos mayores no se intentan ni abrir: decodificarlos cuesta memoria. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/** Lado mayor tras redimensionar; suficiente para una vista previa nítida. */
const MAX_SIDE = 1280;

/**
 * Tope de la data URL guardada. localStorage ronda los 5 MB por sitio y el
 * calendario entero comparte esa cuota, así que cada imagen debe quedar lejos.
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
 * dejarla en una data URL que quepa en localStorage. Si aun reduciéndola
 * sigue pesando demasiado, se rechaza con un motivo legible.
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

/** Bytes aproximados que ocupa una data URL en el almacenamiento. */
export function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((payload.length * 3) / 4);
}
