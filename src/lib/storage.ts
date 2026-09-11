import { DEFAULT_COLOR, isColorId, type ColorId } from './palette';
import { isImageDataUrl, MAX_IMAGES_PER_DAY } from './image';

export const STORAGE_KEY = 'calendar_2026_q4_data';

export type DayEntry = {
  marked: boolean;
  note: string;
  color?: ColorId;
  /**
   * Imágenes adjuntas a la nota como data URL (JPEG, PNG o WebP), en el orden
   * en que se añadieron. Ausente o vacío si la nota no lleva ninguna.
   */
  images?: string[];
};

/** ¿Hay algo que guardar? Una imagen sola ya es contenido, igual que una nota. */
export function hasContent(entry: DayEntry): boolean {
  return entry.marked || Boolean(entry.note) || hasImages(entry);
}

/** ¿Lleva la nota alguna imagen? Evita repetir el `?.length` por todas partes. */
export function hasImages(entry: DayEntry | undefined): boolean {
  return Boolean(entry?.images?.length);
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
    if (!marked && !note && images.length === 0) continue;

    // Datos anteriores a los colores no traen `color`: se asume el teal base.
    const color = isColorId(entry.color) ? entry.color : DEFAULT_COLOR;

    clean[key] = images.length ? { marked, note, color, images } : { marked, note, color };
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
