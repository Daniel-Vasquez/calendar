import { useEffect, useMemo, useRef, useState } from 'react';
import Lightbox from './Lightbox';
import { formatLongDate } from '../lib/calendar';
import { collectImages } from '../lib/gallery';
import { loadData, STORAGE_KEY, type CalendarData } from '../lib/storage';

/**
 * Todas las imágenes adjuntas a las notas del año, en una rejilla de
 * miniaturas. Es una vista de solo lectura sobre el mismo almacenamiento que
 * el calendario: para editar se vuelve al día con "Ver nota".
 */
export default function GalleryView() {
  const [data, setData] = useState<CalendarData>({});
  const [hydrated, setHydrated] = useState(false);
  /** Clave del día cuya imagen está ampliada; `null` con el visor cerrado. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Miniatura que abrió el visor, para devolverle el foco al cerrar. */
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // El primer render debe coincidir con el HTML del servidor, así que
  // localStorage se lee después de montar.
  useEffect(() => {
    setData(loadData());
    setHydrated(true);
  }, []);

  // Mantiene la galería en sincronía con el calendario abierto en otra pestaña.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === STORAGE_KEY) setData(loadData());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const images = useMemo(() => collectImages(data), [data]);
  const open = openKey ? images.find((image) => image.key === openKey) : undefined;

  // Si la imagen ampliada desaparece desde otra pestaña, el visor se cierra solo.
  useEffect(() => {
    if (openKey && !open) setOpenKey(null);
  }, [openKey, open]);

  return (
    <>
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-highlight uppercase">
              Imágenes adjuntas
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Galería
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              {/* El recuento espera a la hidratación: en el servidor siempre sería cero. */}
              {hydrated && images.length > 0
                ? `${images.length} ${images.length === 1 ? 'imagen' : 'imágenes'} en tus notas del año.`
                : 'Las imágenes que adjuntes a tus notas aparecen aquí.'}
            </p>
          </div>

          <a
            href="/"
            className="flex items-center gap-2 rounded-xl border border-edge bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
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
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Volver al calendario
          </a>
        </div>
      </header>

      {/* Hasta hidratar no se sabe si hay imágenes: mejor un hueco que un
          estado vacío que desaparece al instante. */}
      {!hydrated ? (
        <div className="min-h-64" aria-busy="true" />
      ) : images.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {images.map((image) => {
            const date = formatLongDate(image.key);
            return (
              <li key={image.key}>
                <button
                  type="button"
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget;
                    setOpenKey(image.key);
                  }}
                  aria-haspopup="dialog"
                  aria-label={`Ampliar imagen del ${date}`}
                  className="group block w-full overflow-hidden rounded-xl border border-edge bg-surface text-left shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {/* Cuadrada y recortada con `object-cover`: la proporción
                      original se ve entera en el visor, aquí manda la rejilla. */}
                  <span className="block aspect-square overflow-hidden">
                    <img
                      src={image.dataUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  </span>
                  <span className="block truncate px-3 py-2 text-xs font-medium text-ink-soft transition-colors group-hover:text-ink">
                    {date}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <Lightbox image={open} triggerRef={triggerRef} onClose={() => setOpenKey(null)} />
      )}
    </>
  );
}

/** Sin imágenes todavía: explica de dónde saldrán y lleva al calendario. */
function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge bg-surface px-6 py-16 text-center">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="text-ink-muted"
      >
        <rect
          x="8"
          y="14"
          width="48"
          height="36"
          rx="6"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="M10 44l13-13a4 4 0 015.6 0L40 42l5.2-5.2a4 4 0 015.6 0L54 40"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="42" cy="26" r="4" fill="currentColor" />
      </svg>
      <h2 className="mt-5 text-lg font-semibold text-ink">Todavía no hay imágenes</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">
        Abre cualquier día del calendario y usa «Adjuntar imagen» en su nota. Todo lo que
        adjuntes se reunirá aquí, ordenado por fecha.
      </p>
      <a
        href="/"
        className="mt-6 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Ir al calendario
      </a>
    </div>
  );
}
