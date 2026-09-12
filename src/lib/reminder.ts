/**
 * Recordatorio de un día: una hora, un texto y el rastro de si ya salió.
 *
 * Vive dentro del `DayEntry`, igual que la nota o el color, porque es una
 * propiedad del día y no una entidad aparte: un día tiene como mucho un aviso,
 * borrar el día se lo lleva por delante y la sincronía ya sabe mover días.
 *
 * Este archivo lo importan los dos lados —el navegador para editarlo y el
 * servidor para decidir qué toca enviar—, así que no toca `window` ni nada de
 * Node, y no importa nada del proyecto.
 */

export type Reminder = {
  /** Hora local del día, `HH:MM` en 24 h. Es lo que se edita y lo que se ve. */
  time: string;
  /**
   * El mismo instante en milisegundos desde la época.
   *
   * Se guarda **además** de la hora local y no en su lugar: el cron corre en
   * UTC y las claves del calendario son fechas locales, así que ninguno de los
   * dos puede deducir el otro sin saber la zona horaria de quien lo escribió.
   * El absoluto es lo único que ambos lados interpretan igual.
   */
  at: number;
  /** Texto del aviso. Vacío o ausente: se compone con la nota del día. */
  text?: string;
  /** Cuándo salió el aviso, en ms. Ausente mientras no haya salido. */
  sent?: number;
};

/** Tope del texto propio. El aviso es una línea, no una segunda nota. */
export const MAX_REMINDER_TEXT = 200;

/**
 * Cuánto se puede llegar tarde y aún así enviar.
 *
 * Sin un tope, volver a levantar el programador tras tres días caídos
 * dispararía de golpe todos los avisos atrasados. Lo que pase de aquí se da
 * por perdido y se enseña como tal en vez de sonar a destiempo.
 */
export const GRACE_MS = 2 * 60 * 60 * 1000;

/** ¿Es una hora `HH:MM` de un reloj de 24 horas? */
export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Instante absoluto de una hora local en un día concreto.
 *
 * `new Date(año, mes, día, hora, minuto)` construye en la zona del navegador,
 * que es justo lo que se quiere: las 9:00 son las 9:00 de quien las escribe.
 * En el salto de primavera hay horas que no existen y el constructor las
 * desplaza; el aviso suena una hora corrido ese día y no parece grave.
 */
export function toEpoch(key: string, time: string): number {
  const [year, month, day] = key.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/**
 * Sanea un recordatorio venido de fuera: de localStorage, de un archivo
 * importado o del servidor. Devuelve `null` si no hay nada aprovechable, y el
 * día se queda sin aviso en vez de arrastrar un objeto a medias.
 *
 * `at` **no se recalcula** cuando viene: el que lo escribió sabía su zona
 * horaria y este dispositivo puede estar en otra. Solo se deduce de la clave
 * cuando falta, que es lo que pasa con datos anteriores a esta tanda.
 */
export function sanitizeReminder(raw: unknown, key: string): Reminder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  if (!isTime(value.time)) return null;

  const at =
    typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : toEpoch(key, value.time);

  const text = typeof value.text === 'string' ? value.text.trim().slice(0, MAX_REMINDER_TEXT) : '';
  const sent =
    typeof value.sent === 'number' && Number.isFinite(value.sent) && value.sent > 0
      ? value.sent
      : undefined;

  return {
    time: value.time,
    at,
    ...(text ? { text } : {}),
    ...(sent ? { sent } : {}),
  };
}

/**
 * Construye el recordatorio que deja una edición. **Es el único sitio donde se
 * crea uno**, y por eso es el único sitio donde hay que acordarse de dos cosas:
 *
 * 1. `at` se recalcula con la hora nueva. Si no, cambiar las 9:00 por las 18:00
 *    dejaría el absoluto viejo y el cron seguiría mirando las 9:00.
 * 2. `sent` se pierde en cuanto cambia la hora o el texto. Si no, mover un
 *    aviso ya enviado lo dejaría marcado como hecho y no sonaría nunca.
 */
export function makeReminder(
  key: string,
  time: string,
  text: string,
  previous?: Reminder,
): Reminder | null {
  if (!isTime(time)) return null;

  const clean = text.trim().slice(0, MAX_REMINDER_TEXT);
  const untouched = previous?.time === time && (previous?.text ?? '') === clean;

  return {
    time,
    at: toEpoch(key, time),
    ...(clean ? { text: clean } : {}),
    ...(untouched && previous?.sent ? { sent: previous.sent } : {}),
  };
}

/** ¿Dicen lo mismo? Lo usa la sincronía para saber si el día ha cambiado. */
export function sameReminder(a?: Reminder, b?: Reminder): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.time === b.time &&
    a.at === b.at &&
    (a.text ?? '') === (b.text ?? '') &&
    (a.sent ?? 0) === (b.sent ?? 0)
  );
}

/**
 * En qué punto está el aviso. Lo mira la interfaz para pintarlo y lo mirará el
 * cron para decidir qué manda, así que la regla vive una sola vez.
 */
export type ReminderState = 'pending' | 'due' | 'missed' | 'sent';

export function reminderState(reminder: Reminder, now: number = Date.now()): ReminderState {
  if (reminder.sent) return 'sent';
  if (reminder.at > now) return 'pending';
  return now - reminder.at <= GRACE_MS ? 'due' : 'missed';
}

export type DueReminder = { key: string; reminder: Reminder };

/**
 * Los avisos que toca mandar ahora mismo, en orden cronológico.
 *
 * Acepta cualquier mapa de días con la forma mínima —el calendario del
 * navegador o lo que devuelva Mongo— para no atar este archivo a ninguno de
 * los dos.
 */
export function dueReminders(
  data: Record<string, { reminder?: Reminder }>,
  now: number = Date.now(),
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const [key, entry] of Object.entries(data)) {
    const reminder = entry?.reminder;
    if (reminder && reminderState(reminder, now) === 'due') due.push({ key, reminder });
  }
  return due.sort((a, b) => a.reminder.at - b.reminder.at);
}

/**
 * Texto del aviso cuando no se ha escrito uno propio: la primera línea con
 * algo de la nota. Es lo que casi siempre se querría teclear a mano, así que
 * el campo puede quedarse vacío y seguir sirviendo.
 */
export function defaultReminderText(note: string): string {
  const line = note
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  return line ? line.slice(0, MAX_REMINDER_TEXT) : '';
}

/** El texto que se manda de verdad. Nunca vacío: sin nota queda el genérico. */
export function reminderText(reminder: Reminder, note: string): string {
  return reminder.text?.trim() || defaultReminderText(note) || 'Recordatorio del día';
}
