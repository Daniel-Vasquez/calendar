import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTags, saveTags, TAGS_KEY, type Tag } from '../lib/tags';

/**
 * El catálogo de etiquetas, para cualquier página que las enseñe o las ponga.
 *
 * Hermano de `usePalette`, y por lo mismo: el catálogo es configuración de este
 * dispositivo, se lee tras montar —el primer render tiene que coincidir con el
 * HTML del servidor— y se vigila el evento `storage` para que crear una
 * etiqueta en otra pestaña se vea aquí sin recargar.
 *
 * Lo que **no** está aquí son las etiquetas puestas en un día: esas son
 * contenido, viven dentro del `DayEntry` y las escribe `useCalendarStore` como
 * cualquier otra edición. Ver `tags.ts`.
 */
export type TagStore = {
  catalogue: Tag[];
  /** Cambia el catálogo y lo deja guardado en el mismo paso. */
  update: (recipe: (current: Tag[]) => Tag[]) => void;
};

export function useTags(): TagStore {
  /**
   * Nace vacío y no con las siete de fábrica a propósito: en el primer render
   * todavía no se sabe si hay un catálogo guardado, y pintar las de fábrica
   * para cambiarlas al instante siguiente es el parpadeo que se quiere evitar.
   */
  const [catalogue, setCatalogue] = useState<Tag[]>([]);
  const catalogueRef = useRef<Tag[]>(catalogue);
  catalogueRef.current = catalogue;

  const adopt = useCallback((next: Tag[]) => {
    catalogueRef.current = next;
    setCatalogue(next);
  }, []);

  useEffect(() => {
    adopt(loadTags());
  }, [adopt]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === TAGS_KEY) adopt(loadTags());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adopt]);

  const update = useCallback(
    (recipe: (current: Tag[]) => Tag[]) => {
      const next = recipe(catalogueRef.current);
      saveTags(next);
      adopt(next);
    },
    [adopt],
  );

  return { catalogue, update };
}
