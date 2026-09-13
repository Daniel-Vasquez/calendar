import { useRef } from 'react';
import { YEARS, type CalendarYear } from '../lib/calendar';

type Props = {
  /** Año que la rejilla está dibujando. */
  year: CalendarYear;
  onChange: (year: CalendarYear) => void;
  /**
   * Prefijo de los `id` de las pestañas. Lo pone quien las dibuja porque
   * también lo necesita: la rejilla es el panel de la pestaña activa y se
   * nombra con su `id`.
   */
  idPrefix: string;
  /** `id` de la rejilla de meses, a la que gobiernan las pestañas. */
  panelId: string;
};

/** `id` de la pestaña de un año. La comparten el botón y el panel que nombra. */
export function yearTabId(prefix: string, year: number): string {
  return `${prefix}-${year}`;
}

const TAB =
  'rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-surface focus-visible:outline-none';

const ACTIVE = ' bg-raised text-ink shadow-sm';
const IDLE = ' text-ink-soft hover:text-ink';

/**
 * Conmutador de año: `2026 | 2027`, en la cabecera del calendario.
 *
 * Está aquí y no en la barra de navegación a propósito. El año solo significa
 * algo en la rejilla, que dibuja doce meses de uno concreto; la agenda, la
 * galería y los recordatorios enseñan todo lo registrado sin separarlo por
 * años, así que una pestaña de año allí no tendría nada que cambiar.
 *
 * Es un `tablist` de verdad —y no dos botones con `aria-pressed`— porque eso es
 * lo que hace: la rejilla de meses es su `tabpanel`. De ahí salen gratis las
 * flechas del teclado y que un lector anuncie «pestaña 2 de 2».
 *
 * La tabulación es itinerante, como en el mes: solo el año activo es una parada
 * de tab, y las flechas se mueven entre años. Cambiar de pestaña con las
 * flechas la activa en el acto —son dos, y obligar a confirmar con Enter sobra.
 */
export default function YearTabs({ year, onChange, idPrefix, panelId }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  function move(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = YEARS.length - 1;
    const at = YEARS.indexOf(year);
    const to =
      event.key === 'ArrowRight'
        ? Math.min(at + 1, last)
        : event.key === 'ArrowLeft'
          ? Math.max(at - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;

    if (to < 0) return;
    // Evita que las flechas desplacen la página mientras se elige el año.
    event.preventDefault();
    if (to === at) return;

    onChange(YEARS[to]);
    // El foco sigue a la pestaña elegida. Se mueve antes de que React repinte,
    // cuando su `tabIndex` todavía es -1: `focus()` no lo mira, y esperar a que
    // lo fuera obligaría a un efecto para algo que ya se sabe aquí.
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Año del calendario"
      onKeyDown={move}
      className="flex shrink-0 gap-1 rounded-xl border border-edge bg-surface p-1"
    >
      {YEARS.map((value) => {
        const active = value === year;
        return (
          <button
            key={value}
            id={yearTabId(idPrefix, value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(value)}
            className={TAB + (active ? ACTIVE : IDLE)}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}
