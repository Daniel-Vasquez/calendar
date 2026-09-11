import { useCallback, useEffect, useMemo, useState } from 'react';
import MonthCard from './MonthCard';
import DayModal from './DayModal';
import AgendaPanel from './AgendaPanel';
import SettingsPanel from './SettingsPanel';
import {
  formatLongDate,
  isInQuarter,
  keysBetween,
  msUntilNextMidnight,
  QUARTER_MONTHS,
  todayKey,
} from '../lib/calendar';
import { DAY_COLORS, DEFAULT_COLOR, type ColorId } from '../lib/palette';
import {
  labelFor,
  loadLabels,
  saveLabels,
  LABELS_KEY,
  MAX_LABEL_LENGTH,
  type ColorLabels,
} from '../lib/labels';
import {
  downloadFile,
  exportFilename,
  parseImport,
  toIcs,
  toJson,
} from '../lib/transfer';
import {
  loadData,
  saveData,
  STORAGE_KEY,
  type CalendarData,
  type DayEntry,
} from '../lib/storage';

/**
 * Aviso efímero del pie. Con `snapshot` ofrece deshacer —guarda el calendario
 * entero anterior al cambio—; sin él es solo un mensaje de error.
 */
type Notice = { message: string; snapshot?: CalendarData };

export default function CalendarDashboard() {
  const [data, setData] = useState<CalendarData>({});
  const [labels, setLabels] = useState<ColorLabels>({});
  const [hydrated, setHydrated] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [today, setToday] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Último día abierto: ancla del rango que dibuja un clic con Shift. */
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  /** Color del último día guardado, que es el que hereda un rango marcado. */
  const [lastColor, setLastColor] = useState<ColorId>(DEFAULT_COLOR);

  // El primer render debe coincidir con el HTML del servidor, así que
  // localStorage se lee después de montar.
  useEffect(() => {
    setData(loadData());
    setLabels(loadLabels());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveData(data);
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveLabels(labels);
  }, [labels, hydrated]);

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
      if (event.key === null || event.key === STORAGE_KEY) setData(loadData());
      if (event.key === null || event.key === LABELS_KEY) setLabels(loadLabels());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleSave = useCallback(
    (key: string, entry: DayEntry) => {
      // Un día sin marca ni nota no se guarda: mantiene el almacenamiento limpio.
      const removes = !entry.marked && !entry.note;
      const snapshot = data;

      setData((current) => {
        const next = { ...current };
        if (removes) {
          delete next[key];
        } else {
          next[key] = entry;
        }
        return next;
      });

      // El último color elegido es el que heredará un rango marcado con Shift.
      if (entry.marked && entry.color) setLastColor(entry.color);

      // Vaciar el formulario borra igual que el botón de eliminar; cualquier
      // otro guardado invalida el aviso pendiente, que ya hablaría de otro día.
      setNotice(
        removes && snapshot[key] ? { message: `Se borró ${formatLongDate(key)}.`, snapshot } : null,
      );
      setSelectedKey(null);
    },
    [data],
  );

  const handleClear = useCallback(
    (key: string) => {
      const snapshot = data;
      setData((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (snapshot[key]) setNotice({ message: `Se borró ${formatLongDate(key)}.`, snapshot });
      setSelectedKey(null);
    },
    [data],
  );

  const handleUndo = useCallback(() => {
    if (!notice?.snapshot) return;
    setData(notice.snapshot);
    setNotice(null);
  }, [notice]);

  // El aviso caduca solo. Cada cambio crea un objeto nuevo, así que el
  // temporizador se reinicia con él en lugar de heredar la cuenta anterior.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openDay = useCallback((key: string) => {
    setAnchorKey(key);
    setSelectedKey(key);
  }, []);

  /** Marca de golpe todo lo que hay entre el último día abierto y este. */
  const markRange = useCallback(
    (from: string, to: string) => {
      const keys = keysBetween(from, to).filter(isInQuarter);
      if (keys.length === 0) return;

      const snapshot = data;
      setData((current) => {
        const next = { ...current };
        for (const key of keys) {
          // Marcar en bloque pinta el día; la nota que ya tuviera se respeta.
          next[key] = { marked: true, note: current[key]?.note ?? '', color: lastColor };
        }
        return next;
      });

      setNotice({
        message: `Se marcaron ${keys.length} ${keys.length === 1 ? 'día' : 'días'} en ${labelFor(labels, lastColor)}.`,
        snapshot,
      });
      // El rango deja su ancla en el extremo recién tocado, para encadenar otro.
      setAnchorKey(to);
    },
    [data, labels, lastColor],
  );

  const handleSelectDay = useCallback(
    (key: string, extend: boolean) => {
      // Shift sobre un día ya visitado marca el tramo sin abrir el modal.
      if (extend && anchorKey) {
        markRange(anchorKey, key);
        return;
      }
      openDay(key);
    },
    [anchorKey, markRange, openDay],
  );

  const handleRenameColor = useCallback((id: ColorId, label: string) => {
    setLabels((current) => {
      const next = { ...current };
      const clean = label.slice(0, MAX_LABEL_LENGTH);
      // Sin texto vuelve a mandar el nombre de fábrica del color.
      if (clean.trim()) next[id] = clean;
      else delete next[id];
      return next;
    });
  }, []);

  const handleExportJson = useCallback(() => {
    downloadFile(toJson(data, labels), exportFilename('json', today), 'application/json');
  }, [data, labels, today]);

  const handleExportIcs = useCallback(() => {
    downloadFile(toIcs(data, labels), exportFilename('ics', today), 'text/calendar');
  }, [data, labels, today]);

  const handleImport = useCallback(
    async (file: File) => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setNotice({ message: 'No se pudo leer el archivo.' });
        return;
      }

      const result = parseImport(text);
      if (!result.ok) {
        setNotice({ message: result.reason });
        return;
      }

      // Fusiona en vez de reemplazar: lo importado pisa el mismo día, el resto
      // del año sigue donde estaba. La instantánea deshace las dos cosas.
      const snapshot = data;
      setData((current) => ({ ...current, ...result.data }));
      setNotice({
        message: `Se importaron ${result.days} ${result.days === 1 ? 'día' : 'días'}.`,
        snapshot,
      });
    },
    [data],
  );

  // Un calendario de doce meses no cabe en pantalla: este atajo devuelve a
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
              Enero — Diciembre
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Planificador 2026
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
                className="print-hidden rounded-xl border border-today/30 bg-today/10 px-4 py-2.5 text-sm font-semibold text-today transition-colors hover:bg-today/20 focus-visible:ring-2 focus-visible:ring-today focus-visible:ring-offset-2 focus-visible:outline-none"
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

      <div className="print-grid-2 grid grid-cols-1 gap-5 md:grid-cols-2">
        {QUARTER_MONTHS.map((month) => (
          <MonthCard
            key={month.index}
            monthIndex={month.index}
            name={month.name}
            data={data}
            today={today}
            onSelectDay={handleSelectDay}
          />
        ))}
      </div>

      <AgendaPanel data={data} labels={labels} today={today} onSelectDay={openDay} />

      <SettingsPanel
        labels={labels}
        hasData={Object.keys(data).length > 0}
        onRenameColor={handleRenameColor}
        onExportJson={handleExportJson}
        onExportIcs={handleExportIcs}
        onImport={handleImport}
      />

      <footer className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-muted">
        <span className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden="true">
            {DAY_COLORS.map((color) => (
              <span
                key={color.id}
                title={labelFor(labels, color.id)}
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
        <span className="print-hidden">
          Haz clic en un día para editarlo, Shift+clic para marcar el tramo desde el anterior, o
          recorre el año con las flechas.
        </span>
      </footer>

      {notice && (
        // Bajo el modal (z-50) y sin capturar el cursor salvo en la tarjeta:
        // la banda ocupa todo el ancho y bloquearía el pie de página.
        <div
          role="status"
          className="animate-panel-in print-hidden pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl">
            <span>{notice.message}</span>
            {notice.snapshot && (
              <button
                type="button"
                onClick={handleUndo}
                className="rounded-lg bg-white/15 px-3 py-1 text-sm font-semibold transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                Deshacer
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
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
          labels={labels}
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
