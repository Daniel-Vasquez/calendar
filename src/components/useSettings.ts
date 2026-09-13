import { useCallback, useMemo, useRef, useState, type ComponentProps } from 'react';
import type SettingsPanel from './SettingsPanel';
import { usePalette } from './usePalette';
import { useTags } from './useTags';
import { todayKey } from '../lib/calendar';
import { colorHex, MAX_LABEL_LENGTH, type ColorId, type ColorPalette } from '../lib/palette';
import { addTag, removeTag, type Tag } from '../lib/tags';
import { downloadFile, exportFilename, parseImport, toIcs, toJson } from '../lib/transfer';
import type { CalendarData } from '../lib/storage';

/** Lo que la barra necesita para ofrecer el engrane y pintar su modal. */
export type SettingsControls = {
  /** El engrane. De él nace la animación del modal y a él vuelve el foco. */
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Todo lo que el panel pinta y llama. */
  panel: ComponentProps<typeof SettingsPanel>;
};

export type SettingsStore = {
  /** La paleta de esta persona. La pinta la página, no solo los ajustes. */
  palette: ColorPalette;
  /** El catálogo de etiquetas, por lo mismo. */
  catalogue: Tag[];
  settings: SettingsControls;
};

type Input = {
  data: CalendarData;
  setData: React.Dispatch<React.SetStateAction<CalendarData>>;
  /** Cómo cuenta la página lo que pasa. Ver `useNotice`. */
  announce: (message: string, undo?: () => void) => void;
};

/**
 * Los ajustes, enteros, para cualquier página que tenga el calendario a mano.
 *
 * Vivían dentro de `CalendarDashboard`, y con ellos el engrane: abrir los
 * ajustes desde la agenda obligaba a volver a la portada, perdiendo de paso lo
 * que se estuviera mirando. El engrane está ahora en la barra —que sí sale en
 * todas las páginas— y lo que le falta para funcionar sale de aquí.
 *
 * **Devuelve también la paleta y el catálogo**, y eso no es comodidad: son
 * estado con dueño único. Si la página llamara a `usePalette` por su cuenta y
 * este hook llamara a otra, renombrar una categoría en los ajustes escribiría
 * en un ejemplar y la lista seguiría leyendo del otro —el evento `storage` no
 * llega a la pestaña que escribe—, así que el nombre nuevo no se vería hasta
 * recargar. Un solo ejemplar por página, y sale de aquí.
 */
