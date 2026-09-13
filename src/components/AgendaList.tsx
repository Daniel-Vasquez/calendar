import { useState } from 'react';
import { dayHref, dayTimeState, formatLongDate, formatWeekday } from '../lib/calendar';
import { colorHex, DAY_COLORS, DEFAULT_COLOR, type ColorId } from '../lib/palette';
import { hasCustomLabel, labelFor, type ColorLabels } from '../lib/labels';
import ReminderChip from './ReminderChip';
import { hasImages, imageCount, type CalendarData } from '../lib/storage';

type Props = {
  data: CalendarData;
  labels: ColorLabels;
  /** Clave `YYYY-MM-DD` de hoy; vacía hasta que el cliente hidrata. */
  today: string;
};

const CHIP =
  'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:outline-none';

/**
 * Lista cronológica de todo lo registrado en el año, con sus filtros.
 *
 * La rejilla responde a "¿qué pasa este día?"; esta lista responde a "¿qué
 * tengo por delante?" sin recorrer doce meses cazando puntos de color.
 *
 * Vivía apretada al pie del calendario, con su propio scroll para no empujar
 * fuera el resto de la página. Ahora tiene página, así que se la deja crecer: ni
 * marco, ni título propio —el de la página ya lo dice— ni alto máximo.
 *
 * Cada fila es un **enlace** al día en el calendario, no un botón que abra nada
 * aquí. Es el mismo camino que "Ver nota" en la galería y "Ver en el calendario"
 * en los recordatorios: editar un día entero es cosa de su modal, y ese vive
 * donde está la rejilla.
 */
export default function AgendaList({ data, labels, today }: Props) {
  // Un solo instante para toda la lista: pedir la hora por fila daría estados
  // distintos dentro del mismo repintado.
  const now = Date.now();

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
    <section aria-label="Días registrados">
      {allKeys.length > 0 && (usedColors.length > 1 || pastCount > 0) && (
        <div className="print-hidden mb-4 flex flex-wrap items-center gap-2">
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

      {/* Cuántos quedan a la vista. Solo con un filtro puesto: sin él, el
          total ya lo dice la cabecera de la página y repetirlo es ruido. */}
      {keys.length > 0 && keys.length !== allKeys.length && (
        <p className="mb-2 text-xs font-medium text-ink-muted">
          {keys.length} de {allKeys.length} días
        </p>
      )}

      {allKeys.length === 0 ? (
        <EmptyState />
      ) : keys.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge bg-surface py-12 text-center text-sm text-ink-muted">
          Ningún día coincide con el filtro.
        </p>
      ) : (
        <ul className="divide-y divide-edge rounded-2xl border border-edge bg-surface px-2 shadow-sm sm:px-3">
          {keys.map((key) => {
            const entry = data[key];
            const timeState = dayTimeState(key, today);
            const category = labelFor(labels, entry.color);
            const images = imageCount(entry);
            // La completa si este navegador la tiene; si no, la miniatura que
            // baja con el día. Por eso la agenda no espera a ninguna descarga.
            const preview = entry.images?.[0] ?? entry.thumb;

            return (
              <li key={key}>
                <a
                  href={dayHref(key)}
                  aria-label={`Ver ${formatWeekday(key)} ${formatLongDate(key)} en el calendario`}
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
                      {entry.reminder && <ReminderChip reminder={entry.reminder} now={now} />}
                    </span>

                    {entry.note ? (
                      <span className="mt-0.5 line-clamp-2 block text-sm whitespace-pre-line text-ink-soft">
                        {entry.note}
                      </span>
                    ) : hasImages(entry) ? (
                      <span className="mt-0.5 block text-sm text-ink-muted italic">
                        {images === 1
                          ? 'Imagen adjunta, sin texto'
                          : `${images} imágenes adjuntas, sin texto`}
                      </span>
                    ) : entry.marked ? (
                      <span className="mt-0.5 block text-sm text-ink-muted italic">
                        Día marcado, sin nota
                      </span>
                    ) : (
                      // Queda el caso del día que solo existe por su aviso: ni
                      // marcado, ni con nota, ni con imágenes.
                      <span className="mt-0.5 block text-sm text-ink-muted italic">
                        Solo recordatorio
                      </span>
                    )}
                  </span>

                  {hasImages(entry) && preview && (
                    <span className="relative shrink-0">
                      <img
                        src={preview}
                        alt=""
                        className="h-12 w-12 rounded-lg object-cover ring-1 ring-edge"
                      />
                      {images > 1 && (
                        <span className="absolute -right-1 -bottom-1 rounded-md bg-ink px-1 text-[10px] font-semibold text-white">
                          +{images - 1}
                        </span>
                      )}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Sin nada anotado todavía: explica de dónde sale la lista y lleva a la rejilla. */
function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge bg-surface px-6 py-16 text-center">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="text-ink-muted"
      >
        <rect x="10" y="12" width="44" height="40" rx="6" stroke="currentColor" strokeWidth="2.5" />
        <path d="M10 24h44" stroke="currentColor" strokeWidth="2.5" />
        <path
          d="M22 8v8M42 8v8"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M20 34h10M20 42h18"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <h2 className="mt-5 text-lg font-semibold text-ink">Todavía no hay nada anotado</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">
        Marca un día en el calendario, escríbele una nota o adjúntale una imagen. Todo lo que
        registres en el año se reúne aquí, en orden y con sus filtros.
      </p>
      <a
        href="/"
        className="mt-6 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Ir al calendario
      </a>
    </div>
  );
}
