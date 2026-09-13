import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyPalette,
  loadPalette,
  PALETTE_KEY,
  savePalette,
  type ColorPalette,
} from '../lib/palette';

/**
 * La paleta de esta persona, para cualquier página que pinte colores de día.
 *
 * Estaba copiada en el calendario y en la agenda —leer `localStorage` tras
 * montar, vigilar el evento `storage`— y ahora que además hay que escribir en
 * ella y llevarla al documento, la tercera copia habría sido la que se
 * desviara. Las páginas que solo pintan (los recordatorios) la llaman y ni
 * miran lo que devuelve: les basta con que las variables del documento queden
 * puestas y se mantengan al día.
 *
 * Leer espera a estar montado a propósito: el primer render tiene que coincidir
 * con el HTML del servidor, que no conoce `localStorage`. Eso **no** provoca
 * destello, porque el color de fábrica viaja dentro del respaldo de `colorVar`
 * y el guion de `Layout.astro` deja puestas las variables antes del primer
 * píxel; esto solo las confirma.
 */
export type PaletteStore = {
  palette: ColorPalette;
  /**
   * Cambia la paleta y la deja guardada y aplicada en el mismo paso.
   *
   * Es la **única** vía de escritura, y va por una función en vez de por un
   * `useEffect` que vigile el estado por una razón concreta: ese efecto también
   * corre en el primer render, cuando la paleta todavía está vacía porque no se
   * ha leído, y guardaría ese vacío encima de lo que hubiera. Aquí solo se
   * escribe cuando alguien toca algo.
   */
  update: (recipe: (current: ColorPalette) => ColorPalette) => void;
};

export function usePalette(): PaletteStore {
  const [palette, setPalette] = useState<ColorPalette>({});
  /** La última paleta conocida, para que `update` no dependa del render. */
  const paletteRef = useRef<ColorPalette>(palette);
  paletteRef.current = palette;

  const adopt = useCallback((next: ColorPalette) => {
    paletteRef.current = next;
    setPalette(next);
    applyPalette(next);
  }, []);

  useEffect(() => {
    adopt(loadPalette());
  }, [adopt]);

  // Renombrar o retocar un color en otra pestaña se ve aquí sin recargar.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === PALETTE_KEY) adopt(loadPalette());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adopt]);

  const update = useCallback(
    (recipe: (current: ColorPalette) => ColorPalette) => {
      const next = recipe(paletteRef.current);
      savePalette(next);
      adopt(next);
    },
    [adopt],
  );

  return { palette, update };
}
