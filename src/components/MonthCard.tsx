import { useEffect, useState } from 'react';
import DayCell from './DayCell';
import {
  buildMonthWeeks,
  dateKey,
  dayTimeState,
  daysInMonth,
  formatLongDate,
  formatWeekday,
  isInQuarter,
  shiftKey,
  WEEKDAYS,
  WEEKDAY_LABELS,
  YEAR,
  type DayTimeState,
} from '../lib/calendar';
import type { CalendarData } from '../lib/storage';

type Props = {
  monthIndex: number;
  name: string;
  data: CalendarData;
  /** Clave `YYYY-MM-DD` de hoy; vacía hasta que el cliente hidrata. */
  today: string;
  /** `extend` llega de un clic con Shift: marca el rango desde el último día. */
  onSelectDay: (key: string, extend: boolean) => void;
};

/** Días que avanza cada flecha: la cuadrícula tiene una semana por fila. */
const STEP = new Map([
  ['ArrowRight', 1],
  ['ArrowLeft', -1],
  ['ArrowDown', 7],
  ['ArrowUp', -7],
]);

/** Sufijo del `aria-label`: el estado temporal solo se ve, hay que decirlo. */
const STATE_SUFFIX: Record<DayTimeState, string> = {
  past: ', día pasado',
  today: ', hoy',
  future: '',
};

export default function MonthCard({ monthIndex, name, data, today, onSelectDay }: Props) {
  const weeks = buildMonthWeeks(YEAR, monthIndex);
  const total = daysInMonth(YEAR, monthIndex);
  const monthPrefix = `${YEAR}-${String(monthIndex + 1).padStart(2, '0')}-`;

  const markedCount = weeks
    .flat()
    .filter((slot) => slot.type === 'day' && data[slot.key]?.marked).length;

  // Tabulación itinerante: un mes entero son ~30 paradas de tab, así que solo
  // una casilla es tabulable y las flechas mueven el foco por la rejilla.
  const [focusedKey, setFocusedKey] = useState(() => dateKey(YEAR, monthIndex, 1));

  // Hoy es la entrada natural a su propio mes. `today` llega vacío hasta que
  // el cliente hidrata y vuelve a cambiar en cada medianoche.
  useEffect(() => {
    if (today.startsWith(monthPrefix)) setFocusedKey(today);
  }, [today, monthPrefix]);

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = STEP.get(event.key);
    const target =
      step !== undefined
        ? shiftKey(focusedKey, step)
        : event.key === 'Home'
          ? dateKey(YEAR, monthIndex, 1)
          : event.key === 'End'
            ? dateKey(YEAR, monthIndex, total)
            : undefined;

    if (!target) return;
    // Evita que las flechas desplacen la página mientras se recorre el mes.
    event.preventDefault();

    // La búsqueda es global, así que las flechas pasan de un mes al siguiente.
    // Fuera del trimestre no hay casilla y el foco se queda donde está.
    if (!isInQuarter(target)) return;
    document.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus();
  }

  // El foco burbujea: basta un manejador en la rejilla para que la parada de
  // tabulación siga al último día visitado, se llegue con teclado o con ratón.
  function trackFocus(event: React.FocusEvent<HTMLDivElement>) {
    const date = (event.target as HTMLElement).dataset.date;
    if (date) setFocusedKey(date);
  }

  return (
    <section
      aria-label={`${name} de ${YEAR}`}
      className="rounded-2xl border border-edge bg-surface p-4 shadow-sm sm:p-5"
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          {name} <span className="font-normal text-ink-muted">{YEAR}</span>
        </h2>
        {markedCount > 0 && (
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-strong">
            {markedCount} {markedCount === 1 ? 'día' : 'días'}
          </span>
        )}
      </header>

      {/* Una fila por semana: la rejilla plana se pintaba igual, pero `grid`
          solo es una tabla accesible si las filas existen en el DOM. */}
      <div
        role="grid"
        aria-label={`Días de ${name}`}
        onKeyDown={moveFocus}
        onFocus={trackFocus}
        className="flex flex-col gap-1.5"
      >
        <div role="row" className="mb-0.5 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((initial, i) => (
            <abbr
              key={WEEKDAY_LABELS[i]}
              role="columnheader"
              title={WEEKDAY_LABELS[i]}
              className="text-center text-xs font-semibold text-ink-muted no-underline"
            >
              {initial}
            </abbr>
          ))}
        </div>

        {weeks.map((week) => (
          <div key={week[0].id} role="row" className="grid grid-cols-7 gap-1.5">
            {week.map((slot) => {
              if (slot.type === 'blank') {
                // Sin `aria-hidden`: una casilla vacía sigue contando como
                // columna, y ocultarla descuadraría la fila para el lector.
                return (
                  <div
                    key={slot.id}
                    role="gridcell"
                    className="aspect-square rounded-lg bg-edge/50"
                  />
                );
              }

              const timeState = dayTimeState(slot.key, today);
              const dateLabel = `${formatWeekday(slot.key)} ${formatLongDate(slot.key)}`;

              return (
                <DayCell
                  key={slot.id}
                  day={slot.day}
                  isWeekend={slot.isWeekend}
                  entry={data[slot.key]}
                  timeState={timeState}
                  dateKey={slot.key}
                  label={dateLabel + STATE_SUFFIX[timeState]}
                  dateLabel={dateLabel}
                  weekday={slot.weekday}
                  tabIndex={slot.key === focusedKey ? 0 : -1}
                  onSelect={(extend) => onSelectDay(slot.key, extend)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
