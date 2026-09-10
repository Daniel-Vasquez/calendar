import { useCallback, useEffect, useMemo, useState } from 'react';
import MonthCard from './MonthCard';
import DayModal from './DayModal';
import AgendaPanel from './AgendaPanel';
import {
  formatLongDate,
  isInQuarter,
  msUntilNextMidnight,
  QUARTER_MONTHS,
  todayKey,
} from '../lib/calendar';
import { DAY_COLORS } from '../lib/palette';
import { loadData, saveData, type CalendarData, type DayEntry } from '../lib/storage';

export default function CalendarDashboard() {
  const [data, setData] = useState<CalendarData>({});
  const [hydrated, setHydrated] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [today, setToday] = useState('');
  /** Último día borrado, a la espera de que el aviso caduque o se deshaga. */
  const [undo, setUndo] = useState<{ key: string; entry: DayEntry } | null>(null);

  // El primer render debe coincidir con el HTML del servidor, así que
  // localStorage se lee después de montar.
  useEffect(() => {
    setData(loadData());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveData(data);
  }, [data, hydrated]);

  // La fecha del cliente puede no ser la del servidor, así que "hoy" también
  // se resuelve tras montar. Se reprograma en cada medianoche para que el día
  // actual ceda su marca al siguiente sin recargar, y se revalida al volver a
  // la pestaña: un equipo suspendido despierta con el temporizador atrasado.
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

  // Mantiene el calendario en sincronía con otras pestañas abiertas.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === 'calendar_2026_q4_data') {
        setData(loadData());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleSave = useCallback(
    (key: string, entry: DayEntry) => {
      // Un día sin marca ni nota no se guarda: mantiene el almacenamiento limpio.
      const removes = !entry.marked && !entry.note;
      const previous = data[key];

      setData((current) => {
        const next = { ...current };
        if (removes) {
          delete next[key];
        } else {
          next[key] = entry;
        }
        return next;
      });

      // Vaciar el formulario borra igual que el botón de eliminar; cualquier
      // otro guardado invalida el aviso pendiente, que ya hablaría de otro día.
      setUndo(removes && previous ? { key, entry: previous } : null);
      setSelectedKey(null);
    },
    [data],
  );

  const handleClear = useCallback(
    (key: string) => {
      const previous = data[key];
      setData((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (previous) setUndo({ key, entry: previous });
      setSelectedKey(null);
    },
    [data],
  );

  const handleUndo = useCallback(() => {
    if (!undo) return;
    setData((current) => ({ ...current, [undo.key]: undo.entry }));
    setUndo(null);
  }, [undo]);

  // El aviso caduca solo. Cada borrado crea un objeto nuevo, así que el
  // temporizador se reinicia con él en lugar de heredar la cuenta anterior.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  // Un calendario de cuatro meses no cabe en pantalla: este atajo devuelve a
  // hoy y le deja el foco, listo para seguir moviéndose con las flechas.
  const canJumpToToday = Boolean(today) && isInQuarter(today);

  const goToToday = useCallback(() => {
    const cell = document.querySelector<HTMLElement>(`[data-date="${today}"]`);
    if (!cell) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cell.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
    cell.focus({ preventScroll: true });
  }, [today]);

  const summary = useMemo(() => {
    const entries = Object.values(data);
    return {
      marked: entries.filter((entry) => entry.marked).length,
      notes: entries.filter((entry) => entry.note).length,
    };
  }, [data]);

  return (
    <>
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-highlight uppercase">
              Septiembre — Diciembre
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Planificador Q4 2026
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Marca días clave y guarda notas. Todo se conserva en este navegador.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {canJumpToToday && (
              <button
                type="button"
                onClick={goToToday}
                className="rounded-xl border border-today/30 bg-today/10 px-4 py-2.5 text-sm font-semibold text-today transition-colors hover:bg-today/20 focus-visible:ring-2 focus-visible:ring-today focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Ir a hoy
              </button>
            )}

            <dl className="flex gap-3" aria-live="polite">
              <SummaryTile
                value={summary.marked}
                label={summary.marked === 1 ? 'día marcado' : 'días marcados'}
                tone="accent"
              />
              <SummaryTile
                value={summary.notes}
                label={summary.notes === 1 ? 'nota guardada' : 'notas guardadas'}
                tone="highlight"
              />
            </dl>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {QUARTER_MONTHS.map((month) => (
          <MonthCard
            key={month.index}
            monthIndex={month.index}
            name={month.name}
            data={data}
            today={today}
            onSelectDay={setSelectedKey}
          />
        ))}
      </div>

      <AgendaPanel data={data} today={today} onSelectDay={setSelectedKey} />

      <footer className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-muted">
        <span className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden="true">
            {DAY_COLORS.map((color) => (
              <span
                key={color.id}
                className="h-3 w-3 rounded"
                style={{ backgroundColor: color.hex }}
              />
            ))}
          </span>
          Día marcado ({DAY_COLORS.length} colores)
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-highlight" aria-hidden="true" />
          Contiene una nota
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-today" aria-hidden="true" />
          Día actual (violeta reservado)
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-accent opacity-60" aria-hidden="true" />
          Día pasado
        </span>
        <span>Haz clic en cualquier día para editarlo, o recorre el mes con las flechas.</span>
      </footer>

      {undo && (
        // Bajo el modal (z-50) y sin capturar el cursor salvo en la tarjeta:
        // la banda ocupa todo el ancho y bloquearía el pie de página.
        <div
          role="status"
          aria-live="polite"
          className="animate-panel-in pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl">
            <span>Se borró {formatLongDate(undo.key)}.</span>
            <button
              type="button"
              onClick={handleUndo}
              className="rounded-lg bg-white/15 px-3 py-1 text-sm font-semibold transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              Deshacer
            </button>
            <button
              type="button"
              onClick={() => setUndo(null)}
              aria-label="Descartar aviso"
              className="rounded-lg p-1 text-white/70 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {selectedKey && (
        <DayModal
          dateKey={selectedKey}
          entry={data[selectedKey]}
          onSave={handleSave}
          onClear={handleClear}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </>
  );
}

function SummaryTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'accent' | 'highlight';
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-accent/25 bg-accent/10 text-accent-strong'
      : 'border-highlight/25 bg-highlight-soft text-highlight';

  return (
    <div className={`rounded-xl border px-4 py-2.5 ${toneClass}`}>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="ml-2 text-xs font-medium">{label}</span>
      </dd>
    </div>
  );
}
