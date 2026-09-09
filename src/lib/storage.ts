import { DEFAULT_COLOR, isColorId, type ColorId } from './palette';

export const STORAGE_KEY = 'calendar_2026_q4_data';

export type DayEntry = {
  marked: boolean;
  note: string;
  color?: ColorId;
};

export type CalendarData = Record<string, DayEntry>;

/** Descarta claves/valores corruptos en lugar de dejar caer todo el estado. */
function sanitize(raw: unknown): CalendarData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const clean: CalendarData = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!value || typeof value !== 'object') continue;

    const entry = value as Partial<DayEntry>;
    const marked = entry.marked === true;
    const note = typeof entry.note === 'string' ? entry.note : '';
    if (!marked && !note) continue;

    // Datos anteriores a los colores no traen `color`: se asume el teal base.
    const color = isColorId(entry.color) ? entry.color : DEFAULT_COLOR;

    clean[key] = { marked, note, color };
  }
  return clean;
}

export function loadData(): CalendarData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveData(data: CalendarData): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* Cuota llena o almacenamiento bloqueado: la app sigue funcionando en memoria. */
  }
}
