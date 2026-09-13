import { isImageRef, tokenOf } from './image';
import { DEFAULT_COLOR } from './palette';
import { sameReminder } from './reminder';
import { sameTags } from './tags';
import { imageCount, loadData, saveData, type CalendarData, type DayEntry } from './storage';
import { fromWire, MAX_DAYS_PER_REQUEST, sanitizeWireDay, toWire, type WireDay } from './wire';

export const SYNC_KEY = 'calendar_2026_q4_sync';

/**
 * Lo que este navegador sabe sobre el estado de la sincronía. Vive aparte del
 * calendario a propósito: son andamios, no contenido, y no deben aparecer en
 * la exportación ni confundirse con un día.
 */
type SyncMeta = {
  /** Cuándo se tocó cada día aquí por última vez, en milisegundos. */
  stamps: Record<string, number>;
  /**
   * Días borrados aquí, y cuándo. Sin estas lápidas, borrar un día en el móvil
   * y abrir el portátil —que aún lo tiene— lo resucitaría en la siguiente
   * subida.
   */
  deleted: Record<string, number>;
  /** Claves con cambios que todavía no han llegado al servidor. */
  pending: string[];
  /**
   * Claves cuyas imágenes hay que subir. Va aparte de `pending` porque son dos
   * viajes de tamaño incomparable: el día pesa cientos de bytes y sus adjuntos,
   * megas. Mezclarlos haría que cambiar una coma en una nota reenviara las
   * seis imágenes.
   */
  pendingImages: string[];
  /**
   * Cuándo se subieron por última vez los adjuntos de cada día. Es lo que
   * distingue "el servidor sabe que hay dos imágenes" de "el servidor tiene
   * las dos imágenes": la cuenta viajó con el día desde el primer momento, los
   * adjuntos no.
   */
  imagesAt: Record<string, number>;
};

const EMPTY: SyncMeta = { stamps: {}, deleted: {}, pending: [], pendingImages: [], imagesAt: {} };

function sanitizeStamps(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

function sanitizeKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((key): key is string => /^\d{4}-\d{2}-\d{2}$/.test(String(key))))];
}

function loadMeta(): SyncMeta {
  if (typeof window === 'undefined') return { ...EMPTY, stamps: {}, deleted: {}, pending: [], pendingImages: [], imagesAt: {} };
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return { stamps: {}, deleted: {}, pending: [], pendingImages: [], imagesAt: {} };
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      stamps: sanitizeStamps(value.stamps),
      deleted: sanitizeStamps(value.deleted),
      pending: sanitizeKeys(value.pending),
      pendingImages: sanitizeKeys(value.pendingImages),
      imagesAt: sanitizeStamps(value.imagesAt),
    };
  } catch {
    return { stamps: {}, deleted: {}, pending: [], pendingImages: [], imagesAt: {} };
  }
}

function saveMeta(meta: SyncMeta): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(meta));
  } catch {
    /* Igual que el calendario: sin espacio se sigue en memoria. */
  }
}

/** Cuántos cambios esperan a subir. Lo que enseña el indicador de la cabecera. */
export function pendingCount(): number {
  const meta = loadMeta();
  return new Set([...meta.pending, ...meta.pendingImages]).size;
}

/** ¿Dice lo mismo el documento del día? No mira los adjuntos, que van aparte. */
function sameDay(a: DayEntry | undefined, b: DayEntry | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.marked === b.marked &&
    a.note === b.note &&
    (a.color ?? '') === (b.color ?? '') &&
    imageCount(a) === imageCount(b) &&
    (a.thumb ?? '') === (b.thumb ?? '') &&
    // Sin esto, poner una hora y no tocar nada más no encolaría nada: el día
    // se guardaría aquí y el servidor no se enteraría jamás.
    sameReminder(a.reminder, b.reminder) &&
    // Lo mismo con las etiquetas: son el único cambio que puede llevar un día
    // cuya nota, color y adjuntos no se han tocado.
    sameTags(a.tags, b.tags)
  );
}

/** ¿Las mismas imágenes en el mismo orden? */
function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((image, i) => image === b[i]);
}

