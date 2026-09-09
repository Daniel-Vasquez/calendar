import { useEffect, useId, useRef, useState } from 'react';
import { formatLongDate, formatWeekday } from '../lib/calendar';
import { DAY_COLORS, DEFAULT_COLOR, colorHex, colorName, type ColorId } from '../lib/palette';
import type { DayEntry } from '../lib/storage';

type Props = {
  dateKey: string;
  entry?: DayEntry;
  onSave: (key: string, entry: DayEntry) => void;
  onClear: (key: string) => void;
  onClose: () => void;
};

export default function DayModal({ dateKey, entry, onSave, onClear, onClose }: Props) {
  const [marked, setMarked] = useState(entry?.marked ?? false);
  const [note, setNote] = useState(entry?.note ?? '');
  const [color, setColor] = useState<ColorId>(entry?.color ?? DEFAULT_COLOR);
  const noteId = useId();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const hasStoredData = Boolean(entry?.marked || entry?.note);

  // El modal se reutiliza entre días: resincroniza el borrador al cambiar de fecha.
  useEffect(() => {
    setMarked(entry?.marked ?? false);
    setNote(entry?.note ?? '');
    setColor(entry?.color ?? DEFAULT_COLOR);
  }, [dateKey, entry?.marked, entry?.note, entry?.color]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [dateKey]);

  // Escape cierra; Tab queda atrapado dentro del panel.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Bloquea el scroll de fondo mientras el modal está abierto.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Elegir un color implica querer el día marcado.
  function pickColor(next: ColorId) {
    setColor(next);
    setMarked(true);
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
            <span className="text-xs font-normal text-ink-muted">{colorName(color)}</span>
          </legend>
          <div role="radiogroup" aria-label="Color del recuadro" className="grid grid-cols-8 gap-2">
            {DAY_COLORS.map((option) => {
              const selected = option.id === color;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.name}
                  title={option.name}
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

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => onSave(dateKey, { marked, note: note.trim(), color })}
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
