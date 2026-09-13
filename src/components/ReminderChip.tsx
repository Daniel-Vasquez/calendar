import { reminderState, type Reminder, type ReminderState } from '../lib/reminder';
import { REMINDER_LABEL } from '../lib/reminders';

/**
 * Aspecto de la hora del aviso según en qué punto esté. El ámbar queda para lo
 * que se pasó sin enviarse, que es lo único que pide atención; lo ya enviado se
 * apaga, porque enterarse de que un aviso salió no es urgente, y lo hecho más
 * todavía: ahí ya no queda nada por mirar.
 */
const REMINDER_TONE: Record<ReminderState, string> = {
  pending: 'bg-accent/10 text-accent-ink-strong',
  due: 'bg-accent/10 text-accent-ink-strong',
  missed: 'bg-highlight-soft text-highlight',
  sent: 'bg-edge text-ink-muted',
  done: 'bg-edge text-ink-muted',
};

/** Campana, del mismo trazo que el resto de iconos del proyecto. */
export function BellIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2a4 4 0 00-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 00-4-4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6.4 13a1.7 1.7 0 003.2 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * La hora del recordatorio, teñida por su estado.
 *
 * Lo usan la agenda del calendario y la lista de recordatorios: es el mismo
 * dato y merece el mismo aspecto en los dos sitios, o el ámbar de "se pasó"
 * dejaría de significar lo mismo según en qué página se mire.
 */
export default function ReminderChip({ reminder, now }: { reminder: Reminder; now: number }) {
  const state = reminderState(reminder, now);
  return (
    <span
      title={REMINDER_LABEL[state]}
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ' +
        REMINDER_TONE[state]
      }
    >
      <BellIcon />
      {reminder.time}
      <span className="sr-only"> · {REMINDER_LABEL[state]}</span>
    </span>
  );
}
