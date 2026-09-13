import { MONTH_NAMES } from './calendar';

export const EXPANSION_KEY = 'calendar_2026_months';

/**
 * `id` de la hoja provisional que `index.astro` inyecta antes del primer
 * pintado con el aspecto plegado de los meses guardados. El panel la retira
 * en cuanto aplica el estado leído de localStorage.
 */
export const BOOT_STYLE_ID = 'month-boot';

/**
 * Qué meses están desplegados, por su nombre en minúsculas:
 * `{ enero: true, febrero: false, … }`. `true` es abierto, que es también el
 * estado de fábrica de un mes que no aparezca.
 *
 * El año no entra en la clave, y es a propósito: quien pliega los seis primeros
 * meses lo hace porque no le interesan, no porque no le interesen *en 2026*, y
 * cambiar de pestaña con la mitad del año plegándose y desplegándose sola sería
 * un sobresalto sin motivo. La hoja de arranque de `index.astro` depende de
 * ello: sus selectores son `[data-month="enero"]`, sin año que mirar.
 */
export type MonthExpansion = Record<string, boolean>;

/** Identificador de un mes en el estado guardado y en el `data-month` del DOM. */
export function monthKey(monthIndex: number): string {
  return MONTH_NAMES[monthIndex].toLowerCase();
}

export const DEFAULT_EXPANSION: MonthExpansion = Object.fromEntries(
  MONTH_NAMES.map((_, index) => [monthKey(index), true]),
);

/** Todos los meses abiertos o todos cerrados: lo que hacen los botones globales. */
export function expansionOf(open: boolean): MonthExpansion {
  return Object.fromEntries(Object.keys(DEFAULT_EXPANSION).map((key) => [key, open]));
}

/** ¿Está cada mes en el estado dado? Decide qué botón global tiene sentido. */
export function everyMonth(expansion: MonthExpansion, open: boolean): boolean {
  return Object.keys(DEFAULT_EXPANSION).every((key) => expansion[key] === open);
}

/** Parte del estado de fábrica y solo acepta meses conocidos con un booleano. */
function sanitize(raw: unknown): MonthExpansion {
  const clean = { ...DEFAULT_EXPANSION };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.hasOwn(clean, key) && typeof value === 'boolean') clean[key] = value;
  }
  return clean;
}

export function loadExpansion(): MonthExpansion {
  if (typeof window === 'undefined') return DEFAULT_EXPANSION;
  try {
    const raw = window.localStorage.getItem(EXPANSION_KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_EXPANSION;
  } catch {
    return DEFAULT_EXPANSION;
  }
}

export function saveExpansion(expansion: MonthExpansion): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXPANSION_KEY, JSON.stringify(expansion));
  } catch {
    /* Igual que el calendario: si el almacenamiento falla, se sigue en memoria. */
  }
}

/** Retira la hoja de arranque; sin ella, el estado lo dibuja React. */
export function removeBootStyle(): void {
  document.getElementById(BOOT_STYLE_ID)?.remove();
}
