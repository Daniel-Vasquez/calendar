import {
  loadPalette,
  sanitizePalette,
  savePalette,
  type ColorPalette,
} from './palette';
import { loadSavedTags, sanitizeCatalogue, saveTags, type Tag } from './tags';

/**
 * Las preferencias que **son de la persona y no del dispositivo**: la paleta
 * —cómo se llama y de qué tono es cada categoría— y el catálogo de etiquetas.
 *
 * Las dos vivían solo en `localStorage`, y eso hacía que el mismo calendario se
 * viera con categorías distintas en el móvil y en el portátil. Suben a la
 * cuenta por la colección `settings`, que existe justo para lo que no es de
 * este dispositivo — el chat de Telegram ya estaba ahí.
 *
 * **Viajan juntas y con una sola marca de tiempo.** Son un puñado de bytes que
 * se editan en la misma pantalla y casi nunca; partirlas en dos documentos, dos
 * peticiones y dos relojes sería más mecanismo del que el problema pide.
 *
 * Este archivo lo importan los dos lados, así que no toca `window` sin mirar y
 * no importa nada del servidor.
 */

/**
 * Preferencias tal y como viajan.
 *
 * Los dos campos son opcionales y eso **significa algo**: ausente es «de esto
 * no opino», no «esto está vacío». De ahí vive el caso que de otro modo
 * borraría datos — ver `pushPrefs` y el `PUT` de `api/settings.ts`.
 */
export type WirePrefs = {
  /** Solo lo retocado. `{}` es una respuesta legítima: la paleta de fábrica. */
  palette?: ColorPalette;
  /**
   * El catálogo entero.
   *
   * `[]` y ausente **no son lo mismo**, y la distinción es la que impide que
   * las siete etiquetas de fábrica resuciten en cuanto alguien las borre todas:
   * `[]` es un catálogo vacío a propósito y se respeta; ausente es que en este
   * dispositivo nunca se guardó ninguno. Es la misma diferencia que `loadTags`
   * hace entre «no hay registro» y «hay uno vacío».
   */
  tags?: Tag[];
  /** Cuándo se tocaron por última vez, por el reloj de quien las tocó. */
  prefsAt: number;
};

/**
 * Dónde se guarda aquí la marca de tiempo. Va en su propia clave y no dentro de
 * la paleta ni del catálogo porque es de las dos a la vez, y porque meterla
 * dentro obligaría a que el saneado de ambas la esquivara.
 */
export const PREFS_KEY = 'calendar_2026_q4_prefs';

/** Marca de tiempo local, o cero si aquí nunca se ha tocado nada. */
export function loadPrefsAt(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return 0;
    const value = (JSON.parse(raw) as { prefsAt?: unknown })?.prefsAt;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function savePrefsAt(prefsAt: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ prefsAt }));
  } catch {
    /* Igual que el resto: sin espacio se sigue en memoria. */
  }
}

/**
 * Sanea unas preferencias venidas de fuera. Lo usan el servidor con lo que
 * manda el navegador y el navegador con lo que devuelve el servidor: ninguno se
 * fía del otro, y así un documento estropeado se descarta solo.
 *
 * Devuelve `null` sin marca de tiempo utilizable: sin ella no hay forma de
 * arbitrar, y darle una ahora la haría ganar a cualquier versión legítima.
 */
export function sanitizePrefs(raw: unknown): WirePrefs | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const prefsAt = value.prefsAt;
  if (typeof prefsAt !== 'number' || !Number.isFinite(prefsAt) || prefsAt <= 0) return null;

  return {
    ...(value.palette !== undefined ? { palette: sanitizePalette(value.palette) } : {}),
    // `Array.isArray` y no «si es verdadero»: `[]` tiene que pasar, porque un
    // catálogo vacío a propósito es lo que distingue de no haber opinado.
    ...(Array.isArray(value.tags) ? { tags: sanitizeCatalogue(value.tags) } : {}),
    prefsAt,
  };
}

/** Lo que este navegador tiene guardado, listo para mandar. */
export function localPrefs(): WirePrefs {
  const tags = loadSavedTags();
  return {
    palette: loadPalette(),
    // Solo si aquí se guardó alguna vez. Mandar el de fábrica como si fuera una
    // decisión pisaría el catálogo de la cuenta con algo que nadie eligió.
    ...(tags ? { tags } : {}),
    prefsAt: loadPrefsAt(),
  };
}

