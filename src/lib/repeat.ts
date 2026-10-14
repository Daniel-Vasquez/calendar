import {
  dateKey,
  daysInMonth,
  formatWeekday,
  isCovered,
  MAX_DATE,
  MONTH_NAMES,
  mondayIndex,
  shiftKey,
  WEEKDAY_LABELS,
  yearOf,
} from './calendar';
import { makeReminder, type Reminder } from './reminder';
import { hasContent, type CalendarData, type DayEntry } from './storage';

/**
 * Repetir un día: la regla que se elige en el modal y las fechas que produce.
 *
 * **Las repeticiones se materializan, no se guardan como regla.** Es la
 * decisión de fondo y conviene entender por qué: en este proyecto un día *es*
 * un documento con su clave, y de eso viven la rejilla, la agenda, la búsqueda,
 * la galería, la sincronía y el cron. Una regla guardada obligaría a los seis a
 * saber expandirla —y al cron a expandirla en el servidor, cada cinco minutos,
 * para todo el mundo—. Copiar los días deja todo eso intacto y además da algo
 * que una regla no da: cada instancia se puede editar o borrar por su cuenta,
 * que es lo que la gente quiere el día que una de las copias cambia de hora.
 *
 * El precio es que no hay «editar la serie»: son días independientes desde el
 * momento en que nacen. Está escrito en el planificador.
 *
 * Este archivo es aritmética de fechas y nada más: no toca `window`, no sabe de
 * React y no habla con el servidor.
 */

export type RepeatMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export type RepeatRule = {
  mode: RepeatMode;
  /** `custom`: días de la semana, 0 = lunes … 6 = domingo. Como `mondayIndex`. */
  weekdays: number[];
  /** `custom`: días del mes, del 1 al 31. */
  monthdays: number[];
};

export const NO_REPEAT: RepeatRule = { mode: 'none', weekdays: [], monthdays: [] };

/**
 * Tope de instancias por repetición.
 *
 * El límite real es el propio calendario —«cada día» desde el 1 de enero de
 * 2026 son 729 días y no cabe más—, así que esto no recorta ningún caso
 * legítimo: está para que un error de cálculo no se convierta en miles de
 * documentos antes de que nadie lo note.
 */
export const MAX_REPEAT = 800;

/** ¿Pide esta regla crear algo? */
export function repeats(rule: RepeatRule): boolean {
  if (rule.mode === 'none') return false;
  if (rule.mode !== 'custom') return true;
  return rule.weekdays.length > 0 || rule.monthdays.length > 0;
}

/**
 * Los rótulos del desplegable, con el día de origen dentro.
 *
 * Se componen aquí y no en el componente porque dependen de la fecha —«cada
 * semana el jueves» no se puede escribir sin saber qué día es— y eso es
 * aritmética, no presentación.
 */
export function repeatOptions(key: string): { id: RepeatMode; label: string }[] {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = formatWeekday(key).toLowerCase();
  const monthName = MONTH_NAMES[month - 1].toLowerCase();

  return [
    { id: 'none', label: 'No se repite' },
    { id: 'daily', label: 'Cada día' },
    { id: 'weekly', label: `Cada semana el ${weekday}` },
    { id: 'monthly', label: `Cada mes el día ${day}` },
    { id: 'yearly', label: `Anualmente el ${day} de ${monthName}` },
    { id: 'custom', label: 'Personalizado' },
  ];
}

/**
 * Las fechas que genera una regla, en orden y **sin incluir la de origen**.
 *
 * Todas caen dentro de los años que cubre el calendario y van hacia delante:
 * repetir un día es programarlo en adelante, no reescribir el pasado.
 *
 * Dos decisiones de calendario que no son obvias y que conviene no «arreglar»
 * sin pensarlo dos veces:
 *
 * - **El día 31 salta los meses que no lo tienen**, en vez de caer en el 28 o
 *   el 30. Recolocarlo cambiaría la fecha que la persona eligió sin decírselo,
 *   y es lo que hace el estándar de calendarios (`BYMONTHDAY` del RFC 5545).
 * - **El 29 de febrero salta los años no bisiestos**, por lo mismo.
 */
