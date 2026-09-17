import { formatLongDate, formatWeekday } from './calendar';

/**
 * Los recordatorios de un día: cada uno con su hora, su texto y el rastro de si
 * ya salió.
 *
 * Viven dentro del `DayEntry`, igual que la nota o el color, porque son una
 * propiedad del día y no una entidad aparte: borrar el día se los lleva por
 * delante, y la sincronía ya sabe mover días. Lo que cambió en la tanda 9 es
 * **cuántos caben**: antes uno, ahora una lista ordenada por hora.
 *
 * Este archivo lo importan los dos lados —el navegador para editarlos y el
 * servidor para decidir qué toca enviar—, así que no toca `window` ni nada de
 * Node, y no importa nada del proyecto.
 */

export type Reminder = {
  /**
   * Identidad del aviso **dentro de su día**. No es global y no hace falta que
   * lo sea: nada lo busca sin saber antes de qué día es.
   *
   * Existe desde la tanda 9 y es lo que hizo posible la tanda entera. Hasta
   * entonces la identidad de un aviso *era* la clave de su día —había uno, así
   * que `2026-03-14` lo nombraba sin ambigüedad—, y de eso vivían cuatro cosas
   * que con dos avisos se rompen a la vez: la reclamación del cron, la adopción
   * de `sent` al sincronizar, los ayudantes de escritura de `reminders.ts` y
   * las claves de React. Dos avisos a la misma hora del mismo día son
   * legítimos, así que la hora tampoco servía.
   */
  id: string;
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
  /**
   * Cuándo se dio por hecho, en ms. Ausente mientras siga pendiente.
   *
   * Va aparte de `sent` y no en su lugar porque son dos cosas distintas:
   * `sent` lo escribe **solo** el servidor y dice que el aviso salió; `done` lo
   * escribe **solo** el navegador y dice que la persona ya lo ha resuelto.
   * Mezclarlos rompería la fusión —`sent` se adopta sin arbitrar marcas de
   * tiempo justamente porque nadie de este lado lo toca— y además dejaría sin
   * respuesta la pregunta que hace la lista: ¿esto está hecho o solo ha sonado?
   *
   * Un aviso hecho no se manda: el cron lo excluye igual que a los ya enviados.
   */
  done?: number;
  /**
   * Cuándo se editó por última vez, por el reloj de quien lo editó.
   *
   * Es el árbitro de **su** fusión, y lo que hace posible la tanda 10: hasta
   * entonces la unidad de fusión era el día entero, así que dos dispositivos
   * que tocaban avisos distintos de la misma fecha no se combinaban — ganaba el
   * `updatedAt` más reciente y el trabajo del otro desaparecía.
   *
   * Cero significa «de antes de la tanda 10»: pierde contra cualquier edición
   * con fecha, que es lo correcto, y empata consigo mismo, que también.
   *
   * **No lo tocan ni `sent` ni el cron.** `sent` lo escribe el servidor y no es
   * una edición de nadie; subirlo aquí haría que el servidor le ganara a un
   * cambio local sin subir. Es el mismo cuidado que con `updatedAt`.
   */
  editedAt: number;
};

/**
 * La lápida de un aviso borrado: quién era y cuándo se fue.
 *
 * Sin esto, borrar un recordatorio en el móvil y abrir el portátil —que aún lo
 * tiene— lo resucitaría en la siguiente fusión, porque desde el otro lado un
 * aviso ausente y un aviso que nunca existió son indistinguibles. Es la misma
 * pieza que ya tenían los días, y por la misma razón.
 *
 * Vive fuera de la lista de avisos y no como una marca dentro de ellos: así
 * `reminders` sigue siendo exactamente lo que dice ser —los vivos— y ninguno de
 * los quince sitios que la recorren tiene que acordarse de filtrar. Un fantasma
 * en la rejilla por un filtro olvidado sería peor que el problema que resuelve.
 */
export type RemovedReminder = { id: string; at: number };

/**
 * Hora que se propone al encender un aviso o al crear uno desde la lista. Vive
 * aquí y no en un componente porque ya son dos los que la proponen, y que un
 * sitio sugiera las 9:00 y el otro las 8:00 solo despistaría.
 */