/** ¿Los mismos adjuntos en el mismo orden? */
function sameImages(a: DayEntry | undefined, b: DayEntry | undefined): boolean {
  return sameList(a?.images ?? [], b?.images ?? []);
}

function enqueue(meta: SyncMeta, key: string): void {
  if (!meta.pending.includes(key)) meta.pending.push(key);
}

/**
 * Anota qué ha cambiado entre dos versiones del calendario y lo pone en cola.
 *
 * Se llama justo después de guardar en localStorage, con el antes y el
 * después que React ya tiene a mano: así ninguna vía de edición —el modal, el
 * borrado, el marcado de un rango con Shift, la importación— puede olvidarse
 * de avisar, porque todas desembocan en el mismo sitio.
 */
export function recordChanges(previous: CalendarData, next: CalendarData): void {
  const now = Date.now();
  const meta = loadMeta();
  let touched = false;

  for (const key of Object.keys(next)) {
    const changedDay = !sameDay(previous[key], next[key]);
    const changedImages = !sameImages(previous[key], next[key]);
    if (!changedDay && !changedImages) continue;

    meta.stamps[key] = now;
    delete meta.deleted[key];
    enqueue(meta, key);
    if (changedImages) {
      if (!meta.pendingImages.includes(key)) meta.pendingImages.push(key);
      // Lo de arriba ya no vale.
      delete meta.imagesAt[key];
    }
    touched = true;
  }

  for (const key of Object.keys(previous)) {
    if (next[key]) continue;
    meta.deleted[key] = now;
    delete meta.stamps[key];
    enqueue(meta, key);
    // La lápida se lleva por delante los adjuntos: se borran en el servidor.
    if (!meta.pendingImages.includes(key)) meta.pendingImages.push(key);
    delete meta.imagesAt[key];
    touched = true;
  }

  if (touched) saveMeta(meta);
}

export type PullResult =
  | { ok: true; data: CalendarData; fromServer: number; queued: number; queuedImages: number }
  | { ok: false; reason: string };

/**
 * Trae lo del servidor y lo funde con lo de aquí.
 *
 * El árbitro es la marca de tiempo: entre dos versiones del mismo día gana la
 * más reciente, y un empate lo gana lo local, que es lo que la persona tiene
 * delante. Lo que el servidor no conoce se pone en cola para subir; de ahí
 * sale, sin ningún caso especial, la migración de lo que ya había en este
 * navegador antes de existir la cuenta.
 */
