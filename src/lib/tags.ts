/**
 * Etiquetas: el catálogo de las que existen y las que lleva puestas un día.
 *
 * Son dos cosas de naturaleza distinta y por eso viven en sitios distintos:
 *
 * - **El catálogo** —qué etiquetas hay— es configuración de la persona, como la
 *   paleta de colores: se guarda en `localStorage` y desde la tanda 11 sube
 *   además a la cuenta, por `settings`. Ver `prefs.ts`.
 * - **Lo que un día tiene puesto** es contenido del día, como la nota o el
 *   aviso, así que vive dentro del `DayEntry` y sube a la cuenta por la vía de
 *   siempre. Guardarlo aparte lo dejaría fuera de la sincronía, y un día
 *   borrado o mudado de fecha se llevaría sus etiquetas a ninguna parte.
 *
 * El día guarda **el `slug`, no el rótulo**. Es la misma indirección que con los
 * colores y por el mismo motivo: si guardara el texto, «Trabajo» y «trabajo»
 * serían dos etiquetas distintas y no habría forma de volver a juntarlas.
 *
 * Este archivo no importa nada del proyecto ni toca `window` sin mirar: lo
 * necesitan el navegador para editar y el servidor para sanear lo que llega.
 */

/** El catálogo de partida. Sale en cuanto no hay nada guardado. */
export const DEFAULT_TAGS = [
  'Deporte',
  'Ejercicio',
  'Diversión',
  'Descanso',
  'No molestar',
  'Trabajo',
  'Estudio',
] as const;

export const TAGS_KEY = 'calendar_2026_q4_tags';

/** Una etiqueta es un distintivo, no una frase: cabe en una línea o no cabe. */
export const MAX_TAG_LENGTH = 20;

/** Tope del catálogo. Pasado eso, el selector deja de poder mirarse de un vistazo. */
export const MAX_TAGS = 24;

/**
 * Tope por día. Las etiquetas se enseñan en una fila de la agenda y en una
 * tarjeta de recordatorio, y media docena ya llena el renglón.
 */
export const MAX_TAGS_PER_DAY = 6;

/** Una etiqueta del catálogo: su identidad y cómo se escribe. */
export type Tag = { slug: string; label: string };

/**
 * La identidad de una etiqueta a partir de su rótulo: sin tildes, en
 * minúsculas y con guiones. «No molestar» y «no molestar» son la misma.
 *
 * Es pariente de `normalize` en `search.ts` pero no la misma función, y no se
 * comparten a propósito: aquella prepara texto para **compararlo** y puede
 * cambiar de criterio cuando cambie la búsqueda; esta fabrica la **clave** con
 * la que ya hay días guardados, y cambiarla los desemparejaría.
 */
export function slugify(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_LENGTH);
}

/** El rótulo tal y como se escribe: recortado y sin espacios de más. */
export function cleanLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
}

/** El catálogo de fábrica, ya con sus identidades. */
export function defaultCatalogue(): Tag[] {
  return DEFAULT_TAGS.map((label) => ({ slug: slugify(label), label }));
}

/**
 * Sanea un catálogo venido de `localStorage` o de un archivo importado. Lo que
 * no se entienda se cae solo, sin llevarse por delante al resto.
 */
export function sanitizeCatalogue(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) return [];

  const clean: Tag[] = [];
  for (const value of raw) {
    // Se acepta el rótulo suelto además del objeto: así un archivo escrito a
    // mano —o una versión futura que simplifique— sigue entrando.
    const label = cleanLabel(
      typeof value === 'string'
        ? value
        : typeof (value as Tag)?.label === 'string'
          ? (value as Tag).label
          : '',
    );
    if (!label) continue;

    const slug = slugify(label);
    if (!slug || clean.some((tag) => tag.slug === slug)) continue;

    clean.push({ slug, label });
    if (clean.length === MAX_TAGS) break;
  }
  return clean;
}

/**
 * El catálogo guardado, o el de fábrica si **nunca se ha guardado ninguno**.
 *
 * La diferencia entre «no hay registro» y «hay uno vacío» es la que impide que
 * las siete de fábrica resuciten en cuanto alguien las borre todas: un catálogo
 * vacío a propósito es una respuesta legítima y se respeta.
 */
export function loadTags(): Tag[] {
  return loadSavedTags() ?? defaultCatalogue();
}

/**
 * El catálogo guardado, o `null` si **aquí nunca se ha guardado ninguno**.
 *
 * Es `loadTags` sin el respaldo de fábrica, y existe para la sincronía: lo que
 * sube a la cuenta tiene que ser lo que alguien eligió, no las siete de fábrica
 * que este dispositivo enseña por no tener nada. Subirlas como si fueran una
 * decisión pisaría el catálogo de la cuenta con algo que nadie escribió.
 *
 * `null` y `[]` siguen siendo cosas distintas aquí también: ver `loadTags`.
 */
export function loadSavedTags(): Tag[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TAGS_KEY);
    if (raw === null) return null;
    return sanitizeCatalogue(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveTags(tags: Tag[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {
    /* Igual que el calendario: si el almacenamiento falla, se sigue en memoria. */
  }
}

/**
 * Las etiquetas que lleva un día. Entra lo que haya guardado un día —o lo que
 * mande el navegador al servidor— y sale una lista de identidades sin repetir.
 *
 * **No se comprueba contra el catálogo** a propósito: un día etiquetado en el
 * portátil no puede perder su etiqueta por abrirse en un móvil que todavía no
 * lo ha bajado. Desde la tanda 11 el catálogo sí llega a la cuenta, pero llega
 * por su propia vía y puede tardar más que el día.
 */
export function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const clean: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const slug = slugify(value);
    if (!slug || clean.includes(slug)) continue;
    clean.push(slug);
    if (clean.length === MAX_TAGS_PER_DAY) break;
  }
  return clean;
}

/**
 * Cómo se escribe una etiqueta que lleva un día.
 *
 * Si el catálogo la conoce, como allí esté. Si no —se borró, o viene de otro
 * dispositivo—, se compone a partir de la identidad en vez de esconderla: una
 * etiqueta puesta se enseña siempre, aunque ya no se pueda volver a elegir.
 */
export function labelOf(catalogue: Tag[], slug: string): string {
  const known = catalogue.find((tag) => tag.slug === slug);
  if (known) return known.label;
  const plain = slug.replace(/-/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** Añade una etiqueta al catálogo. Devuelve el mismo si no hay nada que añadir. */
export function addTag(catalogue: Tag[], label: string): Tag[] {
  const clean = cleanLabel(label);
  const slug = slugify(clean);
  if (!slug || catalogue.length >= MAX_TAGS) return catalogue;
  if (catalogue.some((tag) => tag.slug === slug)) return catalogue;
  return [...catalogue, { slug, label: clean }];
}

export function removeTag(catalogue: Tag[], slug: string): Tag[] {
  return catalogue.filter((tag) => tag.slug !== slug);
}

/** Pone o quita una etiqueta de un día, respetando el tope. */
export function toggleTag(current: string[], slug: string): string[] {
  if (current.includes(slug)) return current.filter((tag) => tag !== slug);
  if (current.length >= MAX_TAGS_PER_DAY) return current;
  return [...current, slug];
}

/** ¿Dicen lo mismo? Lo usa la sincronía para saber si el día ha cambiado. */
export function sameTags(a?: string[], b?: string[]): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((tag, i) => tag === right[i]);
}
