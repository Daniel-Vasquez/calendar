import { DEFAULT_COLOR, type ColorId } from './palette';
import { reminderState, type Reminder, type ReminderState } from './reminder';
import { hasContent, type CalendarData, type DayEntry } from './storage';

/**
 * La vista de recordatorios, vista desde los datos.
 *
 * No hay ninguna colección de recordatorios: un aviso vive dentro de su día,
 * como la nota o el color (ver `reminder.ts`). Este archivo es lo que convierte
 * ese calendario indexado por fecha en la lista que la página necesita, y el
 * único sitio donde se escribe un aviso desde fuera del modal del día.
 *
 * Vive en `lib/` y no en el componente porque son dos preguntas distintas
 * —cómo se ordenan y cómo se guardan— y ninguna de las dos necesita React.
 */

/**
 * Cómo se nombra cada estado en la interfaz. Una sola lista para las dos vistas
 * que los enseñan: el mismo aviso no puede llamarse de dos maneras distintas
 * según desde dónde se mire.
 */
export const REMINDER_LABEL: Record<ReminderState, string> = {
  pending: 'Aviso pendiente',
  due: 'Aviso pendiente de envío',
  missed: 'El aviso se pasó sin enviarse',
  sent: 'Aviso enviado',
  done: 'Hecho',
};

/** Un recordatorio con lo poco que hace falta de su día para pintarlo. */
export type ReminderItem = {
  key: string;
  reminder: Reminder;
  /** Nota del día: de ella sale el texto cuando el aviso no trae uno propio. */
  note: string;
  /** ¿Está el día marcado, y de qué color? Para el punto de la tarjeta. */
  marked: boolean;
  color?: ColorId;
  state: ReminderState;
  /** Lo ha dado por hecho la persona. Es lo que separa las dos pestañas. */
  done: boolean;
};

/**
 * Todos los avisos del calendario, en orden cronológico.
 *
 * `YYYY-MM-DD` es de ancho fijo, así que ordenar las claves como texto ya da el
 * orden por día; dentro del mismo día no hay nada que ordenar, porque un día
 * tiene como mucho un aviso.
 */
export function collectReminders(data: CalendarData, now: number = Date.now()): ReminderItem[] {
  return Object.keys(data)
    .sort()
    .flatMap((key) => {
      const entry = data[key];
      const reminder = entry.reminder;
      if (!reminder) return [];
      return [
        {
          key,
          reminder,
          note: entry.note,
          marked: entry.marked,
          color: entry.color,
          state: reminderState(reminder, now),
          done: Boolean(reminder.done),
        },
      ];
    });
}

/**
 * Parte la lista en lo que está por llegar y lo que ya pasó.
 *
 * Lo próximo va de lo más inminente en adelante, que es el orden en el que se
 * va a necesitar. Lo pasado va **al revés**, de lo más reciente hacia atrás: de
 * un aviso vencido importa el de ayer, no el de hace ocho meses.
 *
 * El corte es el instante del aviso y no su estado: uno que venció hace diez
 * minutos y sigue sin enviarse es pasado aunque el cron aún vaya a mandarlo.
 * Está vencido, y ese es el sitio donde se busca.
 */
export function splitReminders(
  items: ReminderItem[],
  now: number = Date.now(),
): { upcoming: ReminderItem[]; past: ReminderItem[] } {
  const upcoming: ReminderItem[] = [];
  const past: ReminderItem[] = [];
  for (const item of items) {
    if (item.reminder.at >= now) upcoming.push(item);
    else past.unshift(item);
  }
  return { upcoming, past };
}

/** Las tres lentes de la lista. La pestaña activa no se guarda en ningún sitio. */
export type ReminderFilter = 'pending' | 'done' | 'all';

export function matchesFilter(item: ReminderItem, filter: ReminderFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'done' ? item.done : !item.done;
}

/** Cuántos hay de cada clase. Lo enseñan las propias pestañas. */
export function countReminders(items: ReminderItem[]): Record<ReminderFilter, number> {
  const done = items.filter((item) => item.done).length;
  return { all: items.length, done, pending: items.length - done };
}

/**
 * Pone —o quita— el aviso de un día y devuelve el calendario resultante.
 *
 * Es la única vía de escritura de la página de recordatorios, y carga con las
 * dos reglas que el modal del día ya aplicaba por su cuenta:
 *
 * 1. **Un día que no existía nace** si se le pone un aviso. Sin marca, sin nota
 *    y sin imágenes: un día que solo existe por su recordatorio es legítimo, y
 *    `hasContent` lo reconoce como tal.
 * 2. **Un día que se queda sin nada desaparece.** Quitarle el aviso al día que
 *    solo tenía eso lo deja vacío, y un día vacío no se guarda: se borra, igual
 *    que hace `handleSave` en el calendario.
 *
 * Devuelve el mismo objeto que recibe cuando no hay nada que cambiar, para que
 * React no repinte —ni la sincronía encole— un cambio que no existe.
 */
export function withReminder(
  data: CalendarData,
  key: string,
  reminder: Reminder | undefined,
): CalendarData {
  const entry = data[key];

  if (!reminder) {
    if (!entry?.reminder) return data;
    const { reminder: _quitado, ...rest } = entry;
    const next = { ...data };
    if (hasContent(rest)) next[key] = rest;
    else delete next[key];
    return next;
  }

  const base: DayEntry = entry ?? { marked: false, note: '', color: DEFAULT_COLOR };
  return { ...data, [key]: { ...base, reminder } };
}

/**
 * Mueve un aviso de un día a otro. El recordatorio ya viene construido para su
 * fecha nueva —`makeReminder` recalcula el instante absoluto—, así que aquí
 * solo queda vaciar el día de origen.
 *
 * Si el destino ya tenía aviso, lo pierde: un día tiene como mucho uno. Quien
 * llama avisa antes; ver `ReminderModal`.
 */
export function moveReminder(
  data: CalendarData,
  from: string,
  to: string,
  reminder: Reminder,
): CalendarData {
  if (from === to) return withReminder(data, to, reminder);
  return withReminder(withReminder(data, from, undefined), to, reminder);
}

/**
 * Marca o desmarca un aviso como hecho, conservando todo lo demás.
 *
 * No pasa por `makeReminder` a propósito: ese recalcula el instante y suelta
 * `sent`, y dar algo por hecho no mueve nada de eso. Es el único campo que
 * cambia.
 */
export function withDone(data: CalendarData, key: string, done: boolean): CalendarData {
  const reminder = data[key]?.reminder;
  if (!reminder) return data;
  if (Boolean(reminder.done) === done) return data;

  const { done: _previo, ...rest } = reminder;
  return withReminder(data, key, done ? { ...rest, done: Date.now() } : rest);
}