export async function pull(): Promise<PullResult> {
  let payload: { days?: unknown };
  try {
    const response = await fetch('/api/days', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return { ok: false, reason: response.status === 401 ? 'Sesión caducada.' : 'El servidor no respondió.' };
    }
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'Sin conexión con el servidor.' };
  }

  const local = loadData();
  const meta = loadMeta();
  const merged: CalendarData = { ...local };
  const known = new Set<string>();
  let fromServer = 0;

  for (const raw of Array.isArray(payload.days) ? payload.days : []) {
    const day = sanitizeWireDay(raw);
    if (!day) continue;
    known.add(day.key);

    /*
     * «Este aviso ya salió» se adopta siempre, incluso de un día que por fecha
     * se va a descartar entero.
     *
     * `reminder.sent` lo escribe **solo** el servidor, nunca este navegador, así
     * que no puede entrar en conflicto con nada de aquí y no necesita ganar
     * ninguna comparación de marcas de tiempo. Y tiene que ser así: el cron no
     * toca `updatedAt` al marcarlo —subirlo le haría ganar a una edición local
     * sin subir, borrándola—, de modo que el día vuelve con la misma marca de
     * siempre y el filtro de abajo lo saltaría con el `sent` dentro.
     *
     * Se compara `at` porque un aviso movido de hora es otro aviso: el `sent`
     * del anterior no le corresponde.
     */
    const here = merged[day.key];
    if (
      here?.reminder &&
      day.reminder?.sent &&
      !here.reminder.sent &&
      here.reminder.at === day.reminder.at
    ) {
      merged[day.key] = { ...here, reminder: { ...here.reminder, sent: day.reminder.sent } };
    }

    // Lo de aquí manda mientras sea igual de reciente o más.
    const mine = meta.deleted[day.key] ?? meta.stamps[day.key] ?? 0;
    if (day.updatedAt <= mine) continue;

    if (day.deleted) {
      delete merged[day.key];
      meta.deleted[day.key] = day.updatedAt;
      delete meta.stamps[day.key];
    } else {
      // `local[day.key]` va porque las imágenes no viajan: se conservan las
      // que ya hubiera en este navegador.
      merged[day.key] = fromWire(day, local[day.key]);
      meta.stamps[day.key] = day.updatedAt;
      delete meta.deleted[day.key];
    }

    // El servidor ya tiene su versión: lo que hubiera en cola sobra.
    meta.pending = meta.pending.filter((key) => key !== day.key);
    fromServer++;
  }

  // Días que este navegador tenía de antes, cuando no había cuenta ni marcas
  // de tiempo. Si el servidor no los conoce, son suyos y suben tal cual.
  let queued = 0;
  const now = Date.now();
  for (const key of Object.keys(merged)) {
    if (known.has(key) || meta.stamps[key]) continue;
    meta.stamps[key] = now;
    enqueue(meta, key);
    queued++;
  }

  /*
   * Días cuyos adjuntos están aquí pero no están arriba. Dos casos, y los dos
   * son migraciones de lo que ya había:
   *
   * - los que nunca llegaron al servidor, de antes de existir la colección de
   *   imágenes: entonces solo viajó la cuenta y el contenido se quedó aquí;
   * - los que este navegador todavía guarda como data URL. Esos sí están
   *   arriba, pero en el almacén viejo. Subirlos otra vez es lo que los
   *   convierte en referencias y lo que saca de `localStorage` la copia
   *   completa de las imágenes, que es media tanda 8.
   */
  let queuedImages = 0;
  for (const [key, entry] of Object.entries(merged)) {
    if (!entry.images?.length) continue;
    const pendiente = entry.images.some((image) => !isImageRef(image));
    if (meta.imagesAt[key] && !pendiente) continue;
    if (!meta.pendingImages.includes(key)) meta.pendingImages.push(key);
    queuedImages++;
  }

  saveMeta(meta);
  saveData(merged);

  return { ok: true, data: merged, fromServer, queued, queuedImages };
}

export type FlushResult =
  | { ok: true; sent: number; remaining: number }
  | { ok: false; reason: string };

/**
 * Sube la cola. Lo que falle se queda dentro para el siguiente intento, así
 * que quedarse sin red no pierde nada: solo lo aplaza.
 */
export async function flush(): Promise<FlushResult> {
  const meta = loadMeta();
  if (meta.pending.length === 0) return { ok: true, sent: 0, remaining: 0 };

  const data = loadData();
  const batchKeys = meta.pending.slice(0, MAX_DAYS_PER_REQUEST);
  const days: WireDay[] = [];
  /** Con qué marca de tiempo salió cada día. Ver la limpieza de la cola. */
  const sent = new Map<string, number>();
  /** En la cola pero ni presente ni enterrado: no hay nada que contar. */
  const empty: string[] = [];

  for (const key of batchKeys) {
    const buried = meta.deleted[key];
    if (buried) {
      days.push({ key, marked: false, note: '', color: DEFAULT_COLOR, imageCount: 0, updatedAt: buried, deleted: true });
      sent.set(key, buried);
      continue;
    }
    const entry = data[key];
    if (!entry) {
      empty.push(key);
      continue;
    }
    const stamp = meta.stamps[key] ?? Date.now();
    days.push(toWire(key, entry, stamp));
    sent.set(key, stamp);
  }

  if (days.length === 0) {
    meta.pending = meta.pending.filter((key) => !empty.includes(key));
    saveMeta(meta);
    return { ok: true, sent: 0, remaining: meta.pending.length };
  }

  try {
    const response = await fetch('/api/days', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days }),
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 401 ? 'Sesión caducada.' : 'El servidor rechazó los cambios.' };
    }
  } catch {
    return { ok: false, reason: 'Sin conexión con el servidor.' };
  }

  // Se relee, porque mientras subía pudo haber más ediciones. Un día solo sale
  // de la cola si su marca de tiempo sigue siendo la que se envió: si cambió
  // en pleno vuelo, lo que acaba de guardar la persona no se ha subido aún y
  // borrarlo de la cola lo perdería.
  const after = loadMeta();
  after.pending = after.pending.filter((key) => {
    if (empty.includes(key)) return false;
    const posted = sent.get(key);
    if (posted === undefined) return true;
    const current = after.deleted[key] ?? after.stamps[key] ?? 0;
    return current !== posted;
  });
  saveMeta(after);

  return { ok: true, sent: days.length, remaining: after.pending.length };
}

