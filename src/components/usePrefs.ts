import { useCallback, useEffect, useRef } from 'react';
import { usePalette } from './usePalette';
import { useTags } from './useTags';
import { loadPalette, type ColorPalette } from '../lib/palette';
import { loadTags, type Tag } from '../lib/tags';
import { pullPrefs, pushPrefs, savePrefsAt } from '../lib/prefs';

/**
 * La paleta y el catálogo de etiquetas, sincronizados con la cuenta.
 *
 * Es el dueño único de los dos, y compone `usePalette` y `useTags` en vez de
 * sustituirlos: aquellos siguen siendo quienes leen, escriben y aplican en
 * **este** navegador, y esto añade encima el viaje a la cuenta. Así una página
 * que solo pinta no cambia en nada y la lógica de `localStorage` no se duplica.
 *
 * **Van juntos y con una sola marca de tiempo** porque comparten documento y se
 * editan en la misma pantalla. Ver `prefs.ts`, que explica el trato.
 *
 * Lo que este hook añade sobre los dos que compone es una distinción que ya
 * conoce `useCalendarStore`: **adoptar no es editar**. Lo que baja del servidor
 * se guarda sin ponerle marca nueva ni encolarlo de vuelta; lo que toca la
 * persona sí. Sin esa diferencia, bajar una paleta la volvería a subir, y así
 * en bucle.
 */
export type PrefsStore = {
  palette: ColorPalette;
  catalogue: Tag[];
  updatePalette: (recipe: (current: ColorPalette) => ColorPalette) => void;
  updateTags: (recipe: (current: Tag[]) => Tag[]) => void;
};

export function usePrefs(onMessage?: (message: string) => void): PrefsStore {
  const { palette, update: writePalette } = usePalette();
  const { catalogue, update: writeTags } = useTags();

  const pushTimerRef = useRef(0);
  /** Subida en curso: dos a la vez mandarían lo mismo dos veces. */
  const pushingRef = useRef(false);
  /**
   * El aviso, en una referencia. Si fuera dependencia del efecto, una página
   * que pasara una función nueva en cada render repetiría el `pull` inicial en
   * cada repintado. Misma razón que en `useCalendarStore`.
   */
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;

  const runPush = useCallback(async () => {
    if (pushingRef.current) return;
    pushingRef.current = true;
    try {
      // Lo que se manda se relee de `localStorage` dentro de `pushPrefs`: entre
      // que esto se programa y se envía puede haber más ediciones.
      await pushPrefs();
    } finally {
      pushingRef.current = false;
    }
  }, []);

  const schedulePush = useCallback(() => {
    window.clearTimeout(pushTimerRef.current);
    // Teclear un nombre de categoría dispara un guardado por letra. Esperar un
    // momento los agrupa en una sola subida, igual que hace el calendario.
    pushTimerRef.current = window.setTimeout(() => void runPush(), 1200);
  }, [runPush]);

  useEffect(() => () => window.clearTimeout(pushTimerRef.current), []);

  /** Una edición de la persona: se guarda, se marca la hora y se encola. */
  const touch = useCallback(() => {
    savePrefsAt(Date.now());
    schedulePush();
  }, [schedulePush]);

  const updatePalette = useCallback(
    (recipe: (current: ColorPalette) => ColorPalette) => {
      writePalette(recipe);
      touch();
    },
    [writePalette, touch],
  );

  const updateTags = useCallback(
    (recipe: (current: Tag[]) => Tag[]) => {
      writeTags(recipe);
      touch();
    },
    [writeTags, touch],
  );

  /**
   * Primera parada: traer lo de la cuenta y decidir quién manda.
   *
   * Lo adoptado ya está en `localStorage` cuando `pullPrefs` vuelve, así que
   * aquí solo hay que hacérselo saber a los dos hooks. Se les pasa por su
   * `update` —que reescribe lo mismo y lo aplica— y **no** por `touch`: esto no
   * es una edición y no debe volver a subir.
   */
  useEffect(() => {
    let alive = true;

    void (async () => {
      const result = await pullPrefs();
      if (!alive || !result.ok) return;

      if (result.adopted) {
        writePalette(() => loadPalette());
        writeTags(() => loadTags());
      }

      if (!result.queued) return;
      await runPush();
      if (alive && result.migrated) {
        messageRef.current?.('Se subieron tus categorías y etiquetas a tu cuenta.');
      }
    })();

    return () => {
      alive = false;
    };
  }, [writePalette, writeTags, runPush]);

  // Al recuperar la conexión se reintenta sin esperar a la siguiente edición.
  useEffect(() => {
    function retry() {
      void runPush();
    }
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [runPush]);

  return { palette, catalogue, updatePalette, updateTags };
}
