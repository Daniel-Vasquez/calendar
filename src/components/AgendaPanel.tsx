import { useState } from 'react';
import { dayTimeState, formatLongDate, formatWeekday } from '../lib/calendar';
import { colorHex, DAY_COLORS, DEFAULT_COLOR, type ColorId } from '../lib/palette';
import { hasCustomLabel, labelFor, type ColorLabels } from '../lib/labels';
import type { CalendarData } from '../lib/storage';

type Props = {
  data: CalendarData;
  labels: ColorLabels;
  /** Clave `YYYY-MM-DD` de hoy; vacía hasta que el cliente hidrata. */
  today: string;
  onSelectDay: (key: string) => void;
};

const CHIP =
  'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:outline-none';

/**
 * Lista cronológica de todo lo registrado en el trimestre.
 *
 * La rejilla responde a "¿qué pasa este día?"; esta lista responde a "¿qué
 * tengo por delante?" sin recorrer cuatro meses cazando puntos de color.
 */
export default function AgendaPanel({ data, labels, today, onSelectDay }: Props) {
  // Los filtros son una lente sobre la lista, no un ajuste del calendario:
  // viven aquí y se olvidan al recargar.
  const [colorFilter, setColorFilter] = useState<ColorId | 'all'>('all');
  const [hidePast, setHidePast] = useState(false);

  // `YYYY-MM-DD` es de ancho fijo: ordenar como texto ya da el orden cronológico.
  const allKeys = Object.keys(data).sort();
  const pastCount = allKeys.filter((key) => dayTimeState(key, today) === 'past').length;

  // Solo se ofrecen los colores que alguien ha usado: filtrar por un color
  // vacío solo sirve para vaciar la lista.
  const usedColors = DAY_COLORS.filter((color) =>
    allKeys.some((key) => data[key].marked && (data[key].color ?? DEFAULT_COLOR) === color.id),
  );

  const keys = allKeys.filter((key) => {
    const entry = data[key];
    if (hidePast && dayTimeState(key, today) === 'past') return false;
    if (colorFilter === 'all') return true;
    return entry.marked && (entry.color ?? DEFAULT_COLOR) === colorFilter;
  });

  return (
    <section
      aria-labelledby="agenda-title"
      className="mt-5 rounded-2xl border border-edge bg-surface p-4 shadow-sm sm:p-5"
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="agenda-title" className="text-lg font-semibold tracking-tight text-ink">
          Agenda del trimestre
        </h2>
        {allKeys.length > 0 && (
          <span className="text-xs font-medium text-ink-muted">
            {keys.length === allKeys.length
              ? `${allKeys.length} ${allKeys.length === 1 ? 'día registrado' : 'días registrados'}`
              : `${keys.length} de ${allKeys.length} días`}
          </span>
        )}
      </header>

      {allKeys.length > 0 && (usedColors.length > 1 || pastCount > 0) && (
        <div className="print-hidden mb-3 flex flex-wrap items-center gap-2">
          {usedColors.length > 1 && (
            <>
              <button
                type="button"
                aria-pressed={colorFilter === 'all'}
                onClick={() => setColorFilter('all')}
                className={
                  CHIP +
                  (colorFilter === 'all'
                    ? ' border-ink bg-ink text-white'
                    : ' border-edge bg-white text-ink-soft hover:bg-edge')
                }
              >
                Todos
              </button>

              {usedColors.map((color) => {
                const active = colorFilter === color.id;
                return (
                  <button
                    key={color.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setColorFilter(active ? 'all' : color.id)}
                    className={
                      CHIP +
                      ' flex items-center gap-1.5 ' +
                      (active
                        ? ' border-ink bg-ink text-white'
                        : ' border-edge bg-white text-ink-soft hover:bg-edge')
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color.hex }}
                    />
                    {labelFor(labels, color.id)}
                  </button>
                );
              })}
            </>
          )}

          {pastCount > 0 && (
            <button
              type="button"
              aria-pressed={hidePast}
              onClick={() => setHidePast((current) => !current)}
              className={
                CHIP +
                ' ml-auto ' +
                (hidePast
                  ? ' border-ink bg-ink text-white'
                  : ' border-edge bg-white text-ink-soft hover:bg-edge')
              }
            >
              {hidePast ? `Mostrar ${pastCount} pasados` : 'Ocultar días pasados'}
            </button>
          )}
        </div>
      )}

      {allKeys.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          Todavía no hay nada anotado. Haz clic en cualquier día del calendario para empezar.
        </p>
      ) : keys.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          Ningún día coincide con el filtro.
        </p>
      ) : (
        // El trimestre admite más de cien entradas: la lista se queda con su
        // propio scroll para no empujar el pie de página fuera de la vista.
        <ul className="max-h-96 divide-y divide-edge overflow-y-auto">
          {keys.map((key) => {
            const entry = data[key];
            const timeState = dayTimeState(key, today);
            const category = labelFor(labels, entry.color);

            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelectDay(key)}
                  className={
                    'flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition ' +
                    'hover:bg-white focus-visible:ring-2 focus-visible:ring-accent ' +
                    'focus-visible:outline-none ' +
                    // Mismo desvanecido que en la rejilla: lo pasado pesa menos.
                    (timeState === 'past' ? 'opacity-60 hover:opacity-100' : '')
                  }
                >
                  <span
                    aria-hidden="true"
                    title={entry.marked ? category : undefined}
                    className={
                      'mt-0.5 h-3.5 w-3.5 shrink-0 rounded ' +
                      // Un día con nota pero sin marcar no tiene color propio:
                      // el hueco perfilado mantiene la lista alineada.
                      (entry.marked ? '' : 'ring-1 ring-edge ring-inset')
                    }
                    style={entry.marked ? { backgroundColor: colorHex(entry.color) } : undefined}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-ink">
                        {formatWeekday(key)} {formatLongDate(key)}
                      </span>
                      {timeState === 'today' && (
                        <span className="rounded-full bg-today/10 px-2 py-0.5 text-[11px] font-semibold text-today">
                          Hoy
                        </span>
                      )}
                      {/* El nombre de fábrica no aporta nada aquí: el color ya
                          se ve. Solo se enseña la categoría con nombre propio. */}
                      {entry.marked && hasCustomLabel(labels, entry.color) && (
                        <span className="text-[11px] font-medium text-ink-muted">{category}</span>
                      )}
                    </span>

                    {entry.note ? (
                      <span className="mt-0.5 line-clamp-2 block text-sm whitespace-pre-line text-ink-soft">
                        {entry.note}
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-sm text-ink-muted italic">
                        Día marcado, sin nota
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