export type ImageFlushResult =
  | {
      ok: true;
      sent: number;
      remaining: number;
      /**
       * El calendario con lo que el servidor acaba de confirmar, o `null` si no
       * ha cambiado nada. Quien llama tiene que **adoptarlo**, no guardarlo como
       * una edición: lo de dentro ya está arriba, y tratarlo como un cambio
       * local volvería a encolar las mismas imágenes en bucle.
       */
      data: CalendarData | null;
    }
  | { ok: false; reason: string };

/**
 * Sube los adjuntos de un día. Uno solo por vuelta, a propósito: son megas
 * frente a los cientos de bytes de un día, y así el indicador avanza en vez de
 * quedarse clavado durante toda una tanda.
 *
 * Se manda el conjunto entero del día aunque solo haya cambiado una imagen.
 * Con seis como tope y ediciones contadas, comparar cuáles cambiaron costaría
 * más código del que ahorra — y desde la tanda 8 casi no cuesta nada: lo que
 * ya estaba arriba viaja como referencia, sin bytes.
 *
 * De vuelta llega **dónde ha quedado cada una**, y eso es lo que se guarda
 * aquí en lugar de la data URL. Ese cambio de piel es el que quita la copia
 * completa de `localStorage`: a partir de ahora este navegador tiene el
 * nombre de la imagen, no la imagen.
 */
export async function flushImages(): Promise<ImageFlushResult> {
  const meta = loadMeta();
  const key = meta.pendingImages[0];
  if (!key) return { ok: true, sent: 0, remaining: 0, data: null };

  const before = loadData();
  // Un día borrado no tiene adjuntos: la lista vacía hace que el recorte de
  // más abajo los borre en el servidor, que es justo lo que toca.
  const images = before[key]?.images ?? [];

  /** Lo que el servidor confirma, en el mismo orden. */
  const refs: string[] = [];
  /** Posición que el servidor dice no tener ya. Ver más abajo. */
  let lost = -1;

  try {
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const response = await fetch('/api/images', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key,
          index,
          // Una referencia no lleva bytes: se manda para que la coloque donde
          // toca, no para volver a subirla. Pasa al quitar un adjunto que no
          // era el último, que corre una posición a todos los de detrás.
          ...(isImageRef(image) ? { ref: image } : { dataUrl: image }),
          updatedAt: Date.now(),
        }),
      });

      /*
       * El almacén ya no la tiene. No se puede reenviar —hace rato que este
       * navegador soltó los bytes—, así que se cae del día y el resto se
       * reintenta entero en la vuelta siguiente, ya con los índices corridos.
       * Es la única forma de que un adjunto perdido no deje la cola girando
       * para siempre, y cada vuelta quita uno: termina seguro.
       */
      if (response.status === 410) {
        lost = index;
        break;
      }

      if (!response.ok) {
        return {
          ok: false,
          reason: response.status === 401 ? 'Sesión caducada.' : 'El servidor rechazó una imagen.',
        };
      }

      const body = (await response.json()) as { ref?: unknown };
      // Sin referencia no se puede inventar una: se conserva lo que había y el
      // día vuelve a salir en la siguiente tanda.
      refs.push(isImageRef(body.ref) ? body.ref : image);
    }

    // Quitar un adjunto aquí tiene que quitarlo allí: se recorta la cola. No
    // cuando se ha perdido una, que entonces los índices aún no son los
    // definitivos y el recorte se llevaría por delante una imagen buena.
    if (lost < 0) {
      const trimmed = await fetch(`/api/images?key=${encodeURIComponent(key)}&from=${refs.length}`, {
        method: 'DELETE',
      });
      if (!trimmed.ok) return { ok: false, reason: 'No se pudieron retirar las imágenes sobrantes.' };
    }
  } catch {
    return { ok: false, reason: 'Sin conexión con el servidor.' };
  }

  const after = loadMeta();
  const current = loadData();
  /**
   * ¿Se editaron los adjuntos mientras subían? Entonces lo que la persona
   * acaba de guardar no es lo que se ha subido: el día se queda en la cola y
   * aquí no se toca nada.
   */
  const raced = !sameImages(current[key], before[key]);

  if (lost >= 0) {
    if (raced) return { ok: true, sent: refs.length, remaining: after.pendingImages.length, data: null };
    const data = withImages(current, key, images.filter((_, i) => i !== lost), current[key]?.thumb);
    saveData(data);
    return { ok: true, sent: refs.length, remaining: after.pendingImages.length, data };
  }

  if (!raced) {
    after.pendingImages = after.pendingImages.filter((pending) => pending !== key);
    after.imagesAt[key] = Date.now();
  }

  /*
   * La miniatura del día es el testigo de su primera imagen. Se pone aquí y no
   * al adjuntar por lo mismo de siempre: es lo único de las imágenes que verán
   * los demás dispositivos, y este es el momento en que se sabe que el
   * conjunto ya está arriba y no va a cambiar.
   */
  const thumb = refs[0] ? tokenOf(refs[0]) : undefined;
  const entry = current[key];
  let data: CalendarData | null = null;

  if (!raced && entry && (!sameList(entry.images ?? [], refs) || (entry.thumb ?? '') !== (thumb ?? ''))) {
    data = withImages(current, key, refs, thumb);
    saveData(data);
    // El día ha cambiado —otra miniatura, otras referencias— y tiene que
    // subir. Se encola como una edición cualquiera, que es lo que es.
    after.stamps[key] = Date.now();
    enqueue(after, key);
  }

  saveMeta(after);
  return { ok: true, sent: refs.length, remaining: after.pendingImages.length, data };
}

