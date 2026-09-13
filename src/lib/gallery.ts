import type { CalendarData } from './storage';

/** Una imagen adjunta y el día del que procede. */
export type GalleryImage = {
  /** `YYYY-MM-DD#n`: día y posición, único en toda la galería. */
  id: string;
  /** Clave `YYYY-MM-DD` de la nota. */
  key: string;
  dataUrl: string;
  /** Posición dentro de la nota (0-based) y cuántas lleva esa nota en total. */
  index: number;
  count: number;
  /** Texto de la nota; vacío si el día solo lleva imágenes. */
  note: string;
};

/**
 * Reúne las imágenes de todas las notas en orden cronológico y, dentro de un
 * mismo día, en el orden en que se adjuntaron.
 */
export function collectImages(data: CalendarData): GalleryImage[] {
  // `YYYY-MM-DD` es de ancho fijo: ordenar como texto ya da el orden cronológico.
  return Object.keys(data)
    .sort()
    .flatMap((key) => {
      const { images = [], note } = data[key];
      return images.map((dataUrl, index) => ({
        id: `${key}#${index}`,
        key,
        dataUrl,
        index,
        count: images.length,
        note,
      }));
    });
}
