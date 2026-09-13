import { MONTH_NAMES, YEARS } from './calendar';

export const EXPANSION_KEY = 'calendar_2026_months';

/**
 * `id` de la hoja provisional que `index.astro` inyecta antes del primer
 * pintado con el aspecto plegado de los meses guardados. El panel la retira
 * en cuanto aplica el estado leído de localStorage.
 */
export const BOOT_STYLE_ID = 'month-boot';

/**
 * Qué meses están desplegados, por año y mes: `{ '2026-01': true, … }`.
 * `true` es abierto, que es también el estado de fábrica de un mes que no
 * aparezca.
 *
 * **El año va en la clave.** Sin él, plegar enero en 2026 plegaba también el
 * enero de 2027 —era la misma casilla del estado—, y cambiar de pestaña
 * arrastraba la forma de un año a la del otro. Cada año pliega sus doce meses
 * por su cuenta, y eso incluye los botones de plegar y desplegar todo, que
 * tocan solo el año que se está viendo.
 *
 * La clave tiene la misma forma que los siete primeros caracteres de una clave
 * de día (`2026-01-15` → `2026-01`), y no es casualidad: es el prefijo con el
 * que ya se identifica un mes en todo el resto del proyecto.
 */
export type MonthExpansion = Record<string, boolean>;

/** Identificador de un mes en el estado guardado y en el `data-month` del DOM. */
export function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/**
 * El año al que pertenecía el estado guardado con el formato anterior, que
 * llevaba el mes por su nombre (`{ enero: false }`) y ningún año.
 *
 * Es 2026 porque era el único año que existía cuando se escribió: quien plegó
 * «enero» plegó el enero de 2026, no el de un 2027 que aún no estaba. Va como
 * constante y no como `YEARS[0]` porque son dos cosas distintas que hoy
 * coinciden: añadir 2025 por delante movería `YEARS[0]` y dejaría esta
 * migración apuntando a un año que nadie llegó a plegar.
 */
const LEGACY_YEAR = 2026;

/**
 * Lo que necesita la hoja de arranque de `index.astro` para entender el formato
 * anterior: el año al que pertenece y los nombres en el orden en que su índice
 * es el del mes. Se exporta —en vez de traducir allí— porque ese script no
 * puede importar nada: es `is:inline` y se ejecuta antes que cualquier módulo.
 */
export const LEGACY_MONTHS = {
  year: LEGACY_YEAR,
  months: MONTH_NAMES.map((name) => name.toLowerCase()),
};

const MONTH_INDEX = new Map(LEGACY_MONTHS.months.map((name, index) => [name, index]));

export const DEFAULT_EXPANSION: MonthExpansion = Object.fromEntries(
  YEARS.flatMap((year) => MONTH_NAMES.map((_, index) => [monthKey(year, index), true])),
);

/** Los doce meses de **un** año, abiertos o cerrados; los demás, como estaban. */
export function withYear(
  expansion: MonthExpansion,
  year: number,
  open: boolean,
): MonthExpansion {
  const next = { ...expansion };
  for (let index = 0; index < MONTH_NAMES.length; index++) next[monthKey(year, index)] = open;
  return next;
}

/**
 * ¿Está cada mes **de este año** en el estado dado? Decide qué botón global
 * tiene sentido, y por eso no mira los otros años: con 2026 entero plegado,
 * «Colapsar todos» tiene que verse agotado aunque 2027 siga abierto.
 */
export function everyMonth(expansion: MonthExpansion, year: number, open: boolean): boolean {
  return MONTH_NAMES.every((_, index) => expansion[monthKey(year, index)] === open);
}

/**
 * Parte del estado de fábrica y solo acepta meses conocidos con un booleano.
 *
 * Entiende además el formato anterior —el mes por su nombre y sin año—, que se
 * lee como el año que lo escribió. Sin esto, la primera visita tras el cambio
 * abriría de golpe todos los meses que alguien había dejado plegados.
 */
function sanitize(raw: unknown): MonthExpansion {
  const clean = { ...DEFAULT_EXPANSION };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'boolean') continue;

    if (Object.hasOwn(clean, key)) {
      clean[key] = value;
      continue;
    }

    const legacy = MONTH_INDEX.get(key);
    if (legacy !== undefined) clean[monthKey(LEGACY_YEAR, legacy)] = value;
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
