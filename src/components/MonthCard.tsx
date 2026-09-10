import { useEffect, useRef, useState } from 'react';
import DayCell from './DayCell';
import {
  buildMonthGrid,
  dateKey,
  dayTimeState,
  daysInMonth,
  formatLongDate,
  formatWeekday,
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
  onSelectDay: (key: string) => void;
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
  const slots = buildMonthGrid(YEAR, monthIndex);
  const total = daysInMonth(YEAR, monthIndex);
  const monthPrefix = `${YEAR}-${String(monthIndex + 1).padStart(2, '0')}-`;

  const markedCount = slots.filter(
    (slot) => slot.type === 'day' && data[slot.key]?.marked,
  ).length;

  // Tabulación itinerante: un mes entero son ~30 paradas de tab, así que solo
  // una casilla es tabulable y las flechas mueven el foco dentro de la rejilla.
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusedDay, setFocusedDay] = useState(1);

  // Hoy es la entrada natural a su propio mes. `today` llega vacío hasta que
  // el cliente hidrata y vuelve a cambiar en cada medianoche.
  useEffect(() => {
    if (!today.startsWith(monthPrefix)) return;
    setFocusedDay(Number(today.slice(8, 10)));
  }, [today, monthPrefix]);

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = STEP.get(event.key);
    const target =
      step !== undefined
        ? focusedDay + step
        : event.key === 'Home'
          ? 1
          : event.key === 'End'
            ? total
            : undefined;

    if (target === undefined) return;
    // Evita que las flechas desplacen la página mientras se recorre el mes.
    event.preventDefault();

    // Los bordes del mes retienen el foco en lugar de dejarlo caer fuera.
    const day = Math.min(Math.max(target, 1), total);
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${dateKey(YEAR, monthIndex, day)}"]`)
      ?.focus();
  }

  // El foco burbujea: basta un manejador en la rejilla para que la parada de
  // tabulación siga al último día visitado, se llegue con teclado o con ratón.
  function trackFocus(event: React.FocusEvent<HTMLDivElement>) {
    const date = (event.target as HTMLElement).dataset.date;
    if (date) setFocusedDay(Number(date.slice(8, 10)));
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

      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((initial, i) => (
          <abbr
            key={WEEKDAY_LABELS[i]}
            title={WEEKDAY_LABELS[i]}
            className="text-center text-xs font-semibold text-ink-muted no-underline"
          >
            {initial}
          </abbr>
        ))}
      </div>

      <div
        ref={gridRef}
        onKeyDown={moveFocus}
        onFocus={trackFocus}
        className="grid grid-cols-7 gap-1.5"
      >
        {slots.map((slot) => {
          if (slot.type === 'blank') {
            return (
              <div key={slot.id} aria-hidden="true" className="aspect-square rounded-lg bg-edge/50" />
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
              tabIndex={slot.day === focusedDay ? 0 : -1}
              onSelect={() => onSelectDay(slot.key)}
            />
          );
        })}
      </div>
    </section>
  );
}
