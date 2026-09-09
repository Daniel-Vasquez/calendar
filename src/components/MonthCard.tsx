import DayCell from './DayCell';
import { buildMonthGrid, formatLongDate, formatWeekday, WEEKDAYS, WEEKDAY_LABELS, YEAR } from '../lib/calendar';
import type { CalendarData } from '../lib/storage';

type Props = {
  monthIndex: number;
  name: string;
  data: CalendarData;
  onSelectDay: (key: string) => void;
};

export default function MonthCard({ monthIndex, name, data, onSelectDay }: Props) {
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
        {slots.map((slot) =>
          slot.type === 'blank' ? (
            <div key={slot.id} aria-hidden="true" className="aspect-square rounded-lg bg-edge/50" />
          ) : (
            <DayCell
              key={slot.id}
              day={slot.day}
              isWeekend={slot.isWeekend}
              entry={data[slot.key]}
              label={`${formatWeekday(slot.key)} ${formatLongDate(slot.key)}`}
              onSelect={() => onSelectDay(slot.key)}
            />
          ),
        )}
      </div>
    </section>
  );
}
