import { colorName, isColorId, type ColorId } from './palette';

export const LABELS_KEY = 'calendar_2026_q4_labels';

/** Nombre que el usuario le da a cada color. Sin entrada, manda el de fábrica. */
export type ColorLabels = Partial<Record<ColorId, string>>;

/** Una etiqueta es un rótulo de leyenda, no un texto libre: se recorta corta. */
export const MAX_LABEL_LENGTH = 24;

function sanitize(raw: unknown): ColorLabels {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const clean: ColorLabels = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isColorId(id) || typeof value !== 'string') continue;
    const label = value.trim().slice(0, MAX_LABEL_LENGTH);
    if (label) clean[id] = label;
  }
  return clean;
}

export function loadLabels(): ColorLabels {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LABELS_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveLabels(labels: ColorLabels): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
  } catch {
    /* Igual que el calendario: si el almacenamiento falla, se sigue en memoria. */
  }
}

/**
 * La etiqueta propia del color, o su nombre de fábrica si no tiene ninguna.
 * Recorta al leer: mientras se escribe, la etiqueta se guarda tal cual para
 * no comerse los espacios entre palabras.
 */
export function labelFor(labels: ColorLabels, id?: string): string {
  const custom = isColorId(id) ? labels[id]?.trim() : undefined;
  return custom || colorName(id);
}

/** ¿Se ha renombrado este color? Distingue "Entrega" de "Rosa" en la interfaz. */
export function hasCustomLabel(labels: ColorLabels, id?: string): boolean {
  return isColorId(id) && Boolean(labels[id]?.trim());
}
