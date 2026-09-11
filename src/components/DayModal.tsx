import { useEffect, useId, useRef, useState } from 'react';
import { formatLongDate, formatWeekday } from '../lib/calendar';
import { DAY_COLORS, DEFAULT_COLOR, colorHex, type ColorId } from '../lib/palette';
import { labelFor, type ColorLabels } from '../lib/labels';
import { dataUrlBytes, IMAGE_ACCEPT, prepareImage } from '../lib/image';
import { hasContent, type DayEntry } from '../lib/storage';
import { useDialog } from './useDialog';

type Props = {
  dateKey: string;
  entry?: DayEntry;
  /** Nombres que el usuario le ha puesto a los colores (ver SettingsPanel). */
  labels: ColorLabels;
  onSave: (key: string, entry: DayEntry) => void;
  onClear: (key: string) => void;
  onClose: () => void;
};

const IMAGE_ACTION =
  'rounded-lg border border-edge bg-white px-3 py-1.5 text-xs font-medium text-ink-soft ' +
  'transition-colors hover:bg-edge disabled:cursor-wait disabled:opacity-60 ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none';

/** "120 KB" a partir de bytes; las imágenes adjuntas nunca llegan al megabyte. */
function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

export default function DayModal({ dateKey, entry, labels, onSave, onClear, onClose }: Props) {
  const [marked, setMarked] = useState(entry?.marked ?? false);
  const [note, setNote] = useState(entry?.note ?? '');
  const [color, setColor] = useState<ColorId>(entry?.color ?? DEFAULT_COLOR);
  /** Data URL de la imagen adjunta; `undefined` si la nota no lleva ninguna. */
  const [image, setImage] = useState<string | undefined>(entry?.image);
  const [imageError, setImageError] = useState('');
  const [processing, setProcessing] = useState(false);
  const noteId = useId();
  const titleId = useId();
  const imageHelpId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);

  const hasStoredData = Boolean(entry && hasContent(entry));

  // El modal se reutiliza entre días: resincroniza el borrador al cambiar de fecha.
  useEffect(() => {
    setMarked(entry?.marked ?? false);
    setNote(entry?.note ?? '');
    setColor(entry?.color ?? DEFAULT_COLOR);
    setImage(entry?.image);
    setImageError('');
  }, [dateKey, entry?.marked, entry?.note, entry?.color, entry?.image]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [dateKey]);

  // Escape cierra, Tab queda atrapado y el fondo no hace scroll.
  useDialog(panelRef, onClose);

  // Elegir un color implica querer el día marcado.
  function pickColor(next: ColorId) {
    setColor(next);
    setMarked(true);
  }

  async function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Sin limpiarlo, volver a elegir el mismo archivo no dispara `change`.
    event.target.value = '';
    if (!file) return;

    setImageError('');
    setProcessing(true);
    const result = await prepareImage(file);
    setProcessing(false);

    if (result.ok) setImage(result.dataUrl);
    else setImageError(result.reason);
  }

  function removeImage() {
    setImage(undefined);
    setImageError('');
    // El botón "Quitar" desaparece con la imagen: el foco pasa al de adjuntar
    // en cuanto React lo pinte, para no caer fuera del modal.
    requestAnimationFrame(() => attachRef.current?.focus());
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-panel-in max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-edge bg-canvas p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {formatWeekday(dateKey)}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink">
              {formatLongDate(dateKey)}
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
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-edge bg-surface px-4 py-3">
          <span className="text-sm font-medium text-ink-soft">Marcar día</span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              checked={marked}
              onChange={(event) => setMarked(event.target.checked)}
              className="peer sr-only"
            />
            <span className="block h-6 w-11 rounded-full bg-edge transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2" />
            <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
          </span>
        </label>

        <fieldset className="mt-4">
          <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-medium text-ink-soft">
            <span>Color del recuadro</span>
            <span className="text-xs font-normal text-ink-muted">{labelFor(labels, color)}</span>
          </legend>
          <div role="radiogroup" aria-label="Color del recuadro" className="grid grid-cols-8 gap-2">
            {DAY_COLORS.map((option) => {
              const selected = option.id === color;
              const name = labelFor(labels, option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={name}
                  title={name}
                  onClick={() => pickColor(option.id)}
                  style={{ backgroundColor: option.hex }}
                  className={
                    'flex aspect-square w-full items-center justify-center rounded-lg transition ' +
                    'focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none ' +
                    (selected
                      ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas'
                      : 'hover:brightness-90') +
                    (marked ? '' : ' opacity-60')
                  }
                >
                  {selected && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6.3l2.4 2.4L9.6 4"
                        stroke="#ffffff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          {!marked && (
            <p className="mt-2 text-xs text-ink-muted">
              Elegir un color marcará el día automáticamente.
            </p>
          )}
        </fieldset>

        <div className="mt-4">
          <label htmlFor={noteId} className="mb-2 block text-sm font-medium text-ink-soft">
            Nota del día
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder="Escribe un recordatorio, reunión o pendiente…"
            className="w-full resize-none rounded-xl border border-edge bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
          />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink-soft">Imagen adjunta</span>
            <span id={imageHelpId} className="text-xs text-ink-muted">
              JPG, PNG o WebP
            </span>
          </div>

          {image ? (
            <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface p-3">
              <img
                src={image}
                alt="Vista previa de la imagen adjunta"
                className="h-20 w-20 shrink-0 rounded-lg object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs text-ink-muted">
                  {formatBytes(dataUrlBytes(image))}
                  {image !== entry?.image && ' · sin guardar'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={processing}
                    className={IMAGE_ACTION}
                  >
                    Cambiar
                  </button>
                  <button type="button" onClick={removeImage} className={IMAGE_ACTION}>
                    Quitar imagen
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              ref={attachRef}
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={processing}
              aria-describedby={imageHelpId}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-edge bg-surface px-4 py-3 text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-strong disabled:cursor-wait disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="2"
                  y="3"
                  width="12"
                  height="10"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M2.5 11l3.2-3.2a1 1 0 011.4 0L10 10.7l1.3-1.3a1 1 0 011.4 0l.8.8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
              </svg>
              {processing ? 'Procesando imagen…' : 'Adjuntar imagen'}
            </button>
          )}

          {/* El input real queda oculto: el botón lo dispara y el `accept`
              filtra el diálogo, aunque la validación de verdad es prepareImage. */}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={pickImage}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />

          {imageError && (
            <p role="alert" className="mt-2 text-xs font-medium text-highlight">
              {imageError}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => onSave(dateKey, { marked, note: note.trim(), color, image })}
            disabled={processing}
            style={marked ? { backgroundColor: colorHex(color) } : undefined}
            className={
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none ' +
              (marked ? 'hover:brightness-90' : 'bg-accent hover:bg-accent-strong')
            }
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => onClear(dateKey)}
            disabled={!hasStoredData}
            className="flex-1 rounded-xl border border-highlight/40 bg-highlight-soft px-4 py-2.5 text-sm font-semibold text-highlight transition-colors hover:bg-highlight hover:text-white disabled:cursor-not-allowed disabled:border-edge disabled:bg-surface disabled:text-ink-muted disabled:hover:bg-surface disabled:hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Eliminar nota / desmarcar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-edge bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none sm:flex-none"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
