import type { CalendarData } from './storage';

/** Una imagen adjunta y el día del que procede. */
export type GalleryImage = {
  /** Clave `YYYY-MM-DD` de la nota; sirve también de identificador. */
  key: string;
  dataUrl: string;
  /** Texto de la nota; vacío si el día solo lleva la imagen. */
  note: string;
};

/**
 * Reúne las imágenes de todas las notas en orden cronológico. Cada día admite
 * una sola imagen, así que la clave del día identifica también a la imagen.
 */
export function collectImages(data: CalendarData): GalleryImage[] {
  // `YYYY-MM-DD` es de ancho fijo: ordenar como texto ya da el orden cronológico.
  return Object.keys(data)
    .sort()
    .flatMap((key) => {
      const { image, note } = data[key];
      return image ? [{ key, dataUrl: image, note }] : [];
    });
}

/** Parámetro con el que el calendario abre un día al cargar: `/?day=2026-03-15`. */
export const DAY_PARAM = 'day';

/** Ruta del calendario con el día ya abierto; destino del botón "Ver nota". */
export function dayHref(key: string): string {
  return `/?${DAY_PARAM}=${key}`;
}
