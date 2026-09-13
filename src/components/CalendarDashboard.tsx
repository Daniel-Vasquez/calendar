import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import MonthCard from './MonthCard';
import DayModal from './DayModal';
import NavBar, { type NavUser } from './NavBar';
import NoticeBar, { useNotice } from './NoticeBar';
import SyncBadge from './SyncBadge';
import { useCalendarStore } from './useCalendarStore';
import { useSettings } from './useSettings';
import {
  DAY_PARAM,
  formatLongDate,
  YEAR,
  isInQuarter,
  keysBetween,
  monthIndexOf,
  msUntilNextMidnight,
  QUARTER_MONTHS,
  todayKey,
} from '../lib/calendar';
import {
  DEFAULT_EXPANSION,
  everyMonth,
  expansionOf,
  EXPANSION_KEY,
  loadExpansion,
  monthKey,
  removeBootStyle,
  saveExpansion,
  type MonthExpansion,
} from '../lib/collapse';
import { colorVar, DAY_COLORS, DEFAULT_COLOR, labelFor, type ColorId } from '../lib/palette';
import { fetchImages, storeImages } from '../lib/sync';
import { hasContent, type DayEntry } from '../lib/storage';

export default function CalendarDashboard({ user }: { user: NavUser }) {
  // Lo que cuente la sincronía se enseña en la misma banda del pie que el resto
  // de avisos, así que `announce` va también al almacén.
  const { notice, announce, dismiss } = useNotice();
  const { data, setData, hydrated, sync, pending, retry, adopt } = useCalendarStore(announce);
  const { palette, catalogue, settings } = useSettings({ data, setData, announce });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [today, setToday] = useState('');
  /** Último día abierto: ancla del rango que dibuja un clic con Shift. */
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  /** Color del último día guardado, que es el que hereda un rango marcado. */
  const [lastColor, setLastColor] = useState<ColorId>(DEFAULT_COLOR);
  /** Qué meses están desplegados. El servidor los dibuja todos abiertos. */
  const [expansion, setExpansion] = useState<MonthExpansion>(DEFAULT_EXPANSION);
  const [expansionLoaded, setExpansionLoaded] = useState(false);

  // Los meses plegados se leen en un efecto de layout: el cambio de estado se
  // pinta en el mismo cuadro que la hidratación. Hasta entonces la hoja de
  // arranque de index.astro los mantiene cerrados por CSS, y solo se retira
  // —también antes de pintar— cuando el DOM ya refleja el estado guardado.
  useLayoutEffect(() => {
    setExpansion(loadExpansion());
    setExpansionLoaded(true);
  }, []);

  useLayoutEffect(() => {
    if (expansionLoaded) removeBootStyle();
  }, [expansionLoaded]);

  useEffect(() => {
    if (expansionLoaded) saveExpansion(expansion);
  }, [expansion, expansionLoaded]);

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

  // Mantiene el calendario en sincronía con otras pestañas abiertas. Los días
  // y la cola de subida los vigila el almacén, y la paleta, `usePalette`; aquí
  // queda el plegado de los meses, que es lo único que es solo de esta página.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === EXPANSION_KEY) setExpansion(loadExpansion());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleSave = useCallback(
    (key: string, entry: DayEntry) => {
      // Un día sin marca, nota ni imagen no se guarda: mantiene el almacenamiento limpio.
      const removes = !hasContent(entry);
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
   * Pide los adjuntos de un día al servidor. Lo llama el modal cuando se abre
   * en un dispositivo que solo conoce la cuenta y la miniatura.
   *
   * Actualiza la referencia antes que el estado a propósito: lo que acaba de
   * bajar no es una edición y no debe volver a subir.
   */
  const loadImages = useCallback(
    async (key: string) => {
      const images = await fetchImages(key);
      if (!images) return;
      adopt(storeImages(key, images));
    },
    [adopt],
  );

  const openDay = useCallback((key: string) => {
    setAnchorKey(key);
    setSelectedKey(key);
  }, []);

  // `/?day=2026-03-15` abre ese día nada más cargar: es el enlace "Ver nota"
  // de la galería. Espera a los datos para que el modal nazca con la nota, y
  // despliega el mes y lo trae a la vista para que, al cerrar, el día esté
  // ahí. El parámetro se retira de la URL: recargar no debe reabrirlo.
  useEffect(() => {
    if (!hydrated || !expansionLoaded) return;

    const url = new URL(window.location.href);
    const key = url.searchParams.get(DAY_PARAM);
    if (!key) return;

    url.searchParams.delete(DAY_PARAM);
    window.history.replaceState(window.history.state, '', url);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isInQuarter(key)) return;

    setExpansion((current) => ({
      ...current,
      [monthKey(monthIndexOf(key))]: true,
    }));
    openDay(key);
    document
      .querySelector<HTMLElement>(`[data-date="${key}"]`)
      ?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [hydrated, expansionLoaded, openDay]);

  /** Marca de golpe todo lo que hay entre el último día abierto y este. */
  const markRange = useCallback(
    (from: string, to: string) => {
      const keys = keysBetween(from, to).filter(isInQuarter);
      if (keys.length === 0) return;

      const snapshot = data;
      setData((current) => {
        const next = { ...current };
        for (const key of keys) {
          // Marcar en bloque solo pinta el día: lo que ya tuviera —nota,
          // adjuntos, cuenta y miniatura— se conserva tal cual.
          const previous = current[key];
          next[key] = {
            ...previous,
            marked: true,
            note: previous?.note ?? '',
            color: lastColor,
          };
        }
        return next;
      });

      announce(
        `Se marcaron ${keys.length} ${keys.length === 1 ? 'día' : 'días'} en ${labelFor(palette, lastColor)}.`,
        () => setData(snapshot),
      );
      // El rango deja su ancla en el extremo recién tocado, para encadenar otro.
      setAnchorKey(to);
    },
    [data, setData, palette, lastColor, announce],
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

  /**
   * Cambia una pieza de un color y tira lo que quede vacío.
   *
   * El color sin nombre propio ni tono propio **se borra del todo** en lugar de
   * quedarse como `{}`: es lo que hace que «Restablecer» sepa si le queda algo
   * por hacer, y lo que deja que un color afinado en el código llegue a quien
   * nunca lo tocó.
   */
  const toggleMonth = useCallback((key: string) => {
    setExpansion((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const allExpanded = everyMonth(expansion, true);
  const allCollapsed = everyMonth(expansion, false);

  // Un calendario de doce meses no cabe en pantalla: este atajo devuelve a
  // hoy y le deja el foco, listo para seguir moviéndose con las flechas.
  const canJumpToToday = Boolean(today) && isInQuarter(today);

  const goToToday = useCallback(() => {
    const cell = document.querySelector<HTMLElement>(`[data-date="${today}"]`);
    if (!cell) return;

    // Un mes plegado se abre antes de saltar, de forma síncrona para que la
    // casilla deje de ser `inert` y acepte el foco. Mientras se despliega su
    // altura cambia, así que se desplaza a la cabecera del mes y no al día.
    const key = monthKey(monthIndexOf(today));
    const wasCollapsed = !expansion[key];
    if (wasCollapsed) flushSync(() => setExpansion((current) => ({ ...current, [key]: true })));

    const target = wasCollapsed ? (cell.closest('section') ?? cell) : cell;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({
      behavior: still ? 'auto' : 'smooth',
      block: wasCollapsed ? 'start' : 'center',
    });
    cell.focus({ preventScroll: true });
  }, [today, expansion]);

  return (
    <>
      <NavBar current="calendar" user={user} settings={settings} />

      <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 sm:px-6">
        {/* Lo que queda arriba: ir a hoy, el estado de la sincronía y el
            plegado de los meses. Las cuentas del año se fueron a `/agenda`,
            junto a la lista de la que salen. En un teléfono los dos bloques se
            apilan; a partir de `sm` vuelven a la misma fila. */}
        <header className="mb-8 flex gap-2 justify-between sm:items-center sm:gap-3">
          {/* El rótulo del año se quitó de la vista: los doce meses ya lo
              dicen, y en un teléfono ocupaba una línea entera. Se queda para
              quien lea la página con un lector, que sí necesita un encabezado
              del que colgar el resto. */}
          <h1 className="sr-only">Calendario de {YEAR}, de enero a diciembre</h1>

          <div
            className={
              'grid gap-2 sm:flex sm:items-center sm:gap-3 ' +
              (canJumpToToday ? 'grid-cols-2' : 'grid-cols-1')
            }
          >
            {canJumpToToday && (
              <button
                type="button"
                onClick={goToToday}
                className="print-hidden rounded-xl border border-today/30 bg-today/10 px-3 py-2 text-sm font-semibold text-today-ink transition-colors hover:bg-today/20 focus-visible:ring-2 focus-visible:ring-today focus-visible:ring-offset-2 focus-visible:outline-none sm:px-4 sm:py-2.5"
              >
                Ir a hoy
              </button>
            )}
            <SyncBadge state={sync} pending={pending} onRetry={retry} />
          </div>

          <div className="print-hidden flex justify-end gap-2 sm:ml-auto">
            <IconButton
              label="Colapsar todos"
              disabled={allCollapsed}
              onClick={() => setExpansion(expansionOf(false))}
            >
              <ChevronsIcon direction="up" />
            </IconButton>
            <IconButton
              label="Expandir todos"
              disabled={allExpanded}
              onClick={() => setExpansion(expansionOf(true))}
            >
              <ChevronsIcon direction="down" />
            </IconButton>
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
              expanded={expansion[monthKey(month.index)]}
              onToggle={() => toggleMonth(monthKey(month.index))}
            />
          ))}
        </div>

        <footer className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-muted">
          <span className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden="true">
              {DAY_COLORS.map((color) => (
                <span
                  key={color.id}
                  title={labelFor(palette, color.id)}
                  className="h-3 w-3 rounded"
                  style={{ backgroundColor: colorVar(color.id) }}
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
      </main>

      <NoticeBar notice={notice} onDismiss={dismiss} />

      {selectedKey && (
        <DayModal
          dateKey={selectedKey}
          entry={data[selectedKey]}
          palette={palette}
          catalogue={catalogue}
          onNeedImages={loadImages}
          onSave={handleSave}
          onClear={handleClear}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </>
  );
}

/** Botón cuadrado de la cabecera; el icono es su único contenido visible. */
function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-xl border border-edge bg-raised p-2.5 text-ink-soft transition-colors enabled:hover:bg-edge enabled:hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Doble chevron: plegar (arriba) o desplegar (abajo) todos los meses. */
function ChevronsIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={direction === 'up' ? 'rotate-180' : undefined}
    >
      <path d="M7 6l5 5 5-5M7 13l5 5 5-5" />
    </svg>
  );
}