export const DEFAULT_REMINDER_TIME = '09:00';

/** Tope del texto propio. El aviso es una línea, no una segunda nota. */
export const MAX_REMINDER_TEXT = 200;

/**
 * Cuántos avisos caben en un día.
 *
 * Diez, y no seis como las imágenes ni ninguno como antes de la tanda 9. Las
 * imágenes se topan porque pesan; esto son unos cientos de bytes y el límite es
 * de otras dos clases: de **interfaz**, porque una lista de treinta filas en el
 * modal de un día no se lee, y de **Telegram**, que empieza a pedir espera por
 * encima de unos pocos mensajes por segundo al mismo chat — y los avisos de un
 * mismo día pueden vencer todos a la vez.
 */
export const MAX_REMINDERS_PER_DAY = 10;

/**
 * Cuánto dura una lápida de aviso, y cuántas caben.
 *
 * Las de los días no se purgan nunca —está en la deuda— y estas no podían
 * heredar eso: hay hasta diez avisos por día y se borran con soltura, así que
 * sin poda crecerían dentro de cada documento para siempre.
 *
 * Noventa días es holgado: un dispositivo que lleve tres meses sin conectarse y
 * traiga un aviso que alguien borró lo resucitará. A cambio, el que se conecta
 * una vez al mes nunca lo nota. El tope por día es la red de seguridad para
 * quien borre cincuenta avisos en una tarde.
 */
export const TOMB_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_TOMBS_PER_DAY = 20;

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
 * Forma de un identificador de aviso. Estrecha a propósito: el `id` viaja
 * dentro de una consulta a Mongo y de una clave de React, y no hay ninguna
 * razón para aceptar ahí una cadena arbitraria venida de un archivo importado.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Un identificador nuevo. Doce caracteres del UUID, que es de sobra para
 * distinguir como mucho diez elementos dentro de un día.
 *
 * `crypto.randomUUID` necesita contexto seguro en el navegador —lo hay en
 * `localhost` y en producción—, pero el respaldo está igualmente: quedarse sin
 * poder crear un recordatorio por abrir la aplicación por IP sería absurdo.
 */
export function newReminderId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);
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
 * Sanea **un** recordatorio venido de fuera: de localStorage, de un archivo
 * importado o del servidor. Devuelve `null` si no hay nada aprovechable, y ese
 * aviso se cae de la lista en vez de arrastrar un objeto a medias.
 *
 * `at` **no se recalcula** cuando viene: el que lo escribió sabía su zona
 * horaria y este dispositivo puede estar en otra. Solo se deduce de la clave
 * cuando falta, que es lo que pasa con datos anteriores a la tanda 4.
 *
 * El `id` se genera cuando falta o no tiene forma de tal, que es lo que pasa
 * con **todo** lo guardado antes de la tanda 9. Ver `sanitizeReminders`, que es
 * quien se encarga de que además no se repita dentro del día.
 */
export function sanitizeReminder(raw: unknown, key: string): Reminder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  if (!isTime(value.time)) return null;

  const id =
    typeof value.id === 'string' && ID_PATTERN.test(value.id) ? value.id : newReminderId();

  // Cero, no «ahora»: lo guardado antes de la tanda 10 no trae marca, y darle
  // la de este momento la haría ganar a cualquier edición legítima de otro
  // dispositivo solo por haberse leído después.
  const editedAt = stamp(value.editedAt) ?? 0;

  const at =
    typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : toEpoch(key, value.time);

  const text = typeof value.text === 'string' ? value.text.trim().slice(0, MAX_REMINDER_TEXT) : '';
  const sent = stamp(value.sent);
  const done = stamp(value.done);

  return {
    id,
    time: value.time,
    at,
    editedAt,
    ...(text ? { text } : {}),
    ...(sent ? { sent } : {}),
    ...(done ? { done } : {}),
  };
}

/**
 * Sanea la lista de lápidas de un día, y **poda**: fuera las caducadas y, si
 * aún sobran, se queda con las más recientes. Ver `TOMB_TTL_MS`.
 */
