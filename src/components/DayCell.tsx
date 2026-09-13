import { colorHex } from '../lib/palette';
import type { DayTimeState } from '../lib/calendar';
import { imageCount, type DayEntry } from '../lib/storage';

type Props = {
  day: number;
  isWeekend: boolean;
  entry?: DayEntry;
  timeState: DayTimeState;
  /** Clave `YYYY-MM-DD`; queda en el DOM para localizar la casilla al navegar. */
  dateKey: string;
  label: string;
  /** Encabezado del popover de nota; `label` añade además el estado temporal. */
  dateLabel: string;
  /** 0 = lunes … 6 = domingo. Decide hacia dónde se ancla el popover. */
  weekday: number;
  /** 0 en la única casilla tabulable del mes, -1 en el resto (ver MonthCard). */
  tabIndex: number;
  /** `extend` avisa de que el clic traía Shift: marcar rango, no abrir el día. */
  onSelect: (extend: boolean) => void;
};

const BASE =
  'relative flex aspect-square w-full items-center justify-center rounded-lg text-sm font-semibold ' +
  'transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/**
 * Aparición compartida por la tarjeta de la nota y su punta: crece un poco
 * desde la casilla mientras entra en opacidad.
 *
 * `pointer-events-none` es imprescindible: la tarjeta se dibuja justo encima
 * de la fila superior, así que sin él robaría el cursor a la casilla que la
 * abre y el hover parpadearía al alternar entre ambas.
 */
const REVEAL =
  'pointer-events-none scale-95 opacity-0 transition duration-150 ease-out ' +
  'group-hover:scale-100 group-hover:opacity-100 ' +
  'group-has-[:focus-visible]:scale-100 group-has-[:focus-visible]:opacity-100 ' +
  'motion-reduce:transition-none';

/**
 * El popover mide bastante más que una casilla: en las columnas de los
 * extremos se ancla por su borde —y escala desde esa misma esquina— para no
 * desbordar la tarjeta del mes ni el ancho de la pantalla.
 */
function popoverAlign(weekday: number): string {
  if (weekday <= 1) return 'left-0 origin-bottom-left';
  if (weekday >= 5) return 'right-0 origin-bottom-right';
  return 'left-1/2 -translate-x-1/2 origin-bottom';
}

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
        ? 'bg-raised/40 font-medium text-ink-muted hover:bg-edge'
        : 'bg-raised font-medium text-ink-soft hover:bg-edge';

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

export default function DayCell({
  day,
  isWeekend,
  entry,
  timeState,
  dateKey,
  label,
  dateLabel,
  weekday,
  tabIndex,
  onSelect,
}: Props) {
  const marked = entry?.marked ?? false;
  const note = entry?.note ?? '';
  // La cuenta llega con el día; las imágenes en sí puede que aún no estén
  // descargadas en este navegador, así que no sirven para contar.
  const total = imageCount(entry);
  const reminder = entry?.reminder;
  // Una imagen sin texto también es una nota, y una hora sola también:
  // cualquiera de las tres enciende el punto y el popover.
  const hasNote = Boolean(note || total || reminder);
  // Para la vista previa vale lo primero que haya: la imagen completa si está
  // aquí, y si no la miniatura que sí viaja con el día.
  const preview = entry?.images?.[0] ?? entry?.thumb;
  const isToday = timeState === 'today';

  const { className, style, solid } = getDayStyles(timeState, marked, isWeekend, entry?.color);

  // El popover vive fuera del botón: los días pasados atenúan el suyo con
  // `opacity`, y anidado heredaría ese desvanecido.
  return (
    <div role="gridcell" className="group relative">
      <button
        type="button"
        onClick={(event) => onSelect(event.shiftKey)}
        data-date={dateKey}
        tabIndex={tabIndex}
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

        {/* La campana vive arriba a la derecha, lejos del punto del día
            marcado: las dos cosas pueden coincidir en la misma casilla.

            El icono es decorativo, así que la hora se dice aparte: el
            `aria-label` lo pone MonthCard y no sabe nada del recordatorio. */}
        {reminder && <span className="sr-only">, aviso a las {reminder.time}</span>}
        {reminder && (
          <svg
            aria-hidden="true"
            width="9"
            height="9"
            viewBox="0 0 16 16"
            fill="none"
            className={'absolute top-1 right-1 ' + (solid ? 'text-white' : 'text-ink-muted')}
          >
            <path
              d="M8 2a4 4 0 00-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 00-4-4z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M6.4 13a1.7 1.7 0 003.2 0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
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

      {/* La nota completa se lee en el modal; esta vista previa es decorativa
          y el lector de pantalla ya recibe el día por el `aria-label`. */}
      {hasNote && (
        <>
          <div
            aria-hidden="true"
            className={`${REVEAL} absolute bottom-full z-30 mb-2 w-52 ${popoverAlign(weekday)}`}
          >
            <div className="rounded-xl border border-edge bg-raised p-3 text-left shadow-lg">
              <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                {dateLabel}
              </p>
              {reminder && (
                <p className="mt-1 text-[11px] font-semibold text-accent-ink-strong">
                  Aviso a las {reminder.time}
                </p>
              )}
              {/* Solo asoma la primera imagen; el resto se cuenta encima. */}
              {total > 0 && preview && (
                <span className="relative mt-2 block">
                  <img src={preview} alt="" className="h-24 w-full rounded-lg object-cover" />
                  {total > 1 && (
                    <span className="absolute right-1.5 bottom-1.5 rounded-md bg-scrim/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      +{total - 1}
                    </span>
                  )}
                </span>
              )}
              {note && (
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed whitespace-pre-line break-words text-ink-soft">
                  {note}
                </p>
              )}
            </div>
          </div>

          {/* Punta hacia la casilla. Va por encima de la tarjeta para tapar con
              su relleno blanco el tramo de borde que cruza y dejar una muesca
              limpia; el giro conserva el origen central para no descolocarse. */}
          <span
            aria-hidden="true"
            className={`${REVEAL} absolute bottom-full left-1/2 z-40 mb-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-r border-b border-edge bg-raised`}
          />
        </>
      )}
    </div>
  );
}
