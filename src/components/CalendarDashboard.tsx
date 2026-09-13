import { useCallback, useEffect, useId, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import MonthCard from './MonthCard';
import YearTabs, { yearTabId } from './YearTabs';
import DayModal from './DayModal';
import NavBar, { type NavUser } from './NavBar';
import NoticeBar, { useNotice } from './NoticeBar';
import SyncBadge from './SyncBadge';
import { useCalendarStore } from './useCalendarStore';
import { useSettings } from './useSettings';
import {
  DAY_PARAM,
  formatLongDate,
  isCovered,
  isInYear,
  keysBetween,
  monthIndexOf,
  msUntilNextMidnight,
  todayKey,
  YEAR_MONTHS,
  YEAR_PARAM,
  yearOf,
  type CalendarYear,
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

type Props = {
  user: NavUser;
  /**
   * Año con el que arranca la rejilla. Lo resuelve el servidor a partir de la
   * URL —ver `YEAR_PARAM`—, y por eso llega como prop en vez de leerse aquí:
   * el HTML que baja ya trae el año correcto y no hay que cambiarlo al hidratar.
   */
  initialYear: CalendarYear;
};

export default function CalendarDashboard({ user, initialYear }: Props) {
  // Lo que cuente la sincronía se enseña en la misma banda del pie que el resto
  // de avisos, así que `announce` va también al almacén.
  const { notice, announce, dismiss } = useNotice();
  const { data, setData, hydrated, sync, pending, retry, adopt } = useCalendarStore(announce);
  const { palette, catalogue, settings } = useSettings({ data, setData, announce });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Año que dibuja la rejilla. Los doce meses son siempre de uno solo. */
  const [year, setYear] = useState<CalendarYear>(initialYear);
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

  /**
   * Cambia el año de la rejilla. Es solo estado de React: los doce meses se
   * vuelven a calcular y se repintan sin recargar la página.
   *
   * Deja el año en la URL para que recargar —o compartir el enlace— vuelva
   * aquí. Va con `replaceState` y no con `pushState` a propósito: esto es un
   * conmutador de vista, y llenar el historial de años haría que el botón de
   * atrás dejara de salir de la página.
   *
   * El ancla del rango se suelta porque era de otro año, y con ella un
   * Shift+clic marcaría doce meses de una vez; el modal se cierra porque el día
   * que tenía abierto ya no está en la rejilla que se ve.
   */
  const changeYear = useCallback((next: CalendarYear) => {
    setYear(next);
    setAnchorKey(null);
    setSelectedKey(null);

    const url = new URL(window.location.href);
    url.searchParams.set(YEAR_PARAM, String(next));
    window.history.replaceState(window.history.state, '', url);
  }, []);

  // `/?day=2027-03-15` abre ese día nada más cargar: es el enlace "Ver nota"
  // de la galería. Espera a los datos para que el modal nazca con la nota, y
  // despliega el mes y lo trae a la vista para que, al cerrar, el día esté
  // ahí. El parámetro se retira de la URL: recargar no debe reabrirlo.
  //
  // El año no se toca aquí: lo resuelve el servidor a partir de la propia
  // clave —ver `index.astro`—, así que la rejilla que baja ya es la del día que
  // se pide. Si aun así no lo fuera, el día se abre igual y solo se pierde el
  // desplazamiento, porque su casilla no está en la página.
  useEffect(() => {
    if (!hydrated || !expansionLoaded) return;

    const url = new URL(window.location.href);
    const key = url.searchParams.get(DAY_PARAM);
    if (!key) return;

    url.searchParams.delete(DAY_PARAM);
    window.history.replaceState(window.history.state, '', url);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isCovered(key)) return;

    setExpansion((current) => ({
      ...current,
      [monthKey(monthIndexOf(key))]: true,
    }));
    openDay(key);
    if (!isInYear(key, year)) return;
    document
      .querySelector<HTMLElement>(`[data-date="${key}"]`)
      ?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [hydrated, expansionLoaded, openDay, year]);

  /** Marca de golpe todo lo que hay entre el último día abierto y este. */
  const markRange = useCallback(
    (from: string, to: string) => {
      // Solo el año que se ve: el ancla se suelta al cambiar de año, así que
      // esto nunca debería recortar nada, pero un rango que se colara de un año
      // a otro pintaría meses que no están en la página.
      const keys = keysBetween(from, to).filter((key) => isInYear(key, year));
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
    [data, setData, palette, lastColor, announce, year],
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

  /** `id` de las pestañas del año y de la rejilla que gobiernan. */
  const tabsId = useId();
  const gridId = useId();

  const allExpanded = everyMonth(expansion, true);
  const allCollapsed = everyMonth(expansion, false);

  // Un calendario de doce meses no cabe en pantalla: este atajo devuelve a
  // hoy y le deja el foco, listo para seguir moviéndose con las flechas.
  // Basta con que el calendario cubra el día: si hoy cae en el otro año, el
  // salto cambia de pestaña por el camino en vez de desaparecer.
  const canJumpToToday = Boolean(today) && isCovered(today);

  const goToToday = useCallback(() => {
    if (!canJumpToToday) return;

    // El año y el mes se arreglan antes de saltar, y de forma síncrona: la
    // rejilla del otro año no existe en el DOM hasta que React la pinta, y la
    // casilla de un mes plegado es `inert` y no acepta el foco.
    const key = monthKey(monthIndexOf(today));
    const switchesYear = !isInYear(today, year);
    const wasCollapsed = !expansion[key];

    if (switchesYear || wasCollapsed) {
      flushSync(() => {
        if (switchesYear) changeYear(yearOf(today) as CalendarYear);
        if (wasCollapsed) setExpansion((current) => ({ ...current, [key]: true }));
      });
    }

    const cell = document.querySelector<HTMLElement>(`[data-date="${today}"]`);
    if (!cell) return;

    // Mientras el mes se despliega su altura cambia, así que en ese caso se
    // desplaza a la cabecera del mes y no al día, que aún se está moviendo.
    const target = wasCollapsed ? (cell.closest('section') ?? cell) : cell;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({
      behavior: still ? 'auto' : 'smooth',
      block: wasCollapsed ? 'start' : 'center',
    });
    cell.focus({ preventScroll: true });
  }, [today, year, expansion, canJumpToToday, changeYear]);

  return (
    <>
      <NavBar current="calendar" user={user} settings={settings} />

      <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-10 sm:px-6">
        {/* Lo que queda arriba: el año, ir a hoy, el estado de la sincronía y
            el plegado de los meses. Las cuentas del año se fueron a `/agenda`,
            junto a la lista de la que salen.

            Se reparte con `flex-wrap` y `order` en vez de con dos cabeceras
            porque cambia de forma según el ancho: en un teléfono el año y el
            plegado comparten la primera línea y el resto baja a la segunda, y a
            partir de `sm` los tres grupos caben en una sola fila con el plegado
            empujado al extremo. */}
        <header className="mb-8 flex flex-wrap items-center gap-2 sm:gap-3">
          {/* El rótulo del año se quitó de la vista: las pestañas y los doce
              meses ya lo dicen. Se queda para quien lea la página con un
              lector, que sí necesita un encabezado del que colgar el resto. */}
          <h1 className="sr-only">Calendario de {year}, de enero a diciembre</h1>

          <div className="order-1">
            <YearTabs
              year={year}
              onChange={changeYear}
              idPrefix={tabsId}
              panelId={gridId}
            />
          </div>

          {/* `ml-auto` lo manda al extremo derecho de su línea: la primera en
              un teléfono, junto al año, y la única a partir de `sm`, donde por
              el `order` es lo último de la fila. */}
          <div className="print-hidden order-2 ml-auto flex gap-2 sm:order-3">
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

          <div
            className={
              'order-3 grid w-full gap-2 sm:order-2 sm:flex sm:w-auto sm:items-center sm:gap-3 ' +
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
        </header>

        {/* La rejilla es el panel de la pestaña del año: doce meses en una
            columna en un teléfono y en dos a partir de `md`, como siempre.
            Cambiar de año la vuelve a montar entera —de ahí el `key`—, que es
            lo que hace que cada mes empiece de nuevo con su día 1 como parada
            de tabulación en vez de heredar la del año anterior. */}
        <div
          id={gridId}
          role="tabpanel"
          aria-labelledby={yearTabId(tabsId, year)}
          className="print-grid-2 grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {YEAR_MONTHS.map((month) => (
            <MonthCard
              key={`${year}-${month.index}`}
              year={year}
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
