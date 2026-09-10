import { dayTimeState, formatLongDate, formatWeekday } from '../lib/calendar';
import { colorHex } from '../lib/palette';
import type { CalendarData } from '../lib/storage';

type Props = {
  data: CalendarData;
  /** Clave `YYYY-MM-DD` de hoy; vacía hasta que el cliente hidrata. */
  today: string;
  onSelectDay: (key: string) => void;
};

/**
 * Lista cronológica de todo lo registrado en el trimestre.
 *
 * La rejilla responde a "¿qué pasa este día?"; esta lista responde a "¿qué
 * tengo por delante?" sin recorrer cuatro meses cazando puntos de color.
 */
export default function AgendaPanel({ data, today, onSelectDay }: Props) {
  // `YYYY-MM-DD` es de ancho fijo: ordenar como texto ya da el orden cronológico.
  const keys = Object.keys(data).sort();

  return (
    <section
      aria-labelledby="agenda-title"
      className="mt-5 rounded-2xl border border-edge bg-surface p-4 shadow-sm sm:p-5"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="agenda-title" className="text-lg font-semibold tracking-tight text-ink">
          Agenda del trimestre
        </h2>
        {keys.length > 0 && (
          <span className="text-xs font-medium text-ink-muted">
            {keys.length} {keys.length === 1 ? 'día registrado' : 'días registrados'}
          </span>
        )}
      </header>

      {keys.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          Todavía no hay nada anotado. Haz clic en cualquier día del calendario para empezar.
        </p>
      ) : (
        // El trimestre admite más de cien entradas: la lista se queda con su
        // propio scroll para no empujar el pie de página fuera de la vista.
        <ul className="max-h-96 divide-y divide-edge overflow-y-auto">
          {keys.map((key) => {
            const entry = data[key];
            const timeState = dayTimeState(key, today);

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
