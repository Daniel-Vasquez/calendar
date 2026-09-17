import { DEFAULT_COLOR, type ColorId } from './palette';
import {
  compareReminders,
  MAX_REMINDERS_PER_DAY,
  reminderState,
  tombsFor,
  touchReminder,
  type Reminder,
  type ReminderState,
} from './reminder';
import { hasContent, type CalendarData, type DayEntry } from './storage';

/**
 * La vista de recordatorios, vista desde los datos.
 *
 * No hay ninguna colección de recordatorios: los avisos viven dentro de su día,
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
  /** Las etiquetas del día. Son del día, no del aviso; ver `tags.ts`. */
  tags?: string[];
  /**
   * ¿Es el primero de su día en la lista? Lo mira la tarjeta para no repetir la
   * fecha entera en cada una de las cuatro seguidas que puede tener un día.
   *
   * Se calcula aquí y no al pintar porque depende del **orden**, que es asunto
   * de este archivo: quien pinta recibe una lista ya ordenada y no tiene por
   * qué volver a razonar sobre ella.
   */
  first: boolean;
};

/**
 * Todos los avisos del calendario, en orden cronológico.
 *
 * `YYYY-MM-DD` es de ancho fijo, así que ordenar las claves como texto ya da el
 * orden por día. **Dentro del día manda `compareReminders`**: desde la tanda 9
 * un día puede tener varios, y antes esta línea no hacía falta porque no había
 * nada que ordenar.
 */
