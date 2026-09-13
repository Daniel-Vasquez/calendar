import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_REMINDER_TIME,
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

/**
 * ¿Hay un Telegram conectado en esta cuenta?
 *
 * Se pregunta una vez por carga de página y se guarda aquí a propósito: el
 * modal se abre y se cierra decenas de veces mientras se planifica un mes, y la
 * respuesta no cambia entre una vez y la siguiente.
 *
 * Un fallo **no** se cachea: si la red falla una vez, la siguiente vuelve a
 * preguntar en lugar de quedarse avisando en falso para siempre.
 */
let telegramConectado: boolean | null = null;

/** Lo llama el panel de ajustes al vincular o desvincular. Ver `TelegramSettings`. */
export function olvidarEstadoTelegram(): void {
  telegramConectado = null;
}

async function hayTelegram(): Promise<boolean> {
  if (telegramConectado !== null) return telegramConectado;
  try {
    const response = await fetch('/api/telegram', { headers: { accept: 'application/json' } });
    if (!response.ok) return false;
    const body = (await response.json()) as { connected?: boolean };
    telegramConectado = Boolean(body.connected);
    return telegramConectado;
  } catch {
    return false;
  }
}

const FIELD =
  'w-full rounded-xl border border-edge bg-raised px-4 py-2.5 text-sm text-ink ' +
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
    case 'done':
      // Se marca desde la lista de recordatorios, no desde aquí; lo que hace
      // falta es que al abrir el día no parezca que el aviso sigue vivo. Y que
      // se sepa que tocar la hora o el texto lo devuelve a pendiente, porque
      // eso es justo lo que hace `makeReminder`.
      return 'Lo diste por hecho, así que no se enviará. Cambiar la hora o el texto lo reactiva.';
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
  /** Sin chat vinculado el aviso se guarda y no llega a ninguna parte. */
  const [sinDestino, setSinDestino] = useState(false);
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

  // Solo se pregunta con el aviso encendido: a quien no pone recordatorios no
  // hay que contarle nada de Telegram.
  useEffect(() => {
    if (!on) {
      setSinDestino(false);
      return;
    }
    let alive = true;
    void hayTelegram().then((listo) => {
      if (alive) setSinDestino(!listo);
    });
    return () => {
      alive = false;
    };
  }, [on]);

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
    const nextTime = next && !time ? DEFAULT_REMINDER_TIME : time;
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
          <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-raised shadow-sm transition-transform peer-checked:translate-x-5" />
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
                ? 'Se manda por Telegram a la hora que pongas.'
                : `Sin texto se manda la nota: «${placeholder}». Llega por Telegram a la hora que pongas.`}
            </p>
          </div>

          {/* El caso callado: la hora se guarda, el cron encuentra el aviso y
              no tiene a dónde mandarlo. Sin este texto, la única señal es que
              nunca suena. */}
          {sinDestino && (
            <p className="text-xs font-medium text-highlight">
              No tienes Telegram conectado, así que este aviso no llegará a
              ninguna parte. Se conecta en Ajustes, en un minuto.
            </p>
          )}

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