export function useSettings({ data, setData, announce }: Input): SettingsStore {
  const { palette, update: updatePalette } = usePalette();
  const { catalogue, update: updateTags } = useTags();

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /* ---------------- colores ---------------- */

  /**
   * Cambia una pieza de un color y tira lo que quede vacío.
   *
   * El color sin nombre propio ni tono propio **se borra del todo** en lugar de
   * quedarse como `{}`: es lo que hace que «Restablecer» sepa si le queda algo
   * por hacer, y lo que deja que un color afinado en el código llegue a quien
   * nunca lo tocó.
   */
  const changeColor = useCallback(
    (id: ColorId, change: { name?: string; hex?: string }) => {
      updatePalette((current) => {
        const next = { ...current };
        const merged = { ...next[id], ...change };
        // Sin texto vuelve a mandar el nombre de fábrica del color.
        if (!merged.name?.trim()) delete merged.name;
        // Y el tono de fábrica, escrito a mano, tampoco es un retoque.
        if (!merged.hex || merged.hex === colorHex(id)) delete merged.hex;

        if (merged.name || merged.hex) next[id] = merged;
        else delete next[id];
        return next;
      });
    },
    [updatePalette],
  );

  const onRenameColor = useCallback(
    (id: ColorId, label: string) => changeColor(id, { name: label.slice(0, MAX_LABEL_LENGTH) }),
    [changeColor],
  );

  const onRecolor = useCallback(
    (id: ColorId, hex: string) => changeColor(id, { hex: hex.toLowerCase() }),
    [changeColor],
  );

  /** Devuelve los ocho colores a como vinieron: nombres y tonos de una vez. */
  const onResetPalette = useCallback(() => updatePalette(() => ({})), [updatePalette]);

  /* ---------------- etiquetas ---------------- */

  const onAddTag = useCallback(
    (label: string) => updateTags((current) => addTag(current, label)),
    [updateTags],
  );

  /**
   * Borra una etiqueta del catálogo **y de todos los días que la llevaban**.
   *
   * La alternativa era dejarlas puestas y que siguieran viéndose sin poder
   * elegirse. Es defendible —no se pierde nada— pero deja la única forma de
   * quitarlas en abrir uno a uno los días, y eso no es una salida. Así que se
   * quitan de golpe y el aviso del pie ofrece deshacerlo, catálogo incluido:
   * deshacer solo la mitad dejaría etiquetas puestas que ya nadie puede quitar.
   */
  const onDeleteTag = useCallback(
    (slug: string) => {
      const snapshot = data;
      const tags = catalogue;
      const label = catalogue.find((tag) => tag.slug === slug)?.label ?? slug;

      let touched = 0;
      setData((current) => {
        const next = { ...current };
        for (const [key, entry] of Object.entries(current)) {
          if (!entry.tags?.includes(slug)) continue;
          const left = entry.tags.filter((tag) => tag !== slug);
          const { tags: _quitadas, ...rest } = entry;
          next[key] = { ...rest, ...(left.length ? { tags: left } : {}) };
          touched++;
        }
        return next;
      });

      updateTags((current) => removeTag(current, slug));
      announce(
        touched
          ? `Se borró «${label}» y se quitó de ${touched} ${touched === 1 ? 'día' : 'días'}.`
          : `Se borró la etiqueta «${label}».`,
        () => {
          setData(snapshot);
          updateTags(() => tags);
        },
      );
    },
    [data, catalogue, setData, updateTags, announce],
  );

  /** En cuántos días está puesta cada etiqueta. Lo enseña Ajustes antes de borrar. */
  const tagUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of Object.values(data)) {
      for (const slug of entry.tags ?? []) counts[slug] = (counts[slug] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  /* ---------------- entrada y salida ---------------- */

  // La fecha se pide al pulsar y no se recibe como prop: solo sirve para el
  // nombre del archivo, y en ese momento el navegador la sabe con seguridad.
  const onExportJson = useCallback(() => {
    downloadFile(
      toJson(data, palette, catalogue),
      exportFilename('json', todayKey()),
      'application/json',
    );
  }, [data, palette, catalogue]);

  const onExportIcs = useCallback(() => {
    downloadFile(toIcs(data, palette, catalogue), exportFilename('ics', todayKey()), 'text/calendar');
  }, [data, palette, catalogue]);

  const onImport = useCallback(
    async (file: File) => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        announce('No se pudo leer el archivo.');
        return;
      }

      const result = parseImport(text);
      if (!result.ok) {
        announce(result.reason);
        return;
      }

      // Fusiona en vez de reemplazar: lo importado pisa el mismo día, el resto
      // del año sigue donde estaba. Deshacer devuelve las dos cosas.
      const snapshot = data;
      setData((current) => ({ ...current, ...result.data }));
      announce(`Se importaron ${result.days} ${result.days === 1 ? 'día' : 'días'}.`, () =>
        setData(snapshot),
      );
    },
    [data, setData, announce],
  );

  const panel = useMemo(
    () => ({
      palette,
      hasData: Object.keys(data).length > 0,
      onRenameColor,
      onRecolor,
      onResetPalette,
      catalogue,
      tagUsage,
      onAddTag,
      onDeleteTag,
      onExportJson,
      onExportIcs,
      onImport,
    }),
    [
      palette,
      data,
      onRenameColor,
      onRecolor,
      onResetPalette,
      catalogue,
      tagUsage,
      onAddTag,
      onDeleteTag,
      onExportJson,
      onExportIcs,
      onImport,
    ],
  );

  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  return {
    palette,
    catalogue,
    settings: { buttonRef, open, onOpen, onClose, panel },
  };
}
