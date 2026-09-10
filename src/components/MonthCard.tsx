import DayCell from './DayCell';
import {
  buildMonthGrid,
  dayTimeState,
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

/** Sufijo del `aria-label`: el estado temporal solo se ve, hay que decirlo. */
const STATE_SUFFIX: Record<DayTimeState, string> = {
  past: ', día pasado',
  today: ', hoy',
  future: '',
};

export default function MonthCard({ monthIndex, name, data, today, onSelectDay }: Props) {
  const slots = buildMonthGrid(YEAR, monthIndex);

  const markedCount = slots.filter(
    (slot) => slot.type === 'day' && data[slot.key]?.marked,
  ).length;

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

      <div className="grid grid-cols-7 gap-1.5">
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
              label={dateLabel + STATE_SUFFIX[timeState]}
              dateLabel={dateLabel}
              weekday={slot.weekday}
              onSelect={() => onSelectDay(slot.key)}
            />
          );
        })}
      </div>
    </section>
  );
}
