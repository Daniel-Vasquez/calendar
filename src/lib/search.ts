import { dayTimeState, formatLongDate, formatWeekday } from './calendar';
import { DEFAULT_COLOR, labelFor, type ColorId, type ColorPalette } from './palette';
import { hasImages, type CalendarData, type DayEntry } from './storage';
import { labelOf, type Tag } from './tags';

/**
 * La lente de la agenda: buscar por texto y filtrar por tipo.
 *
 * Vive aquí y no en el componente por lo de siempre en este proyecto: la regla
 * de qué cuenta como "nota" ya la aplican la cabecera de la agenda y la lista,
 * y tenerla escrita dos veces es la forma de que un día dejen de coincidir.
 *
 * No toca `window` ni React: es texto entrando y booleanos saliendo.
 */

/** Qué clase de día se está mirando. */
export type AgendaType = 'all' | 'notes' | 'reminders';

export const AGENDA_TYPES: { id: AgendaType; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'notes', label: 'Notas' },
  { id: 'reminders', label: 'Recordatorios' },
];

/**
 * Texto comparable: sin mayúsculas y sin tildes.
 *
 * `NFD` separa cada letra acentuada en la letra y su marca, y el rango
 * `U+0300-U+036F` es justo el bloque de esas marcas. Así "Médico" y "medico"
 * acaban siendo la misma cadena, que es lo que espera quien teclea deprisa y
 * sin acentos.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Las palabras de la búsqueda, ya normalizadas.
 *
 * Se parte por espacios y luego se exigen **todas**: escribir "medico marzo"
 * busca el día que cumple las dos cosas, no los que cumplen cualquiera. Es lo
 * que hace un buscador y lo que permite ir estrechando sin borrar lo tecleado.
 */
export function tokenize(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/**
 * ¿Es un día "con nota"?
 *
 * Una imagen sola cuenta, igual que en el recuento de la cabecera: es
 * contenido del día aunque no lleve una línea escrita.
 */
export function hasNote(entry: DayEntry): boolean {
  return Boolean(entry.note) || hasImages(entry);
}

/** ¿Es un día "con recordatorio"? Con uno basta; la pestaña cuenta días. */
export function hasReminder(entry: DayEntry): boolean {
  return Boolean(entry.reminders?.length);
}

/** ¿Encaja el día en la pestaña elegida? Un día puede caer en las dos. */
export function matchesType(entry: DayEntry, type: AgendaType): boolean {
  if (type === 'all') return true;
  if (type === 'notes') return hasNote(entry);
  return hasReminder(entry);
}

/**
 * Todo lo que de un día se puede buscar, en una sola cadena normalizada.
 *
 * Entra la fecha en las formas en que alguien la escribiría —"jueves",
 * "octubre", "15/10", la clave entera—, la nota, el texto propio de **cada**
 * aviso con su hora, el nombre de la categoría y las etiquetas. Lo que no entra
 * son las imágenes: no tienen texto que mirar.
 *
 * Los avisos entran todos y no solo el primero: buscar «18:30» tiene que
 * encontrar el día aunque el aviso de las 18:30 sea el tercero de cuatro.
 */
export function searchableText(
  key: string,
  entry: DayEntry,
  palette: ColorPalette,
  catalogue: Tag[],
): string {
  const [year, month, day] = key.split('-').map(Number);

  const parts = [
    key,
    `${day}/${month}/${year}`,
    `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    formatWeekday(key),
    formatLongDate(key),
    entry.note,
    ...(entry.reminders ?? []).flatMap((reminder) => [reminder.text ?? '', reminder.time]),
    // El nombre de fábrica del color también vale: quien no ha renombrado nada
    // busca "rosa" igual que quien sí lo hizo busca "Entrega".
    entry.marked ? labelFor(palette, entry.color) : '',
    // Por su rótulo, no por su `slug`: se busca «no molestar», no «no-molestar».
    ...(entry.tags ?? []).map((slug) => labelOf(catalogue, slug)),
  ];

  return normalize(parts.join(' '));
}

/** Texto buscable de cada día, listo para comparar sin rehacerlo por tecla. */
export type SearchIndex = Record<string, string>;

export function buildSearchIndex(
  data: CalendarData,
  palette: ColorPalette,
  catalogue: Tag[],
): SearchIndex {
  const index: SearchIndex = {};
  for (const [key, entry] of Object.entries(data)) {
    index[key] = searchableText(key, entry, palette, catalogue);
  }
  return index;
}

/** ¿Están todas las palabras buscadas en este día? Sin palabras, pasa todo. */
export function matchesQuery(haystack: string | undefined, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * La lente de la agenda **menos el tipo**: lo buscado, la etiqueta, el color y
 * el pasado.
 *
 * El tipo se queda fuera a propósito, y no es un descuido: de este resultado
 * salen las cuentas de las pestañas —«Recordatorios 2»—, que tienen que
 * responder «cuántos avisos hay entre lo que estoy mirando», no «cuántos
 * quedan después de elegir una pestaña», que sería siempre el total de esa
 * pestaña o cero.
 *
 * Los cuatro se cumplen a la vez: buscar «entrenamiento» con la etiqueta
 * «Ejercicio» puesta deja los días que cumplen las dos cosas.
 */
export type AgendaLens = {
  tokens: string[];
  /** Un color, o `all`. Un día sin marcar no tiene color y no pasa el filtro. */
  color: ColorId | 'all';
  /** Una etiqueta —por su `slug`—, o `all`. */
  tag: string | 'all';
  hidePast: boolean;
};

export function matchesLens(
  key: string,
  entry: DayEntry,
  lens: AgendaLens,
  haystack: string | undefined,
  today: string,
): boolean {
  if (lens.hidePast && dayTimeState(key, today) === 'past') return false;
  if (lens.color !== 'all') {
    if (!entry.marked || (entry.color ?? DEFAULT_COLOR) !== lens.color) return false;
  }
  if (lens.tag !== 'all' && !entry.tags?.includes(lens.tag)) return false;
  return matchesQuery(haystack, lens.tokens);
}
