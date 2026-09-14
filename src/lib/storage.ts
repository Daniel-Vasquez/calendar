import { DEFAULT_COLOR, isColorId, type ColorId } from './palette';
import { isImageDataUrl, isImageRef, isThumb, MAX_IMAGES_PER_DAY } from './image';
import { makeReminder, sanitizeReminders, type Reminder } from './reminder';
import { sanitizeTags } from './tags';

export const STORAGE_KEY = 'calendar_2026_q4_data';

export type DayEntry = {
  marked: boolean;
  note: string;
  color?: ColorId;
  /**
   * Los adjuntos de la nota, en el orden en que se añadieron. Es lo que sabe
   * *este navegador*: puede faltar entero en un dispositivo que aún no los ha
   * pedido, y por eso no sirve para contar.
   *
   * Dos formas conviven en el mismo array, y es a propósito: una **data URL**
   * mientras el adjunto está recién elegido y sin subir, y una **referencia**
   * `cld:…` en cuanto el servidor confirma que ya está en el almacén. Ver
   * `image.ts`, que explica las dos y da el `src` de cualquiera.
   */
  images?: string[];
  /**
   * Cuántas imágenes tiene la nota en realidad. Manda sobre `images.length`
   * porque llega con el día desde el servidor, mientras que las imágenes en sí
   * se piden aparte y bajo demanda.
   */
  imageCount?: number;
  /**
   * La versión de la primera imagen, no la imagen. Baja con el día y con ella
   * la agenda pide su miniatura al proxy sin esperar a ninguna descarga. Ver
   * `wire.ts`.
   */
  thumb?: string;
  /**
   * Avisos del día, **ordenados por hora**. Ausente cuando no hay ninguno;
   * nunca una lista vacía, por lo mismo que `images` y `tags`: un array vacío
   * viajaría en cada subida sin decir nada. Ver `reminder.ts`.
   */
  reminders?: Reminder[];
  /**
   * Etiquetas del día, por su `slug`. Van dentro del día y no en una lista
   * aparte porque son suyas: se mudan con él, se borran con él y suben a la
   * cuenta con él. El catálogo —qué etiquetas existen— sí es de este
   * dispositivo y vive en `localStorage`. Ver `tags.ts`.
   */
  tags?: string[];
};

/**
 * ¿Hay algo que guardar? Una imagen sola ya es contenido, igual que una nota.
 *
 * **Los recordatorios cuentan.** Sin esta línea, poner una hora y guardar deja
 * un día que no tiene marca, ni nota, ni imagen: `handleSave` lo lee como vacío
 * y lo borra en el acto, con los avisos dentro.
 *
 * **Y las etiquetas también.** Es discutible —una etiqueta clasifica algo, y
 * sola no clasifica nada—, pero la alternativa es peor: elegir «Descanso» en un
 * día vacío, guardar y ver que no ha pasado nada, sin que nada lo explique.
 */
export function hasContent(entry: DayEntry): boolean {
  return (
    entry.marked ||
    Boolean(entry.note) ||
    hasImages(entry) ||
    Boolean(entry.reminders?.length) ||
    Boolean(entry.tags?.length)
  );
}

/**
 * Mueve un día entero a otra fecha: la marca, el color, la nota, los adjuntos
 * y el aviso se van con él, y el de origen desaparece.
 *
 * Lo usa la agenda, donde la fecha es un campo más del día y no un sitio en la
 * rejilla. El día que se mueve llega ya editado —es el borrador del modal—, así
 * que mover y guardar son un solo paso y no dos.
 *
 * Dos reglas que no se pueden olvidar:
 *
 * 1. **Los avisos se rehacen con la fecha nueva.** Un recordatorio guarda el
 *    instante absoluto de su día (ver `reminder.ts`); arrastrarlo tal cual
 *    dejaría el aviso sonando en la fecha de la que se acaba de salir.
 *    `makeReminder` recalcula ese instante y de paso suelta `sent` y `done`,
 *    que es lo correcto: en el día nuevo está por sonar y por hacer. El `id`
 *    **sí se conserva** —lo conserva `makeReminder` al recibir el previo—: no
 *    hay nada que ganar cambiándolo, y mantenerlo hace la mudanza repetible.
 * 2. **Si el destino ya tenía algo, lo pierde.** Un día es una clave y solo
 *    cabe uno; quien llama avisa antes y ofrece deshacer. Ver `AgendaView`.
 *
 * Un día que se ha quedado sin contenido no se recrea en el destino: vaciarlo
 * es borrarlo, se mueva o no.
 */
export function moveDay(
  data: CalendarData,
  from: string,
  to: string,
  entry: DayEntry,
): CalendarData {
  const next = { ...data };
  delete next[from];
  if (!hasContent(entry)) return next;

  const { reminders: previous, ...rest } = entry;
  const reminders = (previous ?? []).flatMap((reminder) => {
    const moved = makeReminder(to, reminder.time, reminder.text ?? '', reminder);
    // `makeReminder` conserva `sent` y `done` solo si la hora y el texto no se
    // tocan, y aquí no se tocan: se sueltan a mano, porque en el día nuevo el
    // aviso está por sonar y por hacer aunque diga lo mismo.
    if (!moved) return [];
    const { sent: _salió, done: _hecho, ...limpio } = moved;
    return [limpio];
  });
  next[to] = { ...rest, ...(reminders.length ? { reminders } : {}) };
  return next;
}