/** Escribe en este navegador lo que ha ganado. No toca lo que no venga. */
export function adoptPrefs(prefs: WirePrefs): void {
  if (prefs.palette) savePalette(prefs.palette);
  if (prefs.tags) saveTags(prefs.tags);
  savePrefsAt(prefs.prefsAt);
}

export type PrefsPull =
  | {
      ok: true;
      /** Lo del servidor, ya guardado aquí, o `null` si ganó lo de este lado. */
      adopted: WirePrefs | null;
      /** Hay algo de aquí que subir. */
      queued: boolean;
      /** Lo que sube venía de antes de que esto llegara a la cuenta. */
      migrated: boolean;
    }
  | { ok: false; reason: string };

/**
 * ¿Hay algo guardado aquí que la cuenta no conozca?
 *
 * Se mira **campo a campo** y no en bloque, y ese detalle tapa una pérdida real.
 * Un dispositivo puede haber subido solo la paleta —nunca tocó las etiquetas—
 * mientras otro tiene un catálogo propio de antes de la tanda 11. Sin esto, el
 * segundo adoptaría la paleta del primero, se quedaría su catálogo en local sin
 * subirlo nunca, y lo perdería en cuanto el primero añadiera una etiqueta.
 *
 * La paleta vacía no cuenta: es la de fábrica y subirla no dice nada. El
 * catálogo sí cuenta aunque esté vacío, porque vacío **a propósito** es una
 * decisión — la misma distinción que hace `loadSavedTags`.
 */
function faltaEnLaCuenta(remote: WirePrefs | null): boolean {
  const local = localPrefs();
  const paletaSuelta = !remote?.palette && Object.keys(local.palette ?? {}).length > 0;
  const catalogoSuelto = remote?.tags === undefined && local.tags !== undefined;
  return paletaSuelta || catalogoSuelto;
}

/**
 * Trae las preferencias de la cuenta y decide quién manda.
 *
 * El árbitro es la marca de tiempo, igual que con los días, y un empate lo gana
 * lo local — que es lo que la persona tiene delante. De aquí sale además, sin
 * ningún caso especial, la migración de lo que ya hubiera en este navegador:
 * si el servidor no sabe nada y aquí hay algo guardado, se le pone marca y
 * sube.
 */
export async function pullPrefs(): Promise<PrefsPull> {
  let payload: unknown;
  try {
    const response = await fetch('/api/settings', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 ? 'Sesión caducada.' : 'El servidor no respondió.',
      };
    }
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'Sin conexión con el servidor.' };
  }

  const remote = sanitizePrefs(payload);
  const mine = loadPrefsAt();

  if (remote && remote.prefsAt > mine) {
    adoptPrefs(remote);
    // Lo adoptado puede no cubrirlo todo: ver `faltaEnLaCuenta`. Lo que quede
    // suelto se queda aquí tal cual y sube encima de lo recién adoptado.
    if (!faltaEnLaCuenta(remote)) return { ok: true, adopted: remote, queued: false, migrated: false };
    savePrefsAt(Date.now());
    return { ok: true, adopted: remote, queued: true, migrated: true };
  }

  // Manda lo de aquí. Si ya tiene marca, es que se editó después: sube.
  if (mine > 0) return { ok: true, adopted: null, queued: true, migrated: false };

  /*
   * Y si no la tiene, este navegador puede traer preferencias de antes de que
   * esto subiera a la cuenta. Se les pone marca ahora y suben, que es
   * exactamente lo que hace `pull()` con los días que el servidor no conoce.
   */
  if (!faltaEnLaCuenta(remote)) return { ok: true, adopted: null, queued: false, migrated: false };

  savePrefsAt(Date.now());
  return { ok: true, adopted: null, queued: true, migrated: true };
}

/**
 * Sube lo que hay en este navegador. Se relee de `localStorage` en vez de
 * recibirlo, por lo mismo que `flush()`: entre que se programa el envío y se
 * manda puede haber más ediciones, y lo que tiene que viajar es lo último.
 */
export async function pushPrefs(): Promise<{ ok: boolean; reason?: string }> {
  const prefs = localPrefs();
  if (prefs.prefsAt === 0) return { ok: true };

  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 ? 'Sesión caducada.' : 'El servidor rechazó los ajustes.',
      };
    }
  } catch {
    return { ok: false, reason: 'Sin conexión con el servidor.' };
  }
  return { ok: true };
}
