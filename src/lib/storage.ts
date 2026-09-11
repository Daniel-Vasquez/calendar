import { DEFAULT_COLOR, isColorId, type ColorId } from './palette';
import { isImageDataUrl } from './image';

export const STORAGE_KEY = 'calendar_2026_q4_data';

export type DayEntry = {
  marked: boolean;
  note: string;
  color?: ColorId;
  /** Imagen adjunta a la nota como data URL (JPEG, PNG o WebP). */
  image?: string;
};

/** ¿Hay algo que guardar? Una imagen sola ya es contenido, igual que una nota. */
export function hasContent(entry: DayEntry): boolean {
  return entry.marked || Boolean(entry.note) || Boolean(entry.image);
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

    const entry = value as Partial<DayEntry>;
    const marked = entry.marked === true;
    const note = typeof entry.note === 'string' ? entry.note : '';
    // Una imagen que no parezca generada por el navegador se descarta sin
    // tumbar el resto del día.
    const image = isImageDataUrl(entry.image) ? entry.image : undefined;
    if (!marked && !note && !image) continue;

    // Datos anteriores a los colores no traen `color`: se asume el teal base.
    const color = isColorId(entry.color) ? entry.color : DEFAULT_COLOR;

    clean[key] = image ? { marked, note, color, image } : { marked, note, color };
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
