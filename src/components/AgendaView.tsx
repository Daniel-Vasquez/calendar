import { useEffect, useMemo, useState } from 'react';
import AgendaList from './AgendaList';
import NavBar, { type NavUser } from './NavBar';
import SyncBadge from './SyncBadge';
import { useCalendarStore } from './useCalendarStore';
import { msUntilNextMidnight, todayKey } from '../lib/calendar';
import { LABELS_KEY, loadLabels, type ColorLabels } from '../lib/labels';
import { hasImages } from '../lib/storage';

/**
 * La agenda del año, con las cuentas del calendario encima.
 *
 * Las dos —días marcados y notas guardadas— estaban en la cabecera de la
 * portada, que es donde menos falta hacían: encima de la rejilla, que ya enseña
 * de un vistazo cuántos días llevan color. Aquí acompañan a la lista de la que
 * salen, y de paso dejan sitio arriba en un teléfono.
 *
 * Lee por `useCalendarStore`, igual que el calendario y los recordatorios: las
 * cuentas salen del mismo estado, así que marcar un día allí las mueve aquí en
 * cuanto se recarga o llega el cambio de otra pestaña.
 */
export default function AgendaView({ user }: { user: NavUser }) {
  const { data, hydrated, sync, pending, retry } = useCalendarStore();
  const [labels, setLabels] = useState<ColorLabels>({});
  const [today, setToday] = useState('');

  // Igual que en el calendario: localStorage se lee después de montar para que
  // el primer render coincida con el HTML del servidor.
  useEffect(() => {
    setLabels(loadLabels());
  }, []);

  // Y se vigila, por si se renombra una categoría en otra pestaña.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === LABELS_KEY) setLabels(loadLabels());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // La fecha del cliente puede no ser la del servidor, así que "hoy" se resuelve
  // tras montar. Se reprograma en cada medianoche para que la marca pase al día
  // siguiente sin recargar, y se revalida al volver a la pestaña: un equipo
  // suspendido despierta con el temporizador atrasado.
  useEffect(() => {
    let timer = 0;

    function refresh() {
      setToday(todayKey());
      window.clearTimeout(timer);
      // El segundo extra evita disparar justo en el borde y leer aún el día previo.
      timer = window.setTimeout(refresh, msUntilNextMidnight() + 1000);
    }

    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }

    refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const summary = useMemo(() => {
    const entries = Object.values(data);
    return {
      days: entries.length,
      marked: entries.filter((entry) => entry.marked).length,
      // Una imagen sola también cuenta como nota: es contenido del día.
      notes: entries.filter((entry) => entry.note || hasImages(entry)).length,
    };
  }, [data]);

  return (
    <>
      <NavBar current="agenda" user={user} />

      <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 sm:px-6">
        <header className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-4 sm:gap-6">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-highlight uppercase">
                Todo lo anotado
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Agenda del año
              </h1>
              <p className="mt-2 text-sm text-ink-soft">
                {/* El recuento espera a la hidratación: en el servidor siempre sería cero. */}
                {!hydrated || summary.days === 0
                  ? 'Lo que marques o anotes en el calendario aparece aquí.'
                  : `${summary.days} ${summary.days === 1 ? 'día registrado' : 'días registrados'} en el año.`}
              </p>
            </div>

            <SyncBadge state={sync} pending={pending} onRetry={retry} />
          </div>

          {/* Las cuentas, en dos columnas iguales en un teléfono y en fila a
              partir de `sm`: el mismo patrón que dejó la cabecera del
              calendario cuando se le quitó el amontonamiento. */}
          <dl className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3" aria-live="polite">
            <SummaryTile
              value={summary.marked}
              label={summary.marked === 1 ? 'día marcado' : 'días marcados'}
              tone="accent"
            >
              <MarkedIcon />
            </SummaryTile>
            <SummaryTile
              value={summary.notes}
              label={summary.notes === 1 ? 'nota guardada' : 'notas guardadas'}
              tone="highlight"
            >
              <NoteIcon />
            </SummaryTile>
          </dl>
        </header>

        {/* Hasta hidratar no se sabe si hay algo: mejor un hueco que un estado
            vacío que desaparece al instante. */}
        {!hydrated ? (
          <div className="min-h-64" aria-busy="true" />
        ) : (
          <AgendaList data={data} labels={labels} today={today} />
        )}
      </main>
    </>
  );
}

/**
 * Una cuenta de la cabecera: icono, número y —solo cuando hay ancho— el rótulo.
 *
 * En un teléfono el texto se va y queda el distintivo: el icono repite el mismo
 * dibujo que la leyenda del calendario, así que la asociación ya está hecha. El
 * rótulo no se pierde, sigue en el `<dt>`, que es de donde lo saca un lector de
 * pantalla tanto si se ve como si no.
 */
function SummaryTile({
  value,
  label,
  tone,
  children,
}: {
  value: number;
  label: string;
  tone: 'accent' | 'highlight';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-accent/25 bg-accent/10 text-accent-ink-strong'
      : 'border-highlight/25 bg-highlight-soft text-highlight';

  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 sm:justify-start sm:px-4 sm:py-2.5 ${toneClass}`}
    >
      <dt className="sr-only">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span aria-hidden="true">{children}</span>
        <span className="text-xl font-semibold tabular-nums sm:text-2xl">{value}</span>
        <span className="hidden text-xs font-medium sm:inline">{label}</span>
      </dd>
    </div>
  );
}

/** Recuadro lleno: un día marcado, el mismo que la leyenda del calendario. */
function MarkedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" />
    </svg>
  );
}

/** Hoja con dos renglones: una nota guardada. */
function NoteIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 2.5h9v11h-9z" />
      <path d="M6 6h4M6 9h4" />
    </svg>
  );
}
