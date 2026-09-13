import { srcOf, thumbSrc } from './image';
import type { CalendarData, DayEntry } from './storage';

/** Una imagen adjunta y el día del que procede. */
export type GalleryImage = {
  /** `YYYY-MM-DD#n`: día y posición, único en toda la galería. */
  id: string;
  /** Clave `YYYY-MM-DD` de la nota. */
  key: string;
  /**
   * El adjunto tal y como lo guarda el día: una referencia `cld:…` o, mientras
   * esté sin subir, su data URL. Quien lo pinta lo pasa por `srcOf`, que es
   * quien sabe qué hacer con cada una.
   */
  ref: string;
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
      return images.map((ref, index) => ({
        id: `${key}#${index}`,
        key,
        ref,
        index,
        count: images.length,
        note,
      }));
    });
}

/**
 * La vista previa de un día para la rejilla y la agenda, o nada si no la hay.
 *
 * Dos procedencias y un orden claro: si este navegador tiene el adjunto se
 * pinta el suyo —incluida la data URL de uno recién elegido, que aún no existe
 * en ningún otro sitio—, y si no, la miniatura del día, que es lo único que
 * viaja dentro del documento y por eso está siempre, sin esperar a ninguna
 * descarga.
 *
 * Las dos acaban pidiendo la misma derivada de 192, así que un día ya subido
 * enseña exactamente lo mismo lo tenga descargado o no.
 */
export function previewSrc(entry: DayEntry | undefined, key: string): string | undefined {
  const first = entry?.images?.[0];
  if (first) return srcOf(first, key, 0, 'thumb');
  return entry?.thumb ? thumbSrc(key, entry.thumb) : undefined;
}
