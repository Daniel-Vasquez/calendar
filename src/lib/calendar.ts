export const YEAR = 2026;

/** Meses del Q4 que se renderizan simultáneamente. `index` es 0-based (8 = Septiembre). */
export const QUARTER_MONTHS = [
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

/** ¿La clave cae dentro de alguno de los meses que el calendario dibuja? */
export function isInQuarter(key: string): boolean {
  return QUARTER_MONTHS.some((month) =>
    key.startsWith(`${YEAR}-${String(month.index + 1).padStart(2, '0')}-`),
  );
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