/** El calendario con otros adjuntos —y otra miniatura— en un día. */
function withImages(
  data: CalendarData,
  key: string,
  images: string[],
  thumb: string | undefined,
): CalendarData {
  const entry = data[key];
  if (!entry) return data;

  const next: DayEntry = { ...entry, images, imageCount: images.length, thumb };
  // Un día sin adjuntos no lleva ninguno de los tres campos, y dejarlos a cero
  // o vacíos los haría viajar en cada subida.
  if (images.length === 0) {
    delete next.images;
    delete next.imageCount;
  }
  if (!thumb) delete next.thumb;

  return { ...data, [key]: next };
}

/**
 * Trae los adjuntos de un día. Los pide el modal al abrirse en un dispositivo
 * que aún no los tiene, y la galería al cargar.
 *
 * Lo que baja son referencias, no bytes: unos cientos de bytes por día en vez
 * de megas. Los bytes los pide después cada `<img>` al proxy, y solo los de
 * las imágenes que se lleguen a ver.
 */
export async function fetchImages(key: string): Promise<string[] | null> {
  try {
    const response = await fetch(`/api/images?key=${encodeURIComponent(key)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { images?: unknown };
    if (!Array.isArray(body.images)) return null;
    return body.images.filter((image): image is string => isImageRef(image));
  } catch {
    return null;
  }
}

/**
 * Guarda unos adjuntos recién descargados y devuelve el calendario resultante.
 *
 * Se anota además en `imagesAt`: acaban de llegar del servidor, así que ya
 * están arriba y volver a subirlos sería un viaje de megas para nada.
 */
export function storeImages(key: string, images: string[]): CalendarData {
  const data = loadData();
  const entry = data[key];
  if (!entry) return data;

  const next: CalendarData = {
    ...data,
    [key]: { ...entry, images, imageCount: images.length },
  };
  saveData(next);

  const meta = loadMeta();
  meta.imagesAt[key] = Date.now();
  meta.pendingImages = meta.pendingImages.filter((pending) => pending !== key);
  saveMeta(meta);

  return next;
}