export function collectReminders(data: CalendarData, now: number = Date.now()): ReminderItem[] {
  return Object.keys(data)
    .sort()
    .flatMap((key) => {
      const entry = data[key];
      const reminders = entry.reminders;
      if (!reminders?.length) return [];

      // La lista se guarda ya ordenada, pero ordenar aquí no cuesta nada y
      // hace que esta función no dependa de que nadie se haya saltado nunca
      // `upsertReminder`.
      const sorted = [...reminders].sort(compareReminders);
      return sorted.map((reminder, index) => ({
        key,
        reminder,
        note: entry.note,
        marked: entry.marked,
        color: entry.color,
        state: reminderState(reminder, now),
        done: Boolean(reminder.done),
        first: index === 0,
        ...(entry.tags?.length ? { tags: entry.tags } : {}),
      }));
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
 *
 * **`first` se recalcula después de partir.** Los dos avisos de un mismo día
 * pueden caer uno a cada lado del corte —las 9:00 ya pasaron, las 18:30 no—, y
 * el que abre cada sección tiene que enseñar su fecha aunque no fuera el
 * primero de su día en la lista entera.
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
  return { upcoming: markFirst(upcoming), past: markFirst(past) };
}

/** Marca como primero de su día al que abre cada racha de la misma fecha. */
function markFirst(items: ReminderItem[]): ReminderItem[] {
  return items.map((item, index) => ({ ...item, first: items[index - 1]?.key !== item.key }));
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

/** Los avisos de un día, o una lista vacía. Ahorra el `?? []` por todas partes. */
export function remindersOf(data: CalendarData, key: string): Reminder[] {
  return data[key]?.reminders ?? [];
}

/** ¿Cabe otro aviso en este día? Lo pregunta la interfaz antes de ofrecerlo. */
export function hasRoom(data: CalendarData, key: string): boolean {
  return remindersOf(data, key).length < MAX_REMINDERS_PER_DAY;
}

/**
 * Añade un aviso a un día, o sustituye al que ya tuviera ese `id`.
 *
 * Es la vía de escritura de la página de recordatorios, y carga con las dos
 * reglas que el modal del día ya aplicaba por su cuenta:
 *
 * 1. **Un día que no existía nace** si se le pone un aviso. Sin marca, sin nota
 *    y sin imágenes: un día que solo existe por sus recordatorios es legítimo, y
 *    `hasContent` lo reconoce como tal.
 * 2. La lista se guarda **ordenada por hora**, que es de lo que vive
 *    `sameReminders` para poder comparar posición a posición.
 *
 * **Un día lleno no acepta más.** Se devuelve el calendario intacto en vez de
 * tirar el más viejo: quien llama pregunta antes con `hasRoom` y lo dice, y
 * descartar en silencio un aviso que alguien acaba de escribir sería peor que
 * no dejarle escribirlo.
 *
 * Devuelve el mismo objeto que recibe cuando no hay nada que cambiar, para que
 * React no repinte —ni la sincronía encole— un cambio que no existe.
 */
export function upsertReminder(
  data: CalendarData,
  key: string,
  reminder: Reminder,
): CalendarData {
  const entry = data[key];
  const current = entry?.reminders ?? [];
  const index = current.findIndex((item) => item.id === reminder.id);

  if (index === -1 && current.length >= MAX_REMINDERS_PER_DAY) return data;

  const reminders =
    index === -1
      ? [...current, reminder].sort(compareReminders)
      : current.map((item, i) => (i === index ? reminder : item)).sort(compareReminders);

  const base: DayEntry = entry ?? { marked: false, note: '', color: DEFAULT_COLOR };
  // Si este aviso tenía lápida, acaba de resucitar y la lápida sobra. La fusión
  // llegaría a lo mismo por la fecha, pero dejarla aquí sería mandar al servidor
  // un aviso y su esquela en el mismo documento.
  const removed = (base.removedReminders ?? []).filter((tomb) => tomb.id !== reminder.id);

  const next: DayEntry = { ...base, reminders };
  if (removed.length) next.removedReminders = removed;
  else delete next.removedReminders;

  return { ...data, [key]: next };
}

/**
 * Quita un aviso de un día **y deja su lápida**.
 *
 * La lápida no es opcional: sin ella, el dispositivo que todavía tenga el aviso
 * lo resucitaría en la siguiente fusión, porque desde el otro lado «este aviso
 * ya no está» y «este aviso nunca existió» se ven igual. Ver `reminder.ts`.
 *
 * Si era el último y el día se queda sin nada más, **el día desaparece**: un día
 * vacío no se guarda, igual que hace `handleSave` en el calendario. Y entonces
 * la lápida se va con él, que es lo correcto — de no resucitarlo se encarga la
 * del día entero, que ya existía. Mientras queden otros avisos, o nota, o
 * imágenes, el día se queda donde está con uno menos y su esquela dentro.
 */
export function removeReminder(data: CalendarData, key: string, id: string): CalendarData {
  const entry = data[key];
  if (!entry?.reminders?.some((item) => item.id === id)) return data;

  const reminders = entry.reminders.filter((item) => item.id !== id);
  const removed = tombsFor(entry.reminders, reminders, entry.removedReminders);

  const { reminders: _quitados, removedReminders: _lapidas, ...rest } = entry;
  const next: DayEntry = {
    ...rest,
    ...(reminders.length ? { reminders } : {}),
    ...(removed.length ? { removedReminders: removed } : {}),
  };

  const result = { ...data };
  if (hasContent(next)) result[key] = next;
  else delete result[key];
  return result;
}

/**
 * Mueve **un** aviso de un día a otro. El recordatorio ya viene construido para
 * su fecha nueva —`makeReminder` recalcula el instante absoluto—, así que aquí
 * solo queda quitarlo del día de origen.
 *
 * **Ya no pisa lo que hubiera en el destino.** Hasta la tanda 9 un día tenía
 * como mucho un aviso y mover uno encima borraba al que estaba; ahora se suma a
 * su lista. Es el cambio de comportamiento más visible de toda la tanda.
 */
export function moveReminder(
  data: CalendarData,
  from: string,
  to: string,
  reminder: Reminder,
): CalendarData {
  if (from === to) return upsertReminder(data, to, reminder);
  return upsertReminder(removeReminder(data, from, reminder.id), to, reminder);
}

/**
 * Marca o desmarca un aviso como hecho, conservando todo lo demás.
 *
 * No pasa por `makeReminder` a propósito: ese recalcula el instante y suelta
 * `sent`, y dar algo por hecho no mueve nada de eso. Es el único campo que
 * cambia — y solo en el aviso que se nombra, no en sus vecinos del mismo día.
 */
export function withDone(
  data: CalendarData,
  key: string,
  id: string,
  done: boolean,
): CalendarData {
  const reminder = data[key]?.reminders?.find((item) => item.id === id);
  if (!reminder) return data;
  if (Boolean(reminder.done) === done) return data;

  const { done: _previo, ...rest } = reminder;
  // `touchReminder` y no `makeReminder`: ese recalcula el instante y suelta
  // `sent`, y dar algo por hecho no mueve ninguna de las dos cosas. Pero sí es
  // una edición, así que la marca tiene que avanzar o la fusión no la vería.
  return upsertReminder(data, key, touchReminder(done ? { ...rest, done: Date.now() } : rest));
}
