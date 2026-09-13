/**
 * Los años que cubre el calendario, en orden y sin huecos.
 *
 * La rejilla dibuja **uno cada vez** —el que diga el conmutador de la
 * cabecera—, pero el resto de la aplicación los mezcla sin distinguirlos: un
 * día se identifica por su fecha completa (`YYYY-MM-DD`), así que la agenda, la
 * galería y los recordatorios ya los ordenan juntos sin saber que hay más de
 * un año. Añadir 2028 aquí basta para que el conmutador crezca.
 */
export const YEARS = [2026, 2027] as const;

export type CalendarYear = (typeof YEARS)[number];

/** Primer y último día admitidos: los `min`/`max` de todo campo de fecha. */
export const MIN_DATE = `${YEARS[0]}-01-01`;
export const MAX_DATE = `${YEARS[YEARS.length - 1]}-12-31`;

/** «2026 y 2027»: cómo se nombran los años cubiertos dentro de una frase. */
export const YEARS_LABEL = (YEARS as readonly number[])
  .map(String)
  .reduce((text, year, at, all) =>
    at === all.length - 1 ? `${text} y ${year}` : `${text}, ${year}`,
  );

/** Meses del año que se renderizan simultáneamente. `index` es 0-based (0 = Enero). */
export const YEAR_MONTHS = [
  { index: 0, name: 'Enero' },
  { index: 1, name: 'Febrero' },
  { index: 2, name: 'Marzo' },
  { index: 3, name: 'Abril' },
  { index: 4, name: 'Mayo' },
  { index: 5, name: 'Junio' },
  { index: 6, name: 'Julio' },
  { index: 7, name: 'Agosto' },
  { index: 8, name: 'Septiembre' },
  { index: 9, name: 'Octubre' },
  { index: 10, name: 'Noviembre' },
  { index: 11, name: 'Diciembre' },
] as const;

/** Cabecera de la cuadrícula: la semana empieza en lunes. */
export const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
export const WEEKDAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/** Índice del día dentro de una semana que empieza en lunes (0 = lunes, 6 = domingo). */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Clave estable `YYYY-MM-DD` construida en hora local (sin desfases de UTC). */
export function dateKey(year: number, monthIndex: number, day: number): string {
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export type CalendarSlot =
  | { type: 'blank'; id: string }
  | {
      type: 'day';
      id: string;
      day: number;
      key: string;
      weekday: number;
      isWeekend: boolean;
    };

/**
 * Construye la cuadrícula del mes: huecos vacíos al inicio hasta el primer
 * día real y huecos de relleno al final para completar la última semana.
 */
export function buildMonthGrid(year: number, monthIndex: number): CalendarSlot[] {
  const total = daysInMonth(year, monthIndex);
  const leading = mondayIndex(new Date(year, monthIndex, 1));

  const slots: CalendarSlot[] = [];

  for (let i = 0; i < leading; i++) {
    slots.push({ type: 'blank', id: `lead-${monthIndex}-${i}` });
  }

  for (let day = 1; day <= total; day++) {
    const weekday = mondayIndex(new Date(year, monthIndex, day));
    slots.push({
      type: 'day',
      id: `day-${monthIndex}-${day}`,
      day,
      key: dateKey(year, monthIndex, day),
      weekday,
      isWeekend: weekday >= 5,
    });
  }

  const trailing = (7 - (slots.length % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    slots.push({ type: 'blank', id: `trail-${monthIndex}-${i}` });
  }

  return slots;
}

/**
 * Agrupa la cuadrícula en semanas de siete. La rejilla plana bastaba para
 * pintarla, pero marcarla como `grid` accesible exige filas de verdad.
 */
export function buildMonthWeeks(year: number, monthIndex: number): CalendarSlot[][] {
  const slots = buildMonthGrid(year, monthIndex);
  const weeks: CalendarSlot[][] = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

/** Clave desplazada `days` días. `Date` cruza el cambio de mes por su cuenta. */
export function shiftKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const moved = new Date(year, month - 1, day + days);
  return dateKey(moved.getFullYear(), moved.getMonth(), moved.getDate());
}

/** Claves entre dos días, ambos incluidos y en orden cronológico. */
export function keysBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const keys: string[] = [];
  for (let key = from; key <= to; key = shiftKey(key, 1)) keys.push(key);
  return keys;
}

/** "15 de Octubre, 2026" a partir de una clave `YYYY-MM-DD`. */
export function formatLongDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return `${day} de ${MONTH_NAMES[month - 1]}, ${year}`;
}

