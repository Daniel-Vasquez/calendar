/**
 * Los colores con los que se marca un día: los de fábrica y los que cada
 * persona se haya hecho suyos.
 *
 * Un día **nunca guarda un color**, guarda un `ColorId` —`'rose'`, `'teal'`—.
 * Esa indirección es lo que permite repintar el año entero cambiando una sola
 * cosa: si en el día viajara el hexadecimal, renombrar o retocar un color
 * obligaría a recorrer trescientos sesenta y seis días, subirlos todos y
 * confiar en que ningún dispositivo se quedara a medias.
 *
 * Este archivo lo importan los dos lados —el navegador para pintar, el
 * servidor para validar un `color` que llega por la red—, así que todo lo que
 * toca `window` se guarda primero de que exista.
 */

/**
 * La paleta de fábrica. Salvo el teal por defecto —fijado por la paleta base de
 * la app— todos alcanzan contraste AA (>= 4.5:1) con el texto blanco del número
 * de día.
 *
 * El violeta (#7e22ce) no está en la lista a propósito: queda reservado al día
 * actual, que lo toma del token `--color-today` en global.css. Si cualquier día
 * pudiera llevarlo dejaría de identificar a "hoy" de un vistazo. Quien retoque
 * un color a mano sí puede acercarse a él; es su calendario.
 */
export const DAY_COLORS = [
  { id: 'teal', name: 'Teal', hex: '#0d9488' },
  { id: 'sky', name: 'Azul', hex: '#0369a1' },
  { id: 'indigo', name: 'Índigo', hex: '#4338ca' },
  { id: 'rose', name: 'Rosa', hex: '#be123c' },
  { id: 'orange', name: 'Naranja', hex: '#c2410c' },
  { id: 'amber', name: 'Ámbar', hex: '#b45309' },
  { id: 'green', name: 'Verde', hex: '#15803d' },
  { id: 'slate', name: 'Pizarra', hex: '#334155' },
] as const;

export type ColorId = (typeof DAY_COLORS)[number]['id'];

export const DEFAULT_COLOR: ColorId = 'teal';

const BY_ID = new Map(DAY_COLORS.map((color) => [color.id, color]));

export function isColorId(value: unknown): value is ColorId {
  return typeof value === 'string' && BY_ID.has(value as ColorId);
}

/** El color de fábrica de un id; el teal si falta o no existe. */
function factory(id?: string) {
  return BY_ID.get(id as ColorId) ?? BY_ID.get(DEFAULT_COLOR)!;
}

/**
 * Hex **de fábrica** de un color guardado. Ahí aterrizan también los días que
 * guardaron el violeta antes de reservarse.
 *
 * Para pintar casi nunca es esto lo que se quiere, sino `colorVar`: este
 * ignora lo que la persona haya retocado.
 */
export function colorHex(id?: string): string {
  return factory(id).hex;
}

/** Nombre **de fábrica** de un color. Para el que se ve, `labelFor`. */
export function colorName(id?: string): string {
  return factory(id).name;
}

/* ------------------------------------------------------------------ *
 * La paleta de cada persona
 * ------------------------------------------------------------------ */

/**
 * Lo que alguien ha cambiado de un color: cómo lo llama, de qué tono lo quiere,
 * o las dos cosas. Lo que no esté aquí sale de fábrica.
 */
export type ColorOverride = { name?: string; hex?: string };

/**
 * La paleta personalizada: solo lo retocado, indexado por `ColorId`.
 *
 * Se guardan **los cambios y no el esquema completo** a propósito. Copiar aquí
 * los ocho colores enteros congelaría la paleta de fábrica dentro de cada
 * navegador: afinar un tono en el código no le llegaría nunca a quien ya tuviera
 * algo guardado, aunque jamás hubiera tocado ese color. `resolvePalette`
 * devuelve el esquema completo para quien lo necesite.
 */
export type ColorPalette = Partial<Record<ColorId, ColorOverride>>;

/**
 * Dónde vive **en este navegador**. La clave es la de los nombres de siempre, y
 * no una nueva, para que quien ya tuviera sus categorías bautizadas no las
 * pierda: el saneado de abajo entiende el formato anterior —un texto suelto por
 * color— y lo convierte al de ahora sin que nadie tenga que migrar nada.
 *
 * Desde la tanda 11 esto es la copia local de algo que además vive en la
 * cuenta: la paleta sube a `settings` y baja al abrir. Ver `prefs.ts`.
 */
export const PALETTE_KEY = 'calendar_2026_q4_labels';

/** Una etiqueta es un rótulo de leyenda, no un texto libre: se recorta corta. */
export const MAX_LABEL_LENGTH = 24;

/**
 * ¿Es un color de seis dígitos, `#rrggbb`?
 *
 * Se exige esa forma exacta y no lo que acepte CSS porque este valor acaba en
 * una propiedad personalizada del documento: un texto cualquiera ahí dentro se
 * sustituye tal cual allí donde se use la variable. Es también lo único que
 * emite `<input type="color">`.
 */
