import { DEFAULT_COLOR } from './palette';
import { loadData, saveData, type CalendarData, type DayEntry } from './storage';
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
};

const EMPTY: SyncMeta = { stamps: {}, deleted: {}, pending: [] };

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

function loadMeta(): SyncMeta {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return { stamps: {}, deleted: {}, pending: [] };
    const value = JSON.parse(raw) as Record<string, unknown>;
    const pending = Array.isArray(value.pending)
      ? value.pending.filter((key): key is string => /^\d{4}-\d{2}-\d{2}$/.test(String(key)))
      : [];
    return {
      stamps: sanitizeStamps(value.stamps),
      deleted: sanitizeStamps(value.deleted),
      pending: [...new Set(pending)],
    };
  } catch {
    return { stamps: {}, deleted: {}, pending: [] };
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
  return loadMeta().pending.length;
}

/** ¿Dicen lo mismo las dos versiones de un día? Decide si hay algo que subir. */
function sameEntry(a: DayEntry | undefined, b: DayEntry | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.marked !== b.marked || a.note !== b.note || (a.color ?? '') !== (b.color ?? '')) return false;
  const left = a.images ?? [];
  const right = b.images ?? [];
  return left.length === right.length && left.every((image, i) => image === right[i]);
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
    if (sameEntry(previous[key], next[key])) continue;
    meta.stamps[key] = now;
    delete meta.deleted[key];
    enqueue(meta, key);
    touched = true;
  }

  for (const key of Object.keys(previous)) {
    if (next[key]) continue;
    meta.deleted[key] = now;
    delete meta.stamps[key];
    enqueue(meta, key);
    touched = true;
  }

  if (touched) saveMeta(meta);
}

export type PullResult =
  | { ok: true; data: CalendarData; fromServer: number; queued: number }
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

  saveMeta(meta);
  saveData(merged);

  return { ok: true, data: merged, fromServer, queued };
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
