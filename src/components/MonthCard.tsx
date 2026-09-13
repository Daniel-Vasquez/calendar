import { useEffect, useId, useState } from 'react';
import DayCell from './DayCell';
import {
  buildMonthWeeks,
  dateKey,
  dayTimeState,
  daysInMonth,
  formatLongDate,
  formatWeekday,
  isInYear,
  shiftKey,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type DayTimeState,
} from '../lib/calendar';
import { monthKey } from '../lib/collapse';
import type { CalendarData } from '../lib/storage';

type Props = {
  /** Año al que pertenece el mes. Lo decide el conmutador de la cabecera. */
  year: number;
  monthIndex: number;
  name: string;
  data: CalendarData;
  /** Clave `YYYY-MM-DD` de hoy; vacía hasta que el cliente hidrata. */
  today: string;
  /** `extend` llega de un clic con Shift: marca el rango desde el último día. */
  onSelectDay: (key: string, extend: boolean) => void;
  /** Plegado o desplegado; lo decide el panel, que lo guarda para todos los meses. */
  expanded: boolean;
  onToggle: () => void;
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

export default function MonthCard({
  year,
  monthIndex,
  name,
  data,
  today,
  onSelectDay,
  expanded,
  onToggle,
}: Props) {
  const weeks = buildMonthWeeks(year, monthIndex);
  const total = daysInMonth(year, monthIndex);
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
  const bodyId = useId();

  const markedCount = weeks
    .flat()
    .filter((slot) => slot.type === 'day' && data[slot.key]?.marked).length;

  // Tabulación itinerante: un mes entero son ~30 paradas de tab, así que solo
  // una casilla es tabulable y las flechas mueven el foco por la rejilla.
  const [focusedKey, setFocusedKey] = useState(() => dateKey(year, monthIndex, 1));

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
          ? dateKey(year, monthIndex, 1)
          : event.key === 'End'
            ? dateKey(year, monthIndex, total)
            : undefined;

    if (!target) return;
    // Evita que las flechas desplacen la página mientras se recorre el mes.
    event.preventDefault();

    // La búsqueda es global, así que las flechas pasan de un mes al siguiente.
    // Fuera del año **que se está dibujando** no hay casilla y el foco se queda
    // donde está: el 31 de diciembre no salta al 1 de enero del año siguiente
    // aunque el calendario lo cubra, porque esa rejilla no está en la página.
    // En un mes plegado la casilla es `inert` y `focus()` tampoco se mueve.
    if (!isInYear(target, year)) return;
    document.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus();
  }

  // El foco burbujea: basta un manejador en la rejilla para que la parada de
  // tabulación siga al último día visitado, se llegue con teclado o con ratón.
  function trackFocus(event: React.FocusEvent<HTMLDivElement>) {
    const date = (event.target as HTMLElement).dataset.date;
    if (date) setFocusedKey(date);
  }

  return (
    // `data-month` y `data-open` son los ganchos del acordeón: el CSS de
    // global.css pliega el cuerpo y gira el chevron a partir de ellos, y la
    // hoja de arranque de index.astro hace lo mismo antes de hidratar.
    <section
      aria-label={`${name} de ${year}`}
      data-month={monthKey(year, monthIndex)}
      data-open={expanded || undefined}
      className="scroll-mt-20 rounded-2xl border border-edge bg-surface p-4 shadow-sm sm:p-5"
    >
      {/* El margen negativo devuelve el relleno del botón al borde de la
          tarjeta: la zona de pulsado crece sin mover el título. */}
      <header className="-m-2">
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-edge/60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <span className="flex-1">
              {name} <span className="font-normal text-ink-muted">{year}</span>
            </span>
            {markedCount > 0 && (
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-ink-strong">
                {markedCount} {markedCount === 1 ? 'día' : 'días'}
              </span>
            )}
            <ChevronIcon />
          </button>
        </h2>
      </header>

      {/* Plegado, el cuerpo sigue en el DOM para conservar el estado del foco
          itinerante, pero `inert` lo saca del tabulado y del lector. */}
      <div id={bodyId} className="month-body" inert={!expanded}>
        {/* Sin clases a propósito: es el ítem de la rejilla plegable y un
            relleno suyo no se encoge a 0fr; la separación va en la rejilla. */}
        <div>
          {/* Una fila por semana: la rejilla plana se pintaba igual, pero `grid`
              solo es una tabla accesible si las filas existen en el DOM. */}
          <div
            role="grid"
            aria-label={`Días de ${name}`}
            onKeyDown={moveFocus}
            onFocus={trackFocus}
            className="flex flex-col gap-1.5 pt-4"
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
        </div>
      </div>
    </section>
  );
}

/** Apunta abajo con el mes abierto; el CSS lo gira hacia la derecha al plegar. */
function ChevronIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="month-chevron print-hidden shrink-0 text-ink-muted"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