export function sanitizeRemovals(raw: unknown, now: number = Date.now()): RemovedReminder[] {
  if (!Array.isArray(raw)) return [];

  const clean: RemovedReminder[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const { id, at } = value as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) continue;
    const when = stamp(at);
    if (!when || now - when > TOMB_TTL_MS) continue;
    seen.add(id);
    clean.push({ id, at: when });
  }

  // De más reciente a más antigua, para que el recorte se lleve las viejas.
  return clean.sort((a, b) => b.at - a.at).slice(0, MAX_TOMBS_PER_DAY);
}

/**
 * Las lápidas que deja una edición: las que ya había, más una por cada aviso
 * que estaba y ha dejado de estar.
 *
 * Lo llaman todos los sitios donde desaparece un recordatorio —el modal del
 * día, la lista, la mudanza—, porque olvidarlo en uno solo basta para que ese
 * borrado se deshaga solo en el siguiente arranque.
 */
export function tombsFor(
  previous: Reminder[] | undefined,
  next: Reminder[] | undefined,
  existing: RemovedReminder[] | undefined,
  now: number = Date.now(),
): RemovedReminder[] {
  const vivos = new Set((next ?? []).map((reminder) => reminder.id));
  const nuevas = (previous ?? [])
    .filter((reminder) => !vivos.has(reminder.id))
    .map((reminder) => ({ id: reminder.id, at: now }));

  if (nuevas.length === 0) return sanitizeRemovals(existing ?? [], now);

  // Las nuevas primero: si hay que recortar, se van las viejas.
  return sanitizeRemovals([...nuevas, ...(existing ?? [])], now);
}

/**
 * Sanea **la lista** de recordatorios de un día, y acepta las dos formas:
 *
 * - la lista de la tanda 9 en adelante;
 * - el objeto suelto de antes, que se envuelve en una lista de uno.
 *
 * Aceptar la vieja no es cortesía: es lo que hace que un `localStorage` de
 * ayer, un archivo exportado en v7 y un documento de Mongo sin migrar sigan
 * valiendo sin un solo caso especial repartido por el proyecto.
 *
 * Devuelve la lista **ordenada, sin identificadores repetidos y recortada** al
 * tope. Un `id` repetido no tira el aviso: se le da uno nuevo. Perder un
 * recordatorio porque otro se llamaba igual sería un mal negocio, y dos avisos
 * idénticos en un día son un dato legítimo.
 */
export function sanitizeReminders(raw: unknown, key: string): Reminder[] {
  const list = Array.isArray(raw) ? raw : [raw];

  const clean: Reminder[] = [];
  const seen = new Set<string>();
  for (const value of list) {
    const reminder = sanitizeReminder(value, key);
    if (!reminder) continue;
    if (seen.has(reminder.id)) reminder.id = newReminderId();
    seen.add(reminder.id);
    clean.push(reminder);
    if (clean.length === MAX_REMINDERS_PER_DAY) break;
  }

  return clean.sort(compareReminders);
}

/** Una marca de tiempo que valga como tal, o nada. */
function stamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * El orden de la lista: por instante, y a igualdad de instante por `id`.
 *
 * El desempate no es un adorno. Dos avisos a la misma hora del mismo día son
 * legítimos, y sin un criterio estable bailarían entre repintados: la lista se
 * reordena en cada escritura, y un orden que cambia solo encolaría cambios que
 * no existen.
 */
export function compareReminders(a: Reminder, b: Reminder): number {
  if (a.at !== b.at) return a.at - b.at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Construye el recordatorio que deja una edición. **Es el único sitio donde se
 * crea uno**, y por eso es el único sitio donde hay que acordarse de tres cosas:
 *
 * 1. `at` se recalcula con la hora nueva. Si no, cambiar las 9:00 por las 18:00
 *    dejaría el absoluto viejo y el cron seguiría mirando las 9:00.
 * 2. `sent` y `done` se pierden en cuanto cambia la hora o el texto. Si no,
 *    mover un aviso ya enviado lo dejaría marcado como salido y no sonaría
 *    nunca; y reprogramar uno ya resuelto lo dejaría tachado sin serlo, que es
 *    la forma de que un aviso nuevo no llegue a ninguna parte.
 * 3. El `id` se **conserva** al editar y se genera al crear. Editar un aviso
 *    tiene que seguir siendo el mismo aviso: de ello dependen la fila que no
 *    salta en la lista, la marca de enviado que llega del servidor y la
 *    reclamación del cron.
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
    id: previous?.id ?? newReminderId(),
    time,
    at: toEpoch(key, time),
    /*
     * Si no ha cambiado nada, tampoco ha cambiado cuándo se cambió.
     *
     * No es una sutileza: `build()` en `ReminderField` llama aquí **en cada
     * pintado** para saber qué emitiría esa fila. Con un `Date.now()` sin
     * condición, cada repintado fabricaría un aviso distinto, `sameReminders`
     * vería un cambio que no existe y la sincronía encolaría el día en bucle.
     */
    editedAt: untouched && previous ? previous.editedAt : Date.now(),
    ...(clean ? { text: clean } : {}),
    ...(untouched && previous?.sent ? { sent: previous.sent } : {}),
    ...(untouched && previous?.done ? { done: previous.done } : {}),
  };
}

