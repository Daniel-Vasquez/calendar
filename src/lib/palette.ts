/**
 * Colores disponibles para marcar un día. Salvo el teal por defecto —fijado
 * por la paleta base de la app— todos alcanzan contraste AA (>= 4.5:1) con
 * el texto blanco del número de día.
 */
export const DAY_COLORS = [
  { id: 'teal', name: 'Teal', hex: '#0d9488' },
  { id: 'sky', name: 'Azul', hex: '#0369a1' },
  { id: 'indigo', name: 'Índigo', hex: '#4338ca' },
  { id: 'purple', name: 'Violeta', hex: '#7e22ce' },
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

/** Hex de un color guardado; cae al teal por defecto si falta o no existe. */
export function colorHex(id?: string): string {
  return (BY_ID.get(id as ColorId) ?? BY_ID.get(DEFAULT_COLOR)!).hex;
}

export function colorName(id?: string): string {
  return (BY_ID.get(id as ColorId) ?? BY_ID.get(DEFAULT_COLOR)!).name;
}
