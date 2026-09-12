import { useEffect, useMemo, useRef, useState } from 'react';
import Lightbox from './Lightbox';
import NavBar, { type NavUser } from './NavBar';
import { formatLongDate } from '../lib/calendar';
import { collectImages } from '../lib/gallery';
import { fetchImages, storeImages } from '../lib/sync';
import { imagesReady, loadData, STORAGE_KEY, type CalendarData } from '../lib/storage';

/**
 * Todas las imágenes adjuntas a las notas del año, en una rejilla de
 * miniaturas. Es una vista de solo lectura sobre el mismo almacenamiento que
 * el calendario: para editar se vuelve al día con "Ver nota".
 */
export default function GalleryView({ user }: { user: NavUser }) {
  const [data, setData] = useState<CalendarData>({});
  const [hydrated, setHydrated] = useState(false);
  /** Id de la imagen ampliada; `null` con el visor cerrado. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Miniatura que abrió el visor, para devolverle el foco al cerrar. */
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Días cuyas imágenes aún se están trayendo de la cuenta. */
  const [missing, setMissing] = useState(0);

  // El primer render debe coincidir con el HTML del servidor, así que
  // localStorage se lee después de montar.
  useEffect(() => {
    setData(loadData());
    setHydrated(true);
  }, []);

  /**
   * Trae de la cuenta las imágenes que este navegador no tenga.
   *
   * El calendario las pide de una en una, al abrir un día; la galería las
   * necesita todas, así que aquí sí se descargan en bloque. Van en serie y no
   * en paralelo a propósito: son megas, y una ráfaga de peticiones simultáneas
   * castigaría una conexión mala justo cuando menos conviene.
   */
  useEffect(() => {
    if (!hydrated) return;

    const pendientes = Object.keys(data).filter((key) => !imagesReady(data[key]));
    if (pendientes.length === 0) {
      setMissing(0);
      return;
    }

    let alive = true;
    setMissing(pendientes.length);

    void (async () => {
      for (const key of pendientes) {
        const images = await fetchImages(key);
        if (!alive) return;
        // Si falla, se sigue con el resto: mejor una galería incompleta que
        // ninguna, y al recargar se vuelve a intentar.
        if (images) setData(storeImages(key, images));
        setMissing((count) => count - 1);
      }
    })();

    return () => {
      alive = false;
    };
    // Se dispara al hidratar y cuando otra pestaña cambia el calendario; no en
    // cada descarga, o la lista se recalcularía a mitad del propio bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Mantiene la galería en sincronía con el calendario abierto en otra pestaña.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === STORAGE_KEY) setData(loadData());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const images = useMemo(() => collectImages(data), [data]);
  const open = openId ? images.find((image) => image.id === openId) : undefined;

  // Si la imagen ampliada desaparece desde otra pestaña, el visor se cierra solo.
  useEffect(() => {
    if (openId && !open) setOpenId(null);
  }, [openId, open]);

  return (
    <>
      <NavBar current="gallery" user={user} />

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
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
                {!hydrated
                  ? 'Las imágenes que adjuntes a tus notas aparecen aquí.'
                  : missing > 0
                    ? `Trayendo las imágenes de ${missing} ${missing === 1 ? 'nota' : 'notas'} de tu cuenta…`
                    : images.length > 0
                      ? `${images.length} ${images.length === 1 ? 'imagen' : 'imágenes'} en tus notas del año.`
                      : 'Las imágenes que adjuntes a tus notas aparecen aquí.'}
              </p>
            </div>
          </div>
        </header>

        {/* Hasta hidratar no se sabe si hay imágenes: mejor un hueco que un
          estado vacío que desaparece al instante. */}
        {!hydrated ? (
          <div className="min-h-64" aria-busy="true" />
        ) : images.length === 0 ? (
          missing > 0 ? (
            <div className="min-h-64" aria-busy="true" />
          ) : (
            <EmptyState />
          )
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
            {images.map((image) => {
              const date = formatLongDate(image.key);
              // Con varias imágenes el mismo día, el pie las numera.
              const position = image.count > 1 ? ` (${image.index + 1} de ${image.count})` : '';
              return (
                <li key={image.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setOpenId(image.id);
                    }}
                    aria-haspopup="dialog"
                    aria-label={`Ampliar imagen del ${date}${position}`}
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
                    <span className="flex items-baseline justify-between gap-2 px-3 py-2 text-xs font-medium text-ink-soft transition-colors group-hover:text-ink">
                      <span className="truncate">{date}</span>
                      {image.count > 1 && (
                        <span className="shrink-0 text-ink-muted tabular-nums">
                          {image.index + 1}/{image.count}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {open && <Lightbox image={open} triggerRef={triggerRef} onClose={() => setOpenId(null)} />}
      </main>
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
        <rect x="8" y="14" width="48" height="36" rx="6" stroke="currentColor" strokeWidth="2.5" />
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
        Abre cualquier día del calendario y usa «Adjuntar imágenes» en su nota. Todo lo que adjuntes
        se reunirá aquí, ordenado por fecha.
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