export function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Descarta lo que no reconozca en vez de dejar caer la paleta entera. Acepta
 * las dos formas que ha tenido esto: el texto suelto de cuando solo se podían
 * renombrar los colores, y el objeto de ahora.
 */
export function sanitizePalette(raw: unknown): ColorPalette {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const clean: ColorPalette = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isColorId(id)) continue;

    // El formato viejo: `{ rose: "Entrega" }`.
    const source = typeof value === 'string' ? { name: value } : value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;

    const { name, hex } = source as Record<string, unknown>;
    const label = typeof name === 'string' ? name.trim().slice(0, MAX_LABEL_LENGTH) : '';
    const tone = isHex(hex) ? hex.toLowerCase() : '';

    // Un color retocado al mismo tono de fábrica no es un retoque: guardarlo
    // solo serviría para que "Restablecer" pareciera tener trabajo pendiente.
    const changed = tone && tone !== factory(id).hex.toLowerCase() ? tone : '';

    if (label || changed) {
      clean[id] = { ...(label ? { name: label } : {}), ...(changed ? { hex: changed } : {}) };
    }
  }
  return clean;
}

export function loadPalette(): ColorPalette {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PALETTE_KEY);
    return raw ? sanitizePalette(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function savePalette(palette: ColorPalette): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
  } catch {
    /* Igual que el calendario: si el almacenamiento falla, se sigue en memoria. */
  }
}

/**
 * La etiqueta propia del color, o su nombre de fábrica si no tiene ninguna.
 * Recorta al leer: mientras se escribe, la etiqueta se guarda tal cual para
 * no comerse los espacios entre palabras.
 */
export function labelFor(palette: ColorPalette, id?: string): string {
  const custom = isColorId(id) ? palette[id]?.name?.trim() : undefined;
  return custom || colorName(id);
}

/** ¿Se ha renombrado este color? Distingue "Entrega" de "Rosa" en la interfaz. */
export function hasCustomLabel(palette: ColorPalette, id?: string): boolean {
  return isColorId(id) && Boolean(palette[id]?.name?.trim());
}

/** El tono que toca pintar: el retocado si lo hay, el de fábrica si no. */
export function hexFor(palette: ColorPalette, id?: string): string {
  const custom = isColorId(id) ? palette[id]?.hex : undefined;
  return isHex(custom) ? custom : colorHex(id);
}

/** Un color ya resuelto: es lo que se enseña, venga de donde venga. */
export type ResolvedColor = { id: ColorId; name: string; hex: string };

/** El esquema completo —los ocho colores— con lo retocado ya aplicado. */
export function resolvePalette(palette: ColorPalette): ResolvedColor[] {
  return DAY_COLORS.map((color) => ({
    id: color.id,
    name: labelFor(palette, color.id),
    hex: hexFor(palette, color.id),
  }));
}

/** ¿Está todo como vino de fábrica? Lo pregunta el botón de restablecer. */
export function isDefaultPalette(palette: ColorPalette): boolean {
  return Object.keys(sanitizePalette(palette)).length === 0;
}

/* ------------------------------------------------------------------ *
 * Cómo llega el color retocado a la pantalla
 * ------------------------------------------------------------------ */

/**
 * El color de un día se dibuja en una docena de sitios —la casilla, su punto,
 * la fila de la agenda, la tarjeta del recordatorio, la leyenda, las muestras
 * del modal— y la mitad de ellos no recibe la paleta ni tendría por qué:
 * `DayCell` solo sabe de un día, y hacerle llegar la paleta obligaría a
 * atravesar `MonthCard` con una prop que no usa.
 *
 * Así que el color no viaja por las props: viaja por una **propiedad
 * personalizada del documento**. Cada id tiene la suya, y pintar es pedirla con
 * el color de fábrica como respaldo. De ahí salen tres cosas gratis:
 *
 * 1. Retocar un color repinta **todo** lo que lo usa en el mismo cuadro, sin un
 *    solo repintado de React y sin que nadie tenga que suscribirse a nada.
 * 2. El HTML del servidor ya trae el color correcto dentro del respaldo, así
 *    que no hay destello ni desajuste de hidratación.
 * 3. Una página que no sabe nada de la paleta —la galería, los recordatorios—
 *    pinta bien igualmente.
 */
export function cssVar(id: ColorId): string {
  return `--day-${id}`;
}

/** `var(--day-rose, #be123c)`: lo que va en el `style` de quien pinta. */
export function colorVar(id?: string): string {
  const color = factory(id);
  return `var(${cssVar(color.id)}, ${color.hex})`;
}

/**
 * Escribe la paleta en el documento. Lo que no esté retocado se **quita** en
 * vez de escribirse con su valor de fábrica: así el respaldo de `colorVar`
 * vuelve a mandar, y un color afinado en el código le llega a todo el mundo.
 */
export function applyPalette(palette: ColorPalette): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;

  for (const color of DAY_COLORS) {
    const custom = palette[color.id]?.hex;
    if (isHex(custom)) root.setProperty(cssVar(color.id), custom);
    else root.removeProperty(cssVar(color.id));
  }
}