export function repeatKeys(from: string, rule: RepeatRule): string[] {
  if (!repeats(rule) || !isCovered(from)) return [];

  const [year, month, day] = from.split('-').map(Number);
  const keys: string[] = [];

  const push = (key: string) => {
    if (key > from && key <= MAX_DATE && isCovered(key)) keys.push(key);
  };

  switch (rule.mode) {
    case 'daily':
      for (let key = shiftKey(from, 1); key <= MAX_DATE; key = shiftKey(key, 1)) {
        push(key);
        if (keys.length >= MAX_REPEAT) break;
      }
      break;

    case 'weekly':
      for (let key = shiftKey(from, 7); key <= MAX_DATE; key = shiftKey(key, 7)) {
        push(key);
        if (keys.length >= MAX_REPEAT) break;
      }
      break;

    case 'monthly': {
      // Se avanza por índice de mes y no sumando días: sumar treinta se
      // desfasaría, y sumar «un mes» con `Date` desborda al mes siguiente
      // justo en los casos que aquí hay que saltar.
      for (let step = 1; step <= 12 * 4; step++) {
        const target = new Date(year, month - 1 + step, 1);
        if (dateKey(target.getFullYear(), target.getMonth(), 1) > MAX_DATE) break;
        if (day > daysInMonth(target.getFullYear(), target.getMonth())) continue;
        push(dateKey(target.getFullYear(), target.getMonth(), day));
      }
      break;
    }

    case 'yearly':
      for (let next = year + 1; next <= yearOf(MAX_DATE); next++) {
        if (day > daysInMonth(next, month - 1)) continue;
        push(dateKey(next, month - 1, day));
      }
      break;

    case 'custom': {
      const weekdays = new Set(rule.weekdays);
      const monthdays = new Set(rule.monthdays);
      for (let key = shiftKey(from, 1); key <= MAX_DATE; key = shiftKey(key, 1)) {
        const [y, m, d] = key.split('-').map(Number);
        // La unión y no la intersección: son dos controles independientes, y
        // «los lunes que además sean día 1» no encajaría casi nunca.
        const encaja =
          weekdays.has(mondayIndex(new Date(y, m - 1, d))) || monthdays.has(d);
        if (encaja) push(key);
        if (keys.length >= MAX_REPEAT) break;
      }
      break;
    }
  }

  return keys;
}

/** Cómo se lee una regla ya elegida, para contarla en la interfaz. */
export function describeRule(rule: RepeatRule): string {
  if (rule.mode !== 'custom') return '';

  const partes: string[] = [];
  if (rule.weekdays.length) {
    const nombres = [...rule.weekdays]
      .sort((a, b) => a - b)
      .map((index) => WEEKDAY_LABELS[index].toLowerCase());
    partes.push(nombres.length === 1 ? `los ${nombres[0]}` : `los ${nombres.join(', ')}`);
  }
  if (rule.monthdays.length) {
    const dias = [...rule.monthdays].sort((a, b) => a - b).join(', ');
    partes.push(rule.monthdays.length === 1 ? `el día ${dias}` : `los días ${dias}`);
  }
  return partes.join(' y ');
}

/**
 * El día que se copia en cada instancia.
 *
 * Hereda la marca, el color, la nota, las etiquetas y los recordatorios. **No
 * hereda las imágenes**, y no es un olvido: un adjunto vive en Cloudinary bajo
 * la clave de *su* día (`uploads/users/{userId}/{key}/{index}`), así que
 * copiarlo de verdad es volver a subirlo una vez por instancia. Arrastrar solo
 * la referencia sería peor que no copiar nada: el servidor resuelve una
 * referencia que llega a otro día con un `rename`, o sea **moviendo** el
 * archivo, y la primera subida de la cola dejaría al día original sin su
 * imagen. Ver `api/images.ts` y la nota de la tanda 8.
 *
 * Los recordatorios se rehacen con `makeReminder` para la fecha nueva —el
 * instante absoluto es otro— y nacen **con identidad propia y sin rastro**: son
 * avisos distintos en días distintos, no el mismo aviso visto dos veces, así
 * que no heredan ni el `id` ni el `sent` ni el `done`.
 */
export function instanceOf(entry: DayEntry, key: string): DayEntry {
  const reminders = (entry.reminders ?? []).flatMap((reminder) => {
    const copia = makeReminder(key, reminder.time, reminder.text ?? '');
    return copia ? [copia] : [];
  });

  return {
    marked: entry.marked,
    note: entry.note,
    color: entry.color,
    ...(reminders.length ? { reminders } : {}),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
  };
}

export type RepeatResult = {
  data: CalendarData;
  /** Días creados. */
  created: string[];
  /** Días que ya tenían algo y se han dejado en paz. */
  skipped: string[];
};

/**
 * Copia un día en todas las fechas que diga la regla.
 *
 * **Un día que ya tiene algo no se toca.** Es la regla más importante de aquí:
 * «cada día» durante dos años pasa por encima de 729 fechas, y entre ellas
 * están los cumpleaños, las vacaciones y las notas de todo el año. Pisarlas
 * sería la peor forma de perder datos que este proyecto podría tener, y por eso
 * se cuentan y se dicen en vez de resolverse en silencio.
 */
export function applyRepeat(
  data: CalendarData,
  from: string,
  entry: DayEntry,
  rule: RepeatRule,
): RepeatResult {
  if (!repeats(rule) || !hasContent(entry)) return { data, created: [], skipped: [] };

  const next = { ...data };
  const created: string[] = [];
  const skipped: string[] = [];

  for (const key of repeatKeys(from, rule)) {
    const actual = next[key];
    if (actual && hasContent(actual)) {
      skipped.push(key);
      continue;
    }
    next[key] = instanceOf(entry, key);
    created.push(key);
  }

  return { data: created.length ? next : data, created, skipped };
}

/** ¿Lleva este día imágenes que no van a viajar a las copias? Lo avisa la interfaz. */
export function dropsImages(entry: DayEntry): boolean {
  return (entry.imageCount ?? entry.images?.length ?? 0) > 0;
}

/** Los recordatorios de un día, para contarlos en el aviso de la interfaz. */
export function reminderCount(reminders?: Reminder[]): number {
  return reminders?.length ?? 0;
}