/** "Jueves" a partir de una clave `YYYY-MM-DD`. */
export function formatWeekday(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return WEEKDAY_LABELS[mondayIndex(new Date(year, month - 1, day))];
}

/** Índice 0-based del mes de una clave `YYYY-MM-DD`. */
export function monthIndexOf(key: string): number {
  return Number(key.slice(5, 7)) - 1;
}

/** Año de una clave `YYYY-MM-DD`, como número. */
export function yearOf(key: string): number {
  return Number(key.slice(0, 4));
}

/** ¿Es uno de los años que el calendario cubre? */
export function isCalendarYear(value: number): value is CalendarYear {
  return (YEARS as readonly number[]).includes(value);
}

/**
 * ¿Cae la clave dentro del calendario? Es la única pregunta que decide si un
 * día se puede abrir, mover o poner en un recordatorio, y desde que hay más de
 * un año responde por el año de la clave y no por el mes.
 */
export function isCovered(key: string): boolean {
  return isCalendarYear(yearOf(key));
}

/** ¿Cae la clave en el año que la rejilla está dibujando ahora mismo? */
export function isInYear(key: string, year: number): boolean {
  return yearOf(key) === year;
}

/**
 * Año con el que se abre el calendario: el corriente si está cubierto, y si no
 * el extremo más cercano. Se resuelve en el servidor para que la rejilla nazca
 * ya en el año correcto y no haya que cambiarla al hidratar.
 */
export function defaultYear(now: Date = new Date()): CalendarYear {
  const current = now.getFullYear();
  if (isCalendarYear(current)) return current;
  return current < YEARS[0] ? YEARS[0] : YEARS[YEARS.length - 1];
}

/** Lee un año de la URL. Devuelve `null` si no es uno de los cubiertos. */
export function parseYear(raw: string | null): CalendarYear | null {
  const value = Number(raw);
  return raw && Number.isInteger(value) && isCalendarYear(value) ? value : null;
}

/** Clave `YYYY-MM-DD` del día de hoy, en hora local y sin horas/minutos. */
export function todayKey(now: Date = new Date()): string {
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

export type DayTimeState = 'past' | 'today' | 'future';

/**
 * Sitúa una celda respecto a hoy. `YYYY-MM-DD` es de ancho fijo, así que el
 * orden lexicográfico coincide con el cronológico y basta comparar cadenas.
 *
 * Antes de hidratar no hay fecha de cliente (`today` vacío): todo se trata
 * como futuro, es decir, sin estilos especiales.
 */
export function dayTimeState(key: string, today: string): DayTimeState {
  if (!today || key > today) return 'future';
  return key === today ? 'today' : 'past';
}

/** Milisegundos hasta la próxima medianoche local. */
export function msUntilNextMidnight(now: Date = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

/** Parámetro con el que el calendario abre un día al cargar: `/?day=2026-03-15`. */
export const DAY_PARAM = 'day';

/**
 * Parámetro que fija el año de la rejilla: `/?year=2027`.
 *
 * Es la memoria del conmutador, y vive en la URL y no en `localStorage` a
 * propósito: el servidor la lee antes de pintar, así que recargar en 2027
 * devuelve 2027 sin que se vea 2026 un instante. De paso, el enlace se puede
 * compartir y el año viaja con él.
 */
export const YEAR_PARAM = 'year';

/**
 * Ruta del calendario con el día ya abierto. Es el destino de todo enlace que
 * salga de una vista lateral hacia su origen: "Ver nota" en la galería y "Ver
 * en el calendario" en los recordatorios.
 */
export function dayHref(key: string): string {
  return `/?${DAY_PARAM}=${key}`;
}
