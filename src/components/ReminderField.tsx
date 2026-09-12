import { useEffect, useId, useState } from 'react';
import {
  defaultReminderText,
  isTime,
  makeReminder,
  MAX_REMINDER_TEXT,
  reminderState,
  type Reminder,
} from '../lib/reminder';

type Props = {
  dateKey: string;
  /** La nota tal y como está en el modal: de ahí sale el texto por defecto. */
  note: string;
  value?: Reminder;
  onChange: (next: Reminder | undefined) => void;
};

/** Hora que se propone al encender el aviso. */
const DEFAULT_TIME = '09:00';

/**
 * Mientras no exista la tanda 6 el aviso se guarda pero no sale. Decirlo aquí
 * cuesta una línea y evita que alguien confíe en un mensaje que no va a llegar.
 */
const NOT_WIRED =
  'De momento el aviso solo queda guardado: el envío llega en la próxima tanda.';

const FIELD =
  'w-full rounded-xl border border-edge bg-white px-4 py-2.5 text-sm text-ink ' +
  'placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none';

/**
 * Qué contar de un aviso ya guardado, según en qué punto esté.
 *
 * La fecha de envío se formatea con la del navegador y no con `formatLongDate`:
 * esa parte de una clave `YYYY-MM-DD`, y sacarla de un instante obligaría a
 * pasar por UTC, que de noche enseñaría ya el día siguiente.
 */
const SENT_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
};

function stateLine(reminder: Reminder, now: number): string {
  switch (reminderState(reminder, now)) {
    case 'sent':
      return `Enviado el ${new Date(reminder.sent ?? reminder.at).toLocaleString('es', SENT_FORMAT)}.`;
    case 'due':
      return 'Toca ahora: saldrá en el próximo repaso.';
    case 'missed':
      return 'Se pasó la hora sin enviarse.';
    default:
      return '';
  }
}

/**
 * Recordatorio del día: interruptor, hora y texto.
 *
 * Va aparte de `DayModal` porque el modal ya pasaba de cuatrocientas líneas y
 * esto es un formulario entero con su propio estado de edición.
 *
 * El estado de aquí son las cadenas que se están tecleando; el `Reminder` de
 * verdad lo construye `makeReminder` y vive en el modal. Así el campo puede
 * quedarse a medias —una hora borrada, un texto sin terminar— sin que eso
 * llegue nunca al calendario.
 */
export default function ReminderField({
  dateKey,
  note,
  value,
  onChange,
}: Props) {
  const [on, setOn] = useState(Boolean(value));
  const [time, setTime] = useState(value?.time ?? '');
  const [text, setText] = useState(value?.text ?? '');
  const timeId = useId();
  const textId = useId();

  // El modal se reutiliza entre días: al cambiar de fecha el borrador se
  // resincroniza, igual que hacen la nota y el color.
  useEffect(() => {
    setOn(Boolean(value));
    setTime(value?.time ?? '');
    setText(value?.text ?? '');
    // Solo la fecha: reaccionar también a `value` pisaría lo que se teclea,
    // porque cada pulsación devuelve un `Reminder` nuevo desde el modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  /**
   * Sube el cambio al modal. Una hora a medias —o ninguna— no es un aviso: se
   * emite `undefined` y el campo conserva lo tecleado por si se termina.
   */
  function emit(nextOn: boolean, nextTime: string, nextText: string) {
    onChange(
      nextOn && isTime(nextTime)
        ? (makeReminder(dateKey, nextTime, nextText, value) ?? undefined)
        : undefined,
    );
  }

  function toggle(next: boolean) {
    const nextTime = next && !time ? DEFAULT_TIME : time;
    setOn(next);
    setTime(nextTime);
    emit(next, nextTime, text);
  }

  const placeholder = defaultReminderText(note) || 'Recordatorio del día';
  const status = value ? stateLine(value, Date.now()) : '';

  return (
    <fieldset className="mt-4 rounded-xl border border-edge bg-surface px-4 py-3">
      <legend className="sr-only">Recordatorio</legend>

      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-soft">
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 2a4 4 0 00-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 00-4-4z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M6.4 13a1.7 1.7 0 003.2 0"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          Recordarme este día
        </span>
        <span className="relative inline-flex">
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => toggle(event.target.checked)}
            className="peer sr-only"
          />
          <span className="block h-6 w-11 rounded-full bg-edge transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2" />
          <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
        </span>
      </label>

      {on && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor={timeId}
              className="text-xs font-medium text-ink-muted"
            >
              Hora
            </label>
            <input
              id={timeId}
              type="time"
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                emit(on, event.target.value, text);
              }}
              className={FIELD + " w-auto flex-none"}
            />
          </div>

          <div>
            <label
              htmlFor={textId}
              className="mb-1.5 block text-xs font-medium text-ink-muted"
            >
              Texto del aviso
            </label>
            <input
              id={textId}
              type="text"
              value={text}
              maxLength={MAX_REMINDER_TEXT}
              placeholder={placeholder}
              onChange={(event) => {
                setText(event.target.value);
                emit(on, time, event.target.value);
              }}
              className={FIELD}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              {text.trim()
                ? NOT_WIRED
                : `Sin texto se manda la nota: «${placeholder}». ${NOT_WIRED}`}
            </p>
          </div>

          {!isTime(time) && (
            <p role="alert" className="text-xs font-medium text-highlight">
              Falta la hora: sin ella el aviso no se guarda.
            </p>
          )}

          {status && (
            <p className="text-xs font-medium text-ink-soft">{status}</p>
          )}
        </div>
      )}
    </fieldset>
  );
}
