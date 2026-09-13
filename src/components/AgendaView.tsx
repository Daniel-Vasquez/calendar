import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AgendaList from './AgendaList';
import DayModal from './DayModal';
import NavBar, { type NavUser } from './NavBar';
import NoticeBar, { useNotice } from './NoticeBar';
import SyncBadge from './SyncBadge';
import { useCalendarStore } from './useCalendarStore';
import { useSettings } from './useSettings';
import { formatLongDate, msUntilNextMidnight, todayKey } from '../lib/calendar';
import { fetchImages, storeImages } from '../lib/sync';
import { hasContent, hasImages, moveDay, type DayEntry } from '../lib/storage';

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
 *
 * Y **escribe** por el mismo sitio: pulsar una fila abre aquí el modal del día,
 * el mismo de la rejilla, en vez de saltar a la portada. Lo que se guarda entra
 * en el estado, en localStorage y en la cola de subida por la vía de siempre, y
 * la lista —con su búsqueda y sus filtros intactos— lo enseña en el acto.
 */
export default function AgendaView({ user }: { user: NavUser }) {
  // Lo que cuente la sincronía comparte banda con el resto de avisos.
  const { notice, announce, dismiss } = useNotice();
  const { data, setData, hydrated, sync, pending, retry, adopt } = useCalendarStore(announce);
  const { palette, catalogue, settings } = useSettings({ data, setData, announce });
  const [today, setToday] = useState('');
  /** Día abierto en el modal, o `null` si no hay ninguno. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Fila desde la que se abrió: a ella vuelve el foco al cerrarse el modal. */
  const triggerRef = useRef<HTMLElement | null>(null);

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

  // Si el día abierto desaparece desde otra pestaña, el modal se cierra solo en
  // vez de quedarse editando algo que ya no existe.
  const openEntry = selectedKey ? data[selectedKey] : undefined;
  useEffect(() => {
    if (selectedKey && !openEntry) setSelectedKey(null);
  }, [selectedKey, openEntry]);

  /**
   * Guarda el día editado. Es el mismo `handleSave` del calendario: un día sin
   * marca, ni nota, ni imagen, ni aviso no se guarda —se borra—, y ahí es donde
   * hace falta poder deshacer.
   */
  const handleSave = useCallback(
    (key: string, entry: DayEntry) => {
      const removes = !hasContent(entry);
      const snapshot = data;

      setData((current) => {
        const next = { ...current };
        if (removes) delete next[key];
        else next[key] = entry;
        return next;
      });

      if (removes && snapshot[key]) {
        announce(`Se borró ${formatLongDate(key)}.`, () => setData(snapshot));
      } else {
        dismiss();
      }
      setSelectedKey(null);
    },
    [data, setData, announce, dismiss],
  );

  const handleClear = useCallback(
    (key: string) => {
      const snapshot = data;
      setData((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (snapshot[key]) announce(`Se borró ${formatLongDate(key)}.`, () => setData(snapshot));
      setSelectedKey(null);
    },
    [data, setData, announce],
  );

  /**
   * Mueve el día a la fecha que se haya elegido en el modal.
   *
   * Un día vaciado se borra aunque además se le haya cambiado la fecha: no hay
   * nada que mudar, y recrearlo en el destino dejaría un día en blanco. El
   * resto lo hace `moveDay`, que es quien sabe rehacer el aviso con la fecha
   * nueva; aquí solo queda contarlo y dejar deshacerlo, porque el destino pudo
   * tener contenido y lo pierde.
   */
  const handleMove = useCallback(
    (from: string, to: string, entry: DayEntry) => {
      if (!hasContent(entry)) {
        handleSave(from, entry);
        return;
      }

      const snapshot = data;
      const replaces = Boolean(data[to]);
      setData((current) => moveDay(current, from, to, entry));
      setSelectedKey(null);
      announce(
        replaces
          ? `El día se movió al ${formatLongDate(to)} y sustituyó lo que había.`
          : `El día se movió al ${formatLongDate(to)}.`,
        () => setData(snapshot),
      );
    },
    [data, setData, handleSave, announce],
  );

  /**
   * Pide los adjuntos de un día al servidor, igual que en el calendario: no
   * viajan con el día, así que un dispositivo recién estrenado abre la nota
   * sabiendo cuántas imágenes tiene y sin ninguna dentro.
   */
  const loadImages = useCallback(
    async (key: string) => {
      const images = await fetchImages(key);
      if (!images) return;
      adopt(storeImages(key, images));
    },
    [adopt],
  );

  const hasDay = useCallback((key: string) => Boolean(data[key]), [data]);

  const handleSelect = useCallback((key: string, event: React.MouseEvent<HTMLElement>) => {
    triggerRef.current = event.currentTarget;
    setSelectedKey(key);
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
      <NavBar current="agenda" user={user} settings={settings} />

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
          <AgendaList
            data={data}
            palette={palette}
            catalogue={catalogue}
            today={today}
            onSelect={handleSelect}
          />
        )}
      </main>

      <NoticeBar notice={notice} onDismiss={dismiss} />

      {/* El modal del día, el mismo de la rejilla. Aquí se le encienden dos
          cosas que allí no tendrían sentido: el campo de fecha —en una lista la
          fecha es un dato del día, no el sitio donde está— y el enlace a la
          rejilla, para ver el día con su mes alrededor. */}
      {selectedKey && openEntry && (
        <DayModal
          dateKey={selectedKey}
          entry={openEntry}
          palette={palette}
          catalogue={catalogue}
          onNeedImages={loadImages}
          onSave={handleSave}
          onClear={handleClear}
          onMove={handleMove}
          hasDay={hasDay}
          showCalendarLink
          triggerRef={triggerRef}
          onClose={() => setSelectedKey(null)}
        />
      )}
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