/** El mismo aviso, marcado como tocado ahora. Para lo que no pasa por `makeReminder`. */
export function touchReminder(reminder: Reminder): Reminder {
  return { ...reminder, editedAt: Date.now() };
}

/** ¿Dicen lo mismo dos avisos sueltos? */
export function sameReminder(a?: Reminder, b?: Reminder): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.id === b.id &&
    a.time === b.time &&
    a.at === b.at &&
    a.editedAt === b.editedAt &&
    (a.text ?? '') === (b.text ?? '') &&
    (a.sent ?? 0) === (b.sent ?? 0) &&
    (a.done ?? 0) === (b.done ?? 0)
  );
}

/**
 * ¿Dicen lo mismo las dos listas? Lo usa la sincronía para saber si el día ha
 * cambiado.
 *
 * Compara posición a posición, y puede hacerlo porque la lista se ordena al
 * **escribir** y no al pintar: si el orden dependiera de quien mira, dos
 * listas iguales podrían parecer distintas y cada repintado encolaría una
 * subida que no cambia nada.
 */
export function sameReminders(a?: Reminder[], b?: Reminder[]): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((item, i) => sameReminder(item, right[i]));
}

/** Un lado de la fusión: los avisos vivos de un día y sus lápidas. */
export type ReminderSet = { reminders?: Reminder[]; removed?: RemovedReminder[] };

/**
 * Funde los avisos de un día **aviso a aviso**, en vez de quedarse con la
 * versión entera de uno de los dos lados. Es la tanda 10 al completo.
 *
 * Hasta aquí la unidad de fusión era el día: entre dos versiones ganaba la del
 * `updatedAt` más reciente y la otra se perdía con sus avisos dentro. Bastaba
 * con que dos dispositivos tocaran recordatorios **distintos** de la misma
 * fecha sin sincronizar en medio para que uno de los dos trabajos desapareciera.
 *
 * Las reglas, por orden:
 *
 * 1. **Por `id`.** Cada aviso se empareja con el suyo; los que solo están en un
 *    lado entran tal cual.
 * 2. **Gana el `editedAt` mayor**, y un empate lo gana lo local — que es lo que
 *    la persona tiene delante. Es el mismo criterio que arbitra los días, una
 *    planta más abajo.
 * 3. **La lápida gana al aviso si es posterior a su última edición.** Y pierde
 *    si es anterior: eso es alguien que borró algo y luego lo volvió a crear en
 *    otro sitio, y lo último que hizo manda.
 * 4. **`sent` se adopta aparte**, sin arbitrar nada. Lo escribe solo el
 *    servidor, así que no puede chocar con nada de aquí; y como el cron no toca
 *    `editedAt` al marcarlo, el aviso vuelve con la misma marca de siempre y
 *    cualquier comparación lo dejaría fuera. Se exige que sea el mismo instante
 *    (`at`): un aviso movido de hora es otro aviso, y el `sent` del anterior no
 *    le corresponde.
 */