/** Cuántas imágenes tiene la nota, las tenga descargadas o no este navegador. */
export function imageCount(entry: DayEntry | undefined): number {
  return entry?.imageCount ?? entry?.images?.length ?? 0;
}

/** ¿Lleva la nota alguna imagen? Evita repetir la cuenta por todas partes. */
export function hasImages(entry: DayEntry | undefined): boolean {
  return imageCount(entry) > 0;
}

/** ¿Están aquí todas las imágenes que dice tener? Decide si hay que pedirlas. */
export function imagesReady(entry: DayEntry | undefined): boolean {
  return (entry?.images?.length ?? 0) >= imageCount(entry);
}

/**
 * Lista saneada de imágenes de una entrada cruda. Acepta el formato actual
 * (`images: string[]`) y el anterior (`image: string`), que se convierte en
 * una lista de uno: los datos guardados antes del cambio siguen valiendo.
 * Las repetidas y las que no tengan una forma reconocible se descartan, y el
 * resto se recorta al máximo por día.
 *
 * Valen las dos formas. Solo con `isImageDataUrl` —que es lo que había— este
 * saneado tiraría todas las referencias al releer localStorage, y el
 * calendario se quedaría sin adjuntos a la primera recarga.
 */
function sanitizeImages(entry: Record<string, unknown>): string[] {
  const raw = Array.isArray(entry.images) ? entry.images : [entry.image];
  const clean: string[] = [];
  for (const value of raw) {
    if ((isImageDataUrl(value) || isImageRef(value)) && !clean.includes(value)) clean.push(value);
    if (clean.length === MAX_IMAGES_PER_DAY) break;
  }
  return clean;
}

export type CalendarData = Record<string, DayEntry>;

/**
 * Descarta claves/valores corruptos en lugar de dejar caer todo el estado.
 * Se exporta porque un archivo importado merece la misma desconfianza que
 * lo que haya quedado en localStorage.
 */
export function sanitizeData(raw: unknown): CalendarData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const clean: CalendarData = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!value || typeof value !== 'object') continue;

    const entry = value as Record<string, unknown>;
    const marked = entry.marked === true;
    const note = typeof entry.note === 'string' ? entry.note : '';
    // Una imagen corrupta se descarta sin tumbar el resto del día.
    const images = sanitizeImages(entry);

    // La cuenta puede superar a las descargadas: otro dispositivo subió seis y
    // este todavía no las ha pedido. Nunca puede ser menor, o el día se
    // quedaría enseñando imágenes que dice no tener.
    const declared = typeof entry.imageCount === 'number' ? Math.floor(entry.imageCount) : 0;
    const count = Math.max(images.length, Math.min(Math.max(declared, 0), MAX_IMAGES_PER_DAY));

    const thumb = isThumb(entry.thumb) ? entry.thumb : undefined;
    // Acepta la lista de la tanda 9 y el objeto suelto de antes. De ahí sale,
    // sin ningún caso especial, la migración de lo que este navegador ya tenía
    // guardado: se lee en la forma vieja y se escribe en la nueva.
    const reminders = sanitizeReminders(entry.reminders ?? entry.reminder, key);
    const tags = sanitizeTags(entry.tags);

    // La misma regla que `hasContent`, aplicada al leer: un día que solo lleva
    // recordatorios —o solo etiquetas— es un día con contenido y no puede
    // caerse aquí. Las dos reglas tienen que decir lo mismo.
    if (!marked && !note && count === 0 && reminders.length === 0 && tags.length === 0) continue;

    // Datos anteriores a los colores no traen `color`: se asume el teal base.
    const color = isColorId(entry.color) ? entry.color : DEFAULT_COLOR;

    clean[key] = {
      marked,
      note,
      color,
      ...(images.length ? { images } : {}),
      ...(count ? { imageCount: count } : {}),
      ...(thumb ? { thumb } : {}),
      ...(reminders.length ? { reminders } : {}),
      ...(tags.length ? { tags } : {}),
    };
  }
  return clean;
}

/**
 * Pone las etiquetas de un día, creándolo si hacía falta y borrándolo si se
 * queda sin nada. Las mismas dos reglas que `upsertReminder` en `reminders.ts`,
 * por las que un día puede nacer de un aviso o morir al quitarle el último.
 *
 * Lo usa la lista de recordatorios, que edita el día sin abrir su modal.
 */
export function withTags(data: CalendarData, key: string, tags: string[]): CalendarData {
  const entry = data[key];
  const clean = sanitizeTags(tags);
  if (!entry && clean.length === 0) return data;

  const next = { ...(entry ?? { marked: false, note: '' }), ...(clean.length ? { tags: clean } : {}) };
  if (clean.length === 0) delete next.tags;

  const result = { ...data };
  if (hasContent(next)) result[key] = next;
  else delete result[key];
  return result;
}

export function loadData(): CalendarData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeData(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Devuelve `false` si no se pudo persistir. Cuota llena o almacenamiento
 * bloqueado: la app sigue funcionando en memoria, pero con imágenes adjuntas
 * la cuota se alcanza de verdad y el usuario merece saberlo.
 */
export function saveData(data: CalendarData): boolean {
  if (typeof window === 'undefined') return true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
