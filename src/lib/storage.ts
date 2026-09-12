import { DEFAULT_COLOR, isColorId, type ColorId } from './palette';
import { isImageDataUrl, isThumb, MAX_IMAGES_PER_DAY } from './image';

export const STORAGE_KEY = 'calendar_2026_q4_data';

export type DayEntry = {
  marked: boolean;
  note: string;
  color?: ColorId;
  /**
   * Imágenes adjuntas como data URL (JPEG, PNG o WebP), en el orden en que se
   * añadieron. Es la copia *de este navegador*: puede faltar entera en un
   * dispositivo que aún no las ha pedido, y por eso no sirve para contar.
   */
  images?: string[];
  /**
   * Cuántas imágenes tiene la nota en realidad. Manda sobre `images.length`
   * porque llega con el día desde el servidor, mientras que las imágenes en sí
   * se piden aparte y bajo demanda.
   */
  imageCount?: number;
  /** Miniatura de la primera imagen. Baja con el día; la pinta la agenda. */
  thumb?: string;
};

/** ¿Hay algo que guardar? Una imagen sola ya es contenido, igual que una nota. */
export function hasContent(entry: DayEntry): boolean {
  return entry.marked || Boolean(entry.note) || hasImages(entry);
}

/** Cuántas imágenes tiene la nota, las tenga descargadas o no este navegador. */
export function imageCount(entry: DayEntry | undefined): number {
  return entry?.imageCount ?? entry?.images?.length ?? 0;
}

/** ¿Lleva la nota alguna imagen? Evita repetir la cuenta por todas partes. */
export function hasImages(entry: DayEntry | undefined): boolean {
  return imageCount(entry) > 0;
}

/** ¿Están aquí todas las imágenes que dice tener? Decide si hay que pedirlas. */
export function imagesReady(entry: DayEntry | undefined): boolean {
  return (entry?.images?.length ?? 0) >= imageCount(entry);
}

/**
 * Lista saneada de imágenes de una entrada cruda. Acepta el formato actual
 * (`images: string[]`) y el anterior (`image: string`), que se convierte en
 * una lista de uno: los datos guardados antes del cambio siguen valiendo.
 * Las repetidas y las que no parezcan generadas por el navegador se
 * descartan, y el resto se recorta al máximo por día.
 */
function sanitizeImages(entry: Record<string, unknown>): string[] {
  const raw = Array.isArray(entry.images) ? entry.images : [entry.image];
  const clean: string[] = [];
  for (const value of raw) {
    if (isImageDataUrl(value) && !clean.includes(value)) clean.push(value);
    if (clean.length === MAX_IMAGES_PER_DAY) break;
  }
  return clean;
}

export type CalendarData = Record<string, DayEntry>;

/**
 * Descarta claves/valores corruptos en lugar de dejar caer todo el estado.
 * Se exporta porque un archivo importado merece la misma desconfianza que
 * lo que haya quedado en localStorage.
 */
export function sanitizeData(raw: unknown): CalendarData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const clean: CalendarData = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!value || typeof value !== 'object') continue;

    const entry = value as Record<string, unknown>;
    const marked = entry.marked === true;
    const note = typeof entry.note === 'string' ? entry.note : '';
    // Una imagen corrupta se descarta sin tumbar el resto del día.
    const images = sanitizeImages(entry);

    // La cuenta puede superar a las descargadas: otro dispositivo subió seis y
    // este todavía no las ha pedido. Nunca puede ser menor, o el día se
    // quedaría enseñando imágenes que dice no tener.
    const declared = typeof entry.imageCount === 'number' ? Math.floor(entry.imageCount) : 0;
    const count = Math.max(images.length, Math.min(Math.max(declared, 0), MAX_IMAGES_PER_DAY));

    const thumb = isThumb(entry.thumb) ? entry.thumb : undefined;

    if (!marked && !note && count === 0) continue;

    // Datos anteriores a los colores no traen `color`: se asume el teal base.
    const color = isColorId(entry.color) ? entry.color : DEFAULT_COLOR;

    clean[key] = {
      marked,
      note,
      color,
      ...(images.length ? { images } : {}),
      ...(count ? { imageCount: count } : {}),
      ...(thumb ? { thumb } : {}),
    };
  }
  return clean;
}

export function loadData(): CalendarData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeData(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Devuelve `false` si no se pudo persistir. Cuota llena o almacenamiento
 * bloqueado: la app sigue funcionando en memoria, pero con imágenes adjuntas
 * la cuota se alcanza de verdad y el usuario merece saberlo.
 */
export function saveData(data: CalendarData): boolean {
  if (typeof window === 'undefined') return true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
