import { useEffect, useId, useRef, useState } from 'react';
import { formatLongDate, formatWeekday, isInQuarter, YEAR } from '../lib/calendar';
import {
  DEFAULT_REMINDER_TIME,
  defaultReminderText,
  isTime,
  makeReminder,
  MAX_REMINDER_TEXT,
  type Reminder,
} from '../lib/reminder';
import { isDateKey } from '../lib/wire';
import { useDialog } from './useDialog';

type Props = {
  /**
   * Día en el que está el aviso ahora, o `null` si se está creando uno. Es lo
   * único que distingue los dos modos de esta pantalla.
   */
  dateKey: string | null;
  /** El aviso que se edita. Ausente al crear. */
  reminder?: Reminder;
  /** Día que se propone al crear: hoy, si el calendario lo cubre. */
  defaultKey: string;
  /**
   * La nota de un día cualquiera. Se pregunta por el **día elegido**, no por el
   * de origen: sin texto propio, lo que se manda es la nota del día en el que
   * el aviso acabe, así que el marcador de posición tiene que seguir a la fecha.
   */
  noteOf: (key: string) => string;
  /** ¿Tiene ya aviso este día? Se pregunta por el destino, para avisar antes. */
  hasReminder: (key: string) => boolean;
  /** Botón desde el que se abrió: a él vuelve el foco al cerrarse. */
  triggerRef: React.RefObject<HTMLElement | null>;
  onSave: (from: string | null, to: string, reminder: Reminder) => void;
  onDelete: (key: string) => void;
  onClose: () => void;
};

const FIELD =
  'w-full rounded-xl border border-edge bg-raised px-4 py-2.5 text-sm text-ink ' +
  'placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none';

const ACTION =
  'rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

/**
 * Alta y edición rápida de un recordatorio, sin pasar por el día.
 *
 * Es deliberadamente más estrecho que `DayModal`: aquí solo se tocan las tres
 * cosas del aviso —fecha, hora y texto—, y lo demás del día (la marca, el
 * color, la nota, los adjuntos) se queda como está o nace vacío. Para eso está
 * el enlace "Ver en el calendario", que lleva al modal completo.
 *
 * **La fecha se puede cambiar, y eso mueve el aviso de día.** No es un detalle:
 * el recordatorio vive dentro de su día, así que cambiar la fecha lo saca de
 * uno y lo mete en otro, con las consecuencias que documenta `moveReminder`.
 */
export default function ReminderModal({
  dateKey,
  reminder,
  defaultKey,
  noteOf,
  hasReminder,
  triggerRef,
  onSave,
  onDelete,
  onClose,
}: Props) {
  /** Sin día de origen se está creando: los campos nacen con lo propuesto. */
  const creating = dateKey === null;

  const [day, setDay] = useState(dateKey ?? defaultKey);
  const [time, setTime] = useState(reminder?.time ?? DEFAULT_REMINDER_TIME);
  const [text, setText] = useState(reminder?.text ?? '');
  const titleId = useId();
  const dayId = useId();
  const timeId = useId();
  const textId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  useDialog(panelRef, onClose);

  // Al cerrar, el foco vuelve al botón que lo abrió. Al abrir entra en la X si
  // se está editando —donde lo que importa es leer lo que ya hay— y en el texto
  // si se está creando, que es lo primero que hay que escribir.
  useEffect(() => {
    if (creating) textRef.current?.focus();
    else closeRef.current?.focus();
    const trigger = triggerRef.current;
    return () => trigger?.focus();
  }, [creating, triggerRef]);

  const validDay = isDateKey(day) && isInQuarter(day);
  const validTime = isTime(time);
  const moves = validDay && !creating && day !== dateKey;
  /** El día elegido ya tenía aviso y solo cabe uno: se avisa antes de pisarlo. */
  const overwrites = validDay && day !== dateKey && hasReminder(day);
  const placeholder = (validDay && defaultReminderText(noteOf(day))) || 'Recordatorio del día';
  /**
   * El día que encabeza la pantalla. Editando manda el de origen, que es de
   * donde se viene; creando no hay origen y se enseña el elegido, que va
   * cambiando con el campo.
   */
  const heading = dateKey ?? (validDay ? day : null);

  function save() {
    if (!validDay || !validTime) return;
    // Al mudarse de día no se hereda nada del anterior: el instante es otro, y
    // con él la respuesta a «¿ya salió?» y a «¿ya está hecho?». Pasarle el
    // previo dejaría un aviso nuevo marcado como enviado, que no sonaría nunca.
    const next = makeReminder(day, time, text, moves ? undefined : reminder);
    if (next) onSave(dateKey, day, next);
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-panel-in max-h-full w-11/12 max-w-lg overflow-y-auto rounded-2xl border border-edge bg-canvas p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {heading ? formatWeekday(heading) : 'Sin fecha'}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink">
              {creating ? 'Nuevo recordatorio' : 'Editar recordatorio'}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {heading ? formatLongDate(heading) : `Elige un día de ${YEAR}`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mt-1 -mr-1 rounded-lg p-2 text-ink-muted transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={dayId} className="mb-1.5 block text-xs font-medium text-ink-muted">
              Fecha
            </label>
            <input
              id={dayId}
              type="date"
              value={day}
              min={`${YEAR}-01-01`}
              max={`${YEAR}-12-31`}
              onChange={(event) => setDay(event.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor={timeId} className="mb-1.5 block text-xs font-medium text-ink-muted">
              Hora
            </label>
            <input
              id={timeId}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={FIELD}
            />
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor={textId} className="mb-1.5 block text-xs font-medium text-ink-muted">
            Texto del aviso
          </label>
          <input
            ref={textRef}
            id={textId}
            type="text"
            value={text}
            maxLength={MAX_REMINDER_TEXT}
            placeholder={placeholder}
            onChange={(event) => setText(event.target.value)}
            className={FIELD}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            {text.trim()
              ? 'Se manda por Telegram a la hora que pongas.'
              : `Sin texto se manda la nota: «${placeholder}».`}
          </p>
        </div>

        {/* Los avisos que puede dar esta pantalla, de más grave a menos. */}
        {!validDay && (
          <p role="alert" className="mt-3 text-xs font-medium text-highlight">
            El calendario solo cubre {YEAR}: elige un día de ese año.
          </p>
        )}
        {!validTime && (
          <p role="alert" className="mt-3 text-xs font-medium text-highlight">
            Falta la hora: sin ella el aviso no se guarda.
          </p>
        )}
        {overwrites && (
          <p className="mt-3 text-xs font-medium text-highlight">
            El {formatLongDate(day)} ya tiene un recordatorio y solo cabe uno: si guardas, se
            sustituye por este.
          </p>
        )}
        {moves && !overwrites && (
          <p className="mt-3 text-xs text-ink-soft">
            El aviso se moverá al {formatLongDate(day)}.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {/* Al crear no hay nada que borrar: el hueco mantiene a Guardar en su
              sitio, a la derecha, en vez de moverlo entre las dos pantallas. */}
          {dateKey === null ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => onDelete(dateKey)}
              className={
                ACTION +
                ' border border-edge bg-raised text-highlight hover:bg-highlight-soft focus-visible:ring-highlight'
              }
            >
              Eliminar
            </button>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={
                ACTION + ' border border-edge bg-raised text-ink-soft hover:bg-edge focus-visible:ring-accent'
              }
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!validDay || !validTime}
              className={
                ACTION +
                ' bg-accent text-white enabled:hover:bg-accent-strong focus-visible:ring-accent disabled:opacity-40'
              }
            >
              {creating ? 'Crear' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