export function mergeReminders(
  local: ReminderSet,
  remote: ReminderSet,
  now: number = Date.now(),
): { reminders: Reminder[]; removed: RemovedReminder[] } {
  /** La lápida más reciente de cada id, mire de qué lado venga. */
  const tumbas = new Map<string, number>();
  for (const tomb of [...(local.removed ?? []), ...(remote.removed ?? [])]) {
    tumbas.set(tomb.id, Math.max(tumbas.get(tomb.id) ?? 0, tomb.at));
  }

  const remotos = new Map((remote.reminders ?? []).map((item) => [item.id, item]));
  const vivos = new Map<string, Reminder>();

  // Los de aquí, arbitrando contra su pareja de allí cuando la haya.
  for (const mine of local.reminders ?? []) {
    const suyo = remotos.get(mine.id);
    vivos.set(mine.id, suyo ? pick(mine, suyo) : mine);
  }
  // Y los que solo existen allí.
  for (const [id, suyo] of remotos) {
    if (!vivos.has(id)) vivos.set(id, suyo);
  }

  const reminders: Reminder[] = [];
  const removed: RemovedReminder[] = [];

  for (const [id, reminder] of vivos) {
    const enterrado = tumbas.get(id);
    if (enterrado !== undefined && enterrado >= reminder.editedAt) {
      // Se borró después de la última edición que conocemos: sigue borrado.
      removed.push({ id, at: enterrado });
      tumbas.delete(id);
      continue;
    }
    // Vive. Si tenía lápida, la edición posterior lo resucitó y la lápida sobra.
    tumbas.delete(id);
    reminders.push(reminder);
  }

  // Las lápidas de avisos que ya no tiene nadie se conservan igual: puede haber
  // un tercer dispositivo que todavía traiga el aviso.
  for (const [id, at] of tumbas) removed.push({ id, at });

  return {
    reminders: reminders.sort(compareReminders),
    removed: sanitizeRemovals(removed, now),
  };
}

/** Quién gana entre dos versiones del mismo aviso, y qué se rescata del otro. */
function pick(mine: Reminder, theirs: Reminder): Reminder {
  const winner = theirs.editedAt > mine.editedAt ? theirs : mine;
  const loser = winner === mine ? theirs : mine;

  // Regla 4: «este aviso ya salió» se adopta venga del lado que venga.
  if (!winner.sent && loser.sent && loser.at === winner.at) {
    return { ...winner, sent: loser.sent };
  }
  return winner;
}

/**
 * En qué punto está el aviso. Lo mira la interfaz para pintarlo y lo mira el
 * cron para decidir qué manda, así que la regla vive una sola vez.
 */
export type ReminderState = 'done' | 'pending' | 'due' | 'missed' | 'sent';

export function reminderState(reminder: Reminder, now: number = Date.now()): ReminderState {
  // Lo primero, por encima incluso de `sent`: darlo por hecho es lo único que
  // dice la persona, y no hay estado que le gane.
  if (reminder.done) return 'done';
  if (reminder.sent) return 'sent';
  if (reminder.at > now) return 'pending';
  return now - reminder.at <= GRACE_MS ? 'due' : 'missed';
}

/**
 * ¿Toca mandar este aviso ahora mismo?
 *
 * Es la misma condición que el cron pregunta a Mongo con `$elemMatch`, escrita
 * para un objeto que ya está en memoria. Vive aquí y no allí por lo de siempre
 * en este proyecto: una regla escrita dos veces es una regla que un día deja de
 * coincidir consigo misma — y esta decide si suena un teléfono.
 */
export function isDue(reminder: Reminder, now: number = Date.now()): boolean {
  return reminderState(reminder, now) === 'due';
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

/** Tope de un mensaje de Telegram. Lo que pase de ahí lo rechaza con un 400. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * El aviso tal y como llega al teléfono.
 *
 * Va en texto plano y sin `parse_mode` a propósito: el cuerpo sale de una nota
 * que escribe una persona, y un guion bajo suelto —o un asterisco, o un
 * corchete— tumbaría el envío entero con un 400 por Markdown mal formado.
 * Escapar quince caracteres para poder poner negritas no vale ese riesgo.
 */
export function reminderMessage(key: string, note: string, reminder: Reminder): string {
  const cuando = `${formatWeekday(key)} ${formatLongDate(key)} · ${reminder.time}`;
  return `🔔 ${reminderText(reminder, note)}\n${cuando}`.slice(0, MAX_MESSAGE_LENGTH);
}
