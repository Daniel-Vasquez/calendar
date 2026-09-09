import type { DayEntry } from '../lib/storage';

type Props = {
  day: number;
  isWeekend: boolean;
  entry?: DayEntry;
  label: string;
  onSelect: () => void;
};

export default function DayCell({ day, isWeekend, entry, label, onSelect }: Props) {
  const marked = entry?.marked ?? false;
  const hasNote = Boolean(entry?.note);

  const base =
    'group relative flex aspect-square w-full items-center justify-center rounded-lg text-sm font-medium ' +
    'transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

  const state = marked
    ? 'bg-accent text-white shadow-sm hover:bg-accent-strong'
    : isWeekend
      ? 'bg-white/40 text-ink-muted hover:bg-edge'
      : 'bg-white text-ink-soft hover:bg-edge';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={marked}
      className={`${base} ${state}`}
    >
      <span className={hasNote ? '-translate-y-0.5' : undefined}>{day}</span>

      {hasNote && (
        <span
          aria-hidden="true"
          className={
            'absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-highlight ' +
            (marked ? 'ring-2 ring-white/70' : '')
          }
        />
      )}
    </button>
  );
}
