import { useEffect, useId, useRef } from 'react';
import { formatLongDate, formatWeekday } from '../lib/calendar';
import { dayHref, type GalleryImage } from '../lib/gallery';
import { useDialog } from './useDialog';

type Props = {
  image: GalleryImage;
  /** Miniatura que abrió el visor: a ella vuelve el foco al cerrar. */
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
};

/**
 * Imagen ampliada sobre un fondo oscuro. Comparte con el resto de modales el
 * cierre por Escape, la trampa de Tab y el bloqueo del scroll; lo propio es
 * el enlace que lleva al día del calendario del que procede la imagen.
 */
export default function Lightbox({ image, triggerRef, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useDialog(panelRef, onClose);

  // Al abrir, el foco entra en la X; al cerrar, vuelve a la miniatura.
  useEffect(() => {
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    return () => trigger?.focus();
  }, [triggerRef]);

  const date = formatLongDate(image.key);

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-panel-in flex max-h-full w-11/12 max-w-4xl flex-col md:w-[70%] overflow-hidden rounded-2xl border border-edge bg-canvas shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {formatWeekday(image.key)}
              {image.count > 1 && ` · Imagen ${image.index + 1} de ${image.count}`}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink">
              {date}
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

        {/* `min-h-0` deja que la imagen ceda altura al pie en pantallas bajas
            en lugar de empujar los botones fuera del panel. */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-surface">
          <img
            src={image.dataUrl}
            alt={
              image.count > 1
                ? `Imagen ${image.index + 1} de ${image.count} adjunta al ${date}`
                : `Imagen adjunta al ${date}`
            }
            className="max-h-[60vh] w-auto max-w-full object-contain"
          />
        </div>

        {/* La nota acompaña a la imagen; sin texto se dice explícitamente
            para que el pie no parezca un hueco. `whitespace-pre-line`
            respeta los saltos escritos en el textarea, como en la agenda. */}
        <div className="max-h-40 overflow-y-auto border-t border-edge px-5 py-4">
          {image.note ? (
            <p className="text-sm whitespace-pre-line text-ink-soft">{image.note}</p>
          ) : (
            <p className="text-sm text-ink-muted italic">
              {image.count > 1 ? 'Imágenes adjuntas, sin texto' : 'Imagen adjunta, sin texto'}
            </p>
          )}
        </div>

        <footer className="flex flex-col gap-2 px-5 pb-4 sm:flex-row-reverse sm:items-center">
          <a
            href={dayHref(image.key)}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            Ver nota
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-edge bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
