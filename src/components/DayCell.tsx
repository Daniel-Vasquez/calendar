import { colorHex } from '../lib/palette';
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
    'group relative flex aspect-square w-full items-center justify-center rounded-lg text-sm font-semibold ' +
    'transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

  // El color marcado es dinámico por día, así que va como estilo en línea:
  // Tailwind no puede generar utilidades para valores decididos en runtime.
  const state = marked
    ? 'text-white shadow-sm hover:brightness-90'
    : isWeekend
      ? 'bg-white/40 font-medium text-ink-muted hover:bg-edge'
      : 'bg-white font-medium text-ink-soft hover:bg-edge';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={marked}
      className={`${base} ${state}`}
      style={marked ? { backgroundColor: colorHex(entry?.color) } : undefined}
    >
      <span className={hasNote ? '-translate-y-0.5' : undefined}>{day}</span>

      {hasNote && (
        <span
          aria-hidden="true"
          className={
            'absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-highlight ' +
            // Sobre un día coloreado el ámbar puede fundirse con el fondo:
            // el aro blanco lo mantiene visible sea cual sea el color.
            (marked ? 'ring-2 ring-white' : '')
          }
        />
      )}
    </button>
  );
}
