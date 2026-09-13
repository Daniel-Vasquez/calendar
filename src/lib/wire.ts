import { DEFAULT_COLOR, isColorId, type ColorId } from './palette';
import { isThumb } from './image';
import { sanitizeReminder, type Reminder } from './reminder';
import { imageCount, type DayEntry } from './storage';

/**
 * Forma en la que un día viaja entre el navegador y el servidor.
 *
 * No lleva las imágenes: una nota con seis adjuntos son más de cuatro megas de
 * data URL, y bajarlos con el calendario haría inservible la carga. Viajan en
 * su propia colección (tanda 4); aquí solo va la cuenta, que es lo que la
 * rejilla y la agenda necesitan saber para pintar el indicador.
 *
 * Este archivo lo importan los dos lados, así que no puede tocar ni `window`
 * ni nada del servidor.
 */
export type WireDay = {
  key: string;
  marked: boolean;
  note: string;
  color: ColorId;
  /** Cuántas imágenes tiene la nota. Las imágenes van en su propia colección. */
  imageCount: number;
  /**
   * Miniatura de la primera imagen. Es lo único de las imágenes que viaja con
   * el día, y es deliberado: la agenda enseña una por fila y pedirlas de una
   * en una convertiría abrir el calendario en una ráfaga de peticiones.
   */
  thumb?: string;
  /**
   * Cuándo se tocó por última vez, en milisegundos del reloj del cliente que
   * lo escribió. Es el árbitro de la fusión: entre dos versiones del mismo
   * día gana la más reciente.
   */
  updatedAt: number;
  /**
   * Aviso del día. Sí viaja, al revés que las imágenes: son cuatro campos y el
   * cron los necesita en el servidor para saber qué mandar y cuándo.
   */
  reminder?: Reminder;
  /**
   * Lápida. Un día borrado no se quita de la base: se marca. Sin esto, borrar
   * un día en el móvil y abrir el portátil —que aún lo tiene— lo resucitaría
   * en la siguiente subida.
   */
  deleted?: boolean;
};

/**
 * Las claves de `WireDay` que pueden no venir en un día concreto.
 *
 * Se deriva del propio tipo en vez de escribirse a mano: quien guarda un día
 * necesita saber exactamente cuáles son para poder **borrar** las que falten,
 * y esa lista no puede quedarse atrás cuando el tipo crezca. Ver `days.ts`.
 */
export type OptionalWireKey = {
  [K in keyof WireDay]-?: undefined extends WireDay[K] ? K : never;
}[keyof WireDay];

/** Tope por petición. Un año son 366 días; el margen es para la subida inicial. */
export const MAX_DAYS_PER_REQUEST = 500;

/** ¿Es una clave de día con la forma que espera el calendario? */
export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Sanea un día recibido de fuera. Lo usa el servidor con lo que manda el
 * navegador y el navegador con lo que devuelve el servidor: ninguno de los dos
 * se fía del otro, y así un documento estropeado se descarta solo en vez de
 * tumbar la fusión entera.
 */
export function sanitizeWireDay(raw: unknown): WireDay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  if (!isDateKey(value.key)) return null;

  // Sin marca de tiempo no hay forma de arbitrar la fusión, y darle una ahora
  // la haría ganar a cualquier versión legítima anterior.
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : null;
  if (updatedAt === null) return null;

  const deleted = value.deleted === true;

  // Una lápida no describe contenido: los demás campos sobran y se normalizan.
  if (deleted) {
    return { key: value.key, marked: false, note: '', color: DEFAULT_COLOR, imageCount: 0, updatedAt, deleted: true };
  }

  const count = typeof value.imageCount === 'number' ? Math.floor(value.imageCount) : 0;
  const thumb = isThumb(value.thumb) ? value.thumb : undefined;
  const reminder = sanitizeReminder(value.reminder, value.key);

  return {
    key: value.key,
    marked: value.marked === true,
    note: typeof value.note === 'string' ? value.note : '',
    color: isColorId(value.color) ? value.color : DEFAULT_COLOR,
    imageCount: Math.max(0, Math.min(count, 99)),
    ...(thumb ? { thumb } : {}),
    ...(reminder ? { reminder } : {}),
    updatedAt,
  };
}

/** El día tal y como se manda al servidor: la cuenta y la miniatura, no las imágenes. */
export function toWire(key: string, entry: DayEntry, updatedAt: number): WireDay {
  return {
    key,
    marked: entry.marked,
    note: entry.note,
    color: entry.color ?? DEFAULT_COLOR,
    imageCount: imageCount(entry),
    ...(entry.thumb ? { thumb: entry.thumb } : {}),
    ...(entry.reminder ? { reminder: entry.reminder } : {}),
    updatedAt,
  };
}

/**
 * El día que llega del servidor, devuelto a la forma que usa la interfaz.
 *
 * `local` es la versión que ya había en este navegador, y está aquí por una
 * razón concreta: sus imágenes no han viajado, así que se conservan. Sin esto,
 * abrir el calendario borraría los adjuntos de cada día que el servidor
 * tuviera más reciente.
 */
export function fromWire(day: WireDay, local?: DayEntry): DayEntry {
  // Las que ya estuvieran descargadas aquí se quedan, pero solo si siguen
  // cuadrando con la cuenta: si el servidor dice cuatro y aquí hay seis, las
  // de aquí son de una versión anterior y se piden de nuevo.
  const images = local?.images?.length === day.imageCount ? local.images : undefined;

  return {
    marked: day.marked,
    note: day.note,
    color: day.color,
    ...(images?.length ? { images } : {}),
    ...(day.imageCount ? { imageCount: day.imageCount } : {}),
    ...(day.thumb ? { thumb: day.thumb } : {}),
    ...(day.reminder ? { reminder: day.reminder } : {}),
  };
}
