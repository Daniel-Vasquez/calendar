import { useCallback, useEffect, useMemo, useState } from 'react';
import MonthCard from './MonthCard';
import DayModal from './DayModal';
import { msUntilNextMidnight, QUARTER_MONTHS, todayKey } from '../lib/calendar';
import { DAY_COLORS } from '../lib/palette';
import { loadData, saveData, type CalendarData, type DayEntry } from '../lib/storage';

export default function CalendarDashboard() {
  const [data, setData] = useState<CalendarData>({});
  const [hydrated, setHydrated] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [today, setToday] = useState('');

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

  const handleSave = useCallback((key: string, entry: DayEntry) => {
    setData((current) => {
      const next = { ...current };
      // Un día sin marca ni nota no se guarda: mantiene el almacenamiento limpio.
      if (!entry.marked && !entry.note) {
        delete next[key];
      } else {
        next[key] = entry;
      }
      return next;
    });
    setSelectedKey(null);
  }, []);

  const handleClear = useCallback((key: string) => {
    setData((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSelectedKey(null);
  }, []);

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
        <span>Haz clic en cualquier día para editarlo.</span>
      </footer>

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
