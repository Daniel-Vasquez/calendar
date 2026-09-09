import { colorHex } from '../lib/palette';
import type { DayTimeState } from '../lib/calendar';
import type { DayEntry } from '../lib/storage';

type Props = {
  day: number;
  isWeekend: boolean;
  entry?: DayEntry;
  timeState: DayTimeState;
  label: string;
  onSelect: () => void;
};

const BASE =
  'group relative flex aspect-square w-full items-center justify-center rounded-lg text-sm font-semibold ' +
  'transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/**
 * Resuelve el aspecto de una celda según su posición en el tiempo.
 *
 * El día actual tiene prioridad visual sobre el color guardado: se pinta con
 * su anillo distintivo aunque esté marcado —el color sigue intacto en
 * localStorage— y lo recupera solo al pasar a día pasado.
 */
function getDayStyles(
  timeState: DayTimeState,
  marked: boolean,
  isWeekend: boolean,
  color?: string,
) {
  const isToday = timeState === 'today';
  const showColor = marked && !isToday;

  const tone = isToday
    ? // El violeta está reservado a hoy, así que basta el relleno para
      // reconocerlo; el anillo del mismo tono lo separa de sus vecinos.
      'bg-today text-white shadow-sm ring-2 ring-today ring-offset-2 ring-offset-surface hover:brightness-110'
    : showColor
      ? 'text-white shadow-sm hover:brightness-90'
      : isWeekend
        ? 'bg-white/40 font-medium text-ink-muted hover:bg-edge'
        : 'bg-white font-medium text-ink-soft hover:bg-edge';

  // Los días pasados conservan su color de fondo; es la opacidad de la celda
  // entera la que lo atenúa para dar la sensación de tiempo transcurrido.
  const fade = timeState === 'past' ? 'opacity-60 hover:opacity-100' : '';

  return {
    // El color marcado es dinámico por día, así que va como estilo en línea:
    // Tailwind no puede generar utilidades para valores decididos en runtime.
    className: `${BASE} ${tone} ${fade}`.trimEnd(),
    style: showColor ? { backgroundColor: colorHex(color) } : undefined,
    // Fondo oscuro (violeta de hoy o color marcado): el texto va en blanco y
    // los puntos necesitan aro para no fundirse con él.
    solid: showColor || isToday,
  };
}

export default function DayCell({ day, isWeekend, entry, timeState, label, onSelect }: Props) {
  const marked = entry?.marked ?? false;
  const hasNote = Boolean(entry?.note);
  const isToday = timeState === 'today';

  const { className, style, solid } = getDayStyles(timeState, marked, isWeekend, entry?.color);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={marked}
      aria-current={isToday ? 'date' : undefined}
      className={className}
      style={style}
    >
      <span className={hasNote ? '-translate-y-0.5' : undefined}>{day}</span>

      {/* Hoy oculta su color de fondo: este punto recuerda que sigue guardado. */}
      {isToday && marked && (
        <span
          aria-hidden="true"
          className="absolute top-1 left-1 h-1.5 w-1.5 rounded-full ring-1 ring-white"
          style={{ backgroundColor: colorHex(entry?.color) }}
        />
      )}

      {hasNote && (
        <span
          aria-hidden="true"
          className={
            'absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-highlight ' +
            // Sobre un día coloreado el ámbar puede fundirse con el fondo:
            // el aro blanco lo mantiene visible sea cual sea el color.
            (solid ? 'ring-2 ring-white' : '')
          }
        />
      )}
    </button>
  );
}
