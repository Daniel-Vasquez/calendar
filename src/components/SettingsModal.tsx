import { useEffect, useId, useLayoutEffect, useRef, type ComponentProps } from 'react';
import SettingsPanel from './SettingsPanel';
import { useDialog } from './useDialog';

type Props = ComponentProps<typeof SettingsPanel> & {
  /** Botón que abrió el modal: origen de la animación y destino del foco al cerrar. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

/**
 * "Categorías y datos" en un diálogo que brota desde el engrane de la
 * cabecera. Comparte con DayModal el cierre por Escape, la trampa de Tab y
 * el bloqueo del scroll; lo propio es el `transform-origin` dinámico.
 */
export default function SettingsModal({ triggerRef, onClose, ...panelProps }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useDialog(panelRef, onClose);

  // El panel se centra en pantalla, pero debe parecer que nace en el botón:
  // el origen de la escala se traduce a coordenadas del propio panel. Va en
  // layout effect para fijarlo antes de que arranque la animación, y usa
  // `offset*` —que ignoran transformaciones— porque el overlay es `fixed`
  // a pantalla completa y su origen coincide con el de la ventana.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;

    const from = trigger.getBoundingClientRect();
    const x = from.left + from.width / 2 - panel.offsetLeft;
    const y = from.top + from.height / 2 - panel.offsetTop;
    panel.style.transformOrigin = `${x}px ${y}px`;
  }, [triggerRef]);

  // Al abrir, el foco entra en la X; al cerrar, vuelve al engrane.
  useEffect(() => {
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    return () => trigger?.focus();
  }, [triggerRef]);

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-pop-in my-auto w-full max-w-3xl rounded-2xl border border-edge bg-canvas p-6 shadow-2xl"
      >
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Ajustes</p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink">
              Categorías y datos
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mt-1 -mr-1 rounded-lg p-2 text-ink-muted transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <SettingsPanel {...panelProps} />
      </div>
    </div>
  );
}
