import { useEffect, useId, useState } from 'react';
import {
  compareReminders,
  DEFAULT_REMINDER_TIME,
  defaultReminderText,
  isTime,
  makeReminder,
  MAX_REMINDER_TEXT,
  MAX_REMINDERS_PER_DAY,
  reminderState,
  type Reminder,
} from '../lib/reminder';

type Props = {
  dateKey: string;
  /** La nota tal y como está en el modal: de ahí sale el texto por defecto. */
  note: string;
  value?: Reminder[];
  onChange: (next: Reminder[]) => void;
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
  'rounded-xl border border-edge bg-raised px-3 py-2 text-sm text-ink ' +
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
      // Lo que hace falta es que al abrir el día no parezca que el aviso sigue
      // vivo, y que se sepa que tocar la hora o el texto lo devuelve a
      // pendiente, porque eso es justo lo que hace `makeReminder`.
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
 * Una fila del editor mientras se teclea.
 *
 * `source` es el aviso del que salió la fila, y es quien guarda lo que no se
 * edita a mano: el `id`, el `sent` que escribió el servidor y el `done` que
 * marcó la persona. Nace con `makeReminder` incluso en una fila recién añadida
 * —por eso el botón de añadir ya propone una hora—, y de ahí sale un `id`
 * estable desde el primer momento, que es lo que necesita React para que una
 * fila no salte de sitio al reordenarse la lista por hora.
 *
 * `time` y `text` viven aparte y como cadenas porque pueden estar a medias: una
 * hora borrada no es un aviso, pero tampoco debe tirar lo que ya se escribió.
 */
type Draft = { source: Reminder; time: string; text: string };

function toDrafts(value: Reminder[] | undefined): Draft[] {
  return (value ?? []).map((source) => ({ source, time: source.time, text: source.text ?? '' }));
}

/**
 * Recordatorios del día: una fila por aviso, más el botón de añadir.
 *
 * Va aparte de `DayModal` porque el modal ya pasaba de cuatrocientas líneas y
 * esto es un formulario entero con su propio estado de edición.
 *
 * **Hasta la tanda 9 esto era un interruptor con una hora y un texto.** El
 * interruptor ha desaparecido y no se echa de menos: encenderlo era la forma de
 * decir «quiero un aviso», y eso ahora lo dice «Añadir recordatorio»; apagarlo
 * era quitarlo, y eso lo dice la papelera de cada fila.
 *
 * El estado de aquí son los borradores; los `Reminder` de verdad los construye
 * `makeReminder` y viven en el modal. Así una fila puede quedarse a medias sin
 * que eso llegue nunca al calendario.
 */
export default function ReminderField({ dateKey, note, value, onChange }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(value));
  /** Sin chat vinculado los avisos se guardan y no llegan a ninguna parte. */
  const [sinDestino, setSinDestino] = useState(false);
  const legendId = useId();

  // El modal se reutiliza entre días: al cambiar de fecha el borrador se
  // resincroniza, igual que hacen la nota y el color.
  useEffect(() => {
    setDrafts(toDrafts(value));
    // Solo la fecha: reaccionar también a `value` pisaría lo que se teclea,
    // porque cada pulsación devuelve una lista nueva desde el modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  // Solo se pregunta con algún aviso en pie: a quien no pone recordatorios no
  // hay que contarle nada de Telegram.
  const alguno = drafts.length > 0;
  useEffect(() => {
    if (!alguno) {
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
  }, [alguno]);

  /**
   * El aviso que deja una fila, o `null` si todavía no es uno.
   *
   * Pasa por `makeReminder` —el único sitio donde se crea un recordatorio— y
   * eso trae de regalo las tres reglas de siempre: el instante se recalcula con
   * la hora, `sent` y `done` se sueltan en cuanto cambia la hora o el texto, y
   * el `id` se conserva.
   */
  function build(draft: Draft): Reminder | null {
    return makeReminder(dateKey, draft.time, draft.text, draft.source);
  }

  /**
   * Sube el cambio al modal. Las filas a medias no viajan: se quedan aquí por
   * si se terminan, y hasta entonces el día no tiene ese aviso.
   *
   * **Lo que sale va ordenado por hora**, aunque las filas se queden donde
   * están. Son dos órdenes distintos a propósito: la lista guardada tiene que
   * ir ordenada —de eso vive `sameReminders`, que compara posición a posición,
   * y sin ello añadir un aviso anterior a los que ya había encolaría una subida
   * en cada recarga— pero reordenar las filas bajo los dedos de quien acaba de
   * teclear una hora sería insufrible.
   */
  function emit(next: Draft[]) {
    setDrafts(next);
    onChange(next.flatMap((draft) => build(draft) ?? []).sort(compareReminders));
  }

  function patch(id: string, change: Partial<Omit<Draft, 'source'>>) {
    emit(drafts.map((draft) => (draft.source.id === id ? { ...draft, ...change } : draft)));
  }

  function add() {
    // Nace ya con hora, que es lo que hacía el interruptor de antes: una fila en
    // blanco obligaría a abrir el reloj para nada las nueve de cada diez veces.
    const fresh = makeReminder(dateKey, DEFAULT_REMINDER_TIME, '');
    if (!fresh) return;
    emit([...drafts, { source: fresh, time: fresh.time, text: '' }]);
  }

  function remove(id: string) {
    emit(drafts.filter((draft) => draft.source.id !== id));
  }

  /**
   * Da un aviso por hecho, o lo devuelve a pendiente.
   *
   * Se escribe en el `source` y no en el aviso ya construido, que es lo que
   * parecería natural: `emit` rehace la lista desde los borradores, así que un
   * `done` puesto fuera de aquí se perdería en la siguiente tecla que alguien
   * pulsara en cualquier otra fila.
   */
  function toggleDone(id: string, done: boolean) {
    emit(
      drafts.map((draft) => {
        if (draft.source.id !== id) return draft;
        const { done: _previo, ...rest } = draft.source;
        return { ...draft, source: done ? { ...rest, done: Date.now() } : rest };
      }),
    );
  }

  const placeholder = defaultReminderText(note) || 'Recordatorio del día';
  const lleno = drafts.length >= MAX_REMINDERS_PER_DAY;
  const now = Date.now();

  return (
    <fieldset className="mt-4 rounded-xl border border-edge bg-surface px-4 py-3">
      <legend id={legendId} className="sr-only">
        Recordatorios
      </legend>

      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-soft">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
        {drafts.length > 0 && (
          <span className="text-xs font-medium text-ink-muted tabular-nums">
            {drafts.length} de {MAX_REMINDERS_PER_DAY}
          </span>
        )}
      </div>

      {drafts.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          Sin avisos. Puedes poner varios el mismo día, cada uno a su hora.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {drafts.map((draft) => {
            const built = build(draft);
            const status = built ? stateLine(built, now) : '';
            return (
              <li
                key={draft.source.id}
                className="rounded-lg border border-edge bg-raised/50 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={draft.time}
                    aria-label="Hora del aviso"
                    onChange={(event) => patch(draft.source.id, { time: event.target.value })}
                    className={FIELD + ' w-auto flex-none'}
                  />
                  <input
                    type="text"
                    value={draft.text}
                    maxLength={MAX_REMINDER_TEXT}
                    placeholder={placeholder}
                    aria-label="Texto del aviso"
                    onChange={(event) => patch(draft.source.id, { text: event.target.value })}
                    className={FIELD + ' min-w-40 flex-1'}
                  />

                  {/* Hecho o pendiente. Solo con un aviso en pie: sin hora
                      válida no hay recordatorio, y no se puede dar por hecho lo
                      que todavía no existe. */}
                  {built && (
                    <label
                      className="flex cursor-pointer items-center"
                      title="Dado por hecho"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(built.done)}
                        onChange={(event) => toggleDone(draft.source.id, event.target.checked)}
                        aria-label={`Dar por hecho el aviso de las ${draft.time}`}
                        className="peer sr-only"
                      />
                      {/* El visto se oculta con `text-transparent`, como en la
                          lista: pintarlo del color del fondo lo dejaría visible
                          en oscuro. */}
                      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-edge bg-raised text-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path
                            d="M2.5 6.3l2.4 2.4L9.6 4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={() => remove(draft.source.id)}
                    // Nombra la hora: con cuatro papeleras seguidas, «Eliminar»
                    // a secas no dice cuál se va a ir.
                    aria-label={
                      isTime(draft.time)
                        ? `Eliminar el aviso de las ${draft.time}`
                        : 'Eliminar este aviso'
                    }
                    className="rounded-md border border-edge bg-raised p-1.5 text-ink-muted transition-colors hover:bg-highlight-soft hover:text-highlight focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.6 8.1h6l.6-8.1"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                {!isTime(draft.time) && (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-highlight">
                    Falta la hora: sin ella este aviso no se guarda.
                  </p>
                )}
                {status && <p className="mt-1.5 text-xs font-medium text-ink-soft">{status}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={lleno}
          className="rounded-lg border border-edge bg-raised px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors enabled:hover:bg-edge enabled:hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40"
        >
          + Añadir recordatorio
        </button>
        {lleno && (
          <span className="text-xs text-ink-muted">
            Es el máximo por día. Borra uno para poner otro.
          </span>
        )}
      </div>

      {drafts.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          Sin texto se manda la nota: «{placeholder}». Llega por Telegram a la hora que pongas.
        </p>
      )}

      {/* El caso callado: la hora se guarda, el cron encuentra el aviso y no
          tiene a dónde mandarlo. Sin este texto, la única señal es que nunca
          suena. Va una vez para el bloque y no por fila: es de la cuenta, no
          del aviso. */}
      {sinDestino && (
        <p className="mt-2 text-xs font-medium text-highlight">
          No tienes Telegram conectado, así que estos avisos no llegarán a ninguna parte. Se conecta
          en Ajustes, en un minuto.
        </p>
      )}
    </fieldset>
  );
}
