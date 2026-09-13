import { useCallback, useEffect, useState } from 'react';

/**
 * El aviso efímero del pie: lo que acaba de pasar y, si tiene vuelta, cómo
 * deshacerlo.
 *
 * Estaba copiado en el calendario, en la agenda y en los recordatorios —el
 * estado, el temporizador de ocho segundos y treinta líneas de JSX idénticas—,
 * y con los ajustes abriéndose desde cualquier página hacía falta una cuarta
 * copia en la galería. La cuarta era la que se iba a desviar.
 *
 * `undo` es una función y no una instantánea del calendario, que es lo que
 * guardaban las tres copias. La diferencia importa desde que hay cosas que
 * deshacer **fuera** del calendario: borrar una etiqueta cambia los días y el
 * catálogo, y una instantánea de los días solo sabe devolver la mitad.
 */
export type Notice = { message: string; undo?: () => void };

export type NoticeStore = {
  notice: Notice | null;
  /** Cuenta algo. Con `undo`, el aviso ofrece el botón de deshacer. */
  announce: (message: string, undo?: () => void) => void;
  dismiss: () => void;
};

export function useNotice(): NoticeStore {
  const [notice, setNotice] = useState<Notice | null>(null);

  /**
   * Estable a propósito: el almacén del calendario se la guarda para contar lo
   * que pase en el `pull` inicial, y una función nueva en cada render le haría
   * repetir esa primera lectura en cada repintado.
   */
  const announce = useCallback((message: string, undo?: () => void) => {
    setNotice({ message, ...(undo ? { undo } : {}) });
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);

  // El aviso caduca solo. Cada cambio crea un objeto nuevo, así que el
  // temporizador se reinicia con él en lugar de heredar la cuenta anterior.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return { notice, announce, dismiss };
}

/**
 * La banda del pie. Va bajo los modales (z-50) y sin capturar el cursor salvo
 * en la tarjeta: ocupa todo el ancho y si no bloquearía lo que haya debajo.
 */
export default function NoticeBar({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  if (!notice) return null;

  return (
    <div
      role="status"
      className="animate-panel-in print-hidden pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-canvas shadow-2xl">
        <span>{notice.message}</span>

        {notice.undo && (
          <button
            type="button"
            onClick={() => {
              notice.undo?.();
              onDismiss();
            }}
            className="rounded-lg bg-canvas/15 px-3 py-1 text-sm font-semibold transition-colors hover:bg-canvas/25 focus-visible:ring-2 focus-visible:ring-canvas focus-visible:outline-none"
          >
            Deshacer
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar aviso"
          className="rounded-lg p-1 text-canvas/70 transition-colors hover:text-canvas focus-visible:ring-2 focus-visible:ring-canvas focus-visible:outline-none"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
