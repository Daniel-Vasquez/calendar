import { useId, useMemo, useState } from 'react';
import { dayTimeState, formatLongDate, formatWeekday } from '../lib/calendar';
import {
  colorVar,
  DAY_COLORS,
  DEFAULT_COLOR,
  hasCustomLabel,
  labelFor,
  type ColorId,
  type ColorPalette,
} from '../lib/palette';
import ReminderChip from './ReminderChip';
import { TagBadges } from './TagChips';
import type { Tag } from '../lib/tags';
import {
  AGENDA_TYPES,
  buildSearchIndex,
  hasNote,
  hasReminder,
  matchesQuery,
  matchesType,
  tokenize,
  type AgendaType,
} from '../lib/search';
import { hasImages, imageCount, type CalendarData } from '../lib/storage';

type Props = {
  data: CalendarData;
  palette: ColorPalette;
  /** Las etiquetas que existen, para escribir las que lleva cada día. */
  catalogue: Tag[];
  /** Clave `YYYY-MM-DD` de hoy; vacía hasta que el cliente hidrata. */
  today: string;
  /**
   * Abre el día para editarlo. Se pasa el botón pulsado para que el foco pueda
   * volver a esta misma fila al cerrarse el modal.
   */
  onSelect: (key: string, event: React.MouseEvent<HTMLElement>) => void;
};

const CHIP =
  'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:outline-none';

/** Las pestañas de tipo son el filtro principal: se pintan algo más grandes. */
const TAB =
  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:outline-none';

const ACTIVE = ' border-ink bg-ink text-canvas';
const IDLE = ' border-edge bg-raised text-ink-soft hover:bg-edge';

/**
 * Lista cronológica de todo lo registrado en el año, con su buscador y filtros.
 *
 * La rejilla responde a "¿qué pasa este día?"; esta lista responde a "¿qué
 * tengo por delante?" sin recorrer doce meses cazando puntos de color.
 *
 * Vivía apretada al pie del calendario, con su propio scroll para no empujar
 * fuera el resto de la página. Ahora tiene página, así que se la deja crecer: ni
 * marco, ni título propio —el de la página ya lo dice— ni alto máximo.
 *
 * Los filtros son cuatro y se combinan entre sí: el texto buscado, el tipo
 * (notas o recordatorios), el color y el pasado. Todos son una lente sobre la
 * lista, no un ajuste del calendario: viven aquí y se olvidan al recargar.
 *
 * Cada fila **abre el día aquí mismo**, en el modal de la página. Antes era un
 * enlace a `/?day=…`, y eso costaba caro: buscar «médico», pulsar un resultado
 * y aparecer en la portada dejaba atrás lo tecleado, los filtros y el sitio de
 * la lista, que había que rehacer a mano para seguir repasando. El modal es el
 * mismo que el de la rejilla, así que se puede hacer lo mismo sin salir; para
 * ver el día con su mes alrededor, el modal lleva su propio enlace.
 */
export default function AgendaList({ data, palette, catalogue, today, onSelect }: Props) {
  // Un solo instante para toda la lista: pedir la hora por fila daría estados
  // distintos dentro del mismo repintado.
  const now = Date.now();

  const [query, setQuery] = useState('');
  const [type, setType] = useState<AgendaType>('all');
  const [colorFilter, setColorFilter] = useState<ColorId | 'all'>('all');
  const [hidePast, setHidePast] = useState(false);

  // `YYYY-MM-DD` es de ancho fijo: ordenar como texto ya da el orden cronológico.
  const allKeys = useMemo(() => Object.keys(data).sort(), [data]);
  const pastCount = useMemo(
    () => allKeys.filter((key) => dayTimeState(key, today) === 'past').length,
    [allKeys, today],
  );

  // Solo se ofrecen los colores que alguien ha usado: filtrar por un color
  // vacío solo sirve para vaciar la lista.
  const usedColors = useMemo(
    () =>
      DAY_COLORS.filter((color) =>
        allKeys.some((key) => data[key].marked && (data[key].color ?? DEFAULT_COLOR) === color.id),
      ),
    [allKeys, data],
  );

  // El texto buscable se arma una vez por calendario, no una vez por tecla:
  // quitarle tildes a trescientos días en cada pulsación se nota al escribir.
  const index = useMemo(() => buildSearchIndex(data, palette, catalogue), [data, palette, catalogue]);
  const tokens = useMemo(() => tokenize(query), [query]);

  /**
   * Todo lo que pasa los filtros **menos** el de tipo. De aquí salen dos cosas:
   * los números de las pestañas y, filtrando una vez más, la lista final.
   *
   * Las cuentas se hacen sobre esta base y no sobre el año entero a propósito:
   * con "médico" escrito, "Recordatorios 2" dice cuántos avisos coinciden con
   * lo buscado, que es la pregunta que se está haciendo en ese momento.
   */
  const base = useMemo(
    () =>
      allKeys.filter((key) => {
        const entry = data[key];
        if (hidePast && dayTimeState(key, today) === 'past') return false;
        if (colorFilter !== 'all') {
          if (!entry.marked || (entry.color ?? DEFAULT_COLOR) !== colorFilter) return false;
        }
        return matchesQuery(index[key], tokens);
      }),
    [allKeys, data, hidePast, today, colorFilter, index, tokens],
  );

  const counts = useMemo(
    () => ({
      all: base.length,
      notes: base.filter((key) => hasNote(data[key])).length,
      reminders: base.filter((key) => hasReminder(data[key])).length,
    }),
    [base, data],
  );

  const keys = useMemo(
    () => base.filter((key) => matchesType(data[key], type)),
    [base, data, type],
  );

  const filtering =
    tokens.length > 0 || type !== 'all' || colorFilter !== 'all' || hidePast;

  function clearFilters() {
    setQuery('');
    setType('all');
    setColorFilter('all');
    setHidePast(false);
  }

  return (
    <section aria-label="Días registrados">
      {allKeys.length > 0 && (
        <div className="print-hidden mb-4 space-y-3">
          <SearchField value={query} onChange={setQuery} />

          {/* En un teléfono las pestañas ocupan su fila y "Ocultar pasados" cae
              debajo; a partir de `sm` comparten renglón y el segundo se va al
              extremo, que es donde estaba antes de haber pestañas. */}
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-2">
              {AGENDA_TYPES.map((tab) => {
                const active = type === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setType(tab.id)}
                    className={TAB + (active ? ACTIVE : IDLE)}
                  >
                    {tab.label}
                    <span
                      className={
                        'ml-2 tabular-nums ' + (active ? 'text-canvas/70' : 'text-ink-muted')
                      }
                    >
                      {counts[tab.id]}
                    </span>
                  </button>
                );
              })}
            </div>

            {pastCount > 0 && (
              <button
                type="button"
                aria-pressed={hidePast}
                onClick={() => setHidePast((current) => !current)}
                className={CHIP + ' sm:ml-auto' + (hidePast ? ACTIVE : IDLE)}
              >
                {hidePast ? `Mostrar ${pastCount} pasados` : 'Ocultar días pasados'}
              </button>
            )}
          </div>

          {usedColors.length > 1 && (
            <div role="group" aria-label="Filtrar por color" className="flex flex-wrap items-center gap-2">
              {/* El rótulo no es decoración: sin él habría dos "Todos" seguidos
                  —el de tipo y el de color— sin nada que los distinga. */}
              <span className="text-xs font-medium text-ink-muted">Color</span>

              <button
                type="button"
                aria-pressed={colorFilter === 'all'}
                onClick={() => setColorFilter('all')}
                className={CHIP + (colorFilter === 'all' ? ACTIVE : IDLE)}
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
                    className={CHIP + ' flex items-center gap-1.5' + (active ? ACTIVE : IDLE)}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorVar(color.id) }}
                    />
                    {labelFor(palette, color.id)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Cuántos quedan a la vista. Solo con un filtro puesto: sin él, el
          total ya lo dice la cabecera de la página y repetirlo es ruido. */}
      {keys.length > 0 && keys.length !== allKeys.length && (
        <p className="mb-2 text-xs font-medium text-ink-muted" aria-live="polite">
          {keys.length} de {allKeys.length} días
        </p>
      )}

      {allKeys.length === 0 ? (
        <EmptyState />
      ) : keys.length === 0 ? (
        <NoResults query={query.trim()} type={type} onClear={filtering ? clearFilters : undefined} />
      ) : (
        <ul className="divide-y divide-edge rounded-2xl border border-edge bg-surface px-2 shadow-sm sm:px-3">
          {keys.map((key) => {
            const entry = data[key];
            const timeState = dayTimeState(key, today);
            const category = labelFor(palette, entry.color);
            const images = imageCount(entry);
            // La completa si este navegador la tiene; si no, la miniatura que
            // baja con el día. Por eso la agenda no espera a ninguna descarga.
            const preview = entry.images?.[0] ?? entry.thumb;

            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={(event) => onSelect(key, event)}
                  aria-label={`Editar ${formatWeekday(key)} ${formatLongDate(key)}`}
                  className={
                    'flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition ' +
                    'hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent ' +
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
                    style={entry.marked ? { backgroundColor: colorVar(entry.color) } : undefined}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-ink">
                        {formatWeekday(key)} {formatLongDate(key)}
                      </span>
                      {timeState === 'today' && (
                        <span className="rounded-full bg-today/10 px-2 py-0.5 text-[11px] font-semibold text-today-ink">
                          Hoy
                        </span>
                      )}
                      {/* El nombre de fábrica no aporta nada aquí: el color ya
                          se ve. Solo se enseña la categoría con nombre propio. */}
                      {entry.marked && hasCustomLabel(palette, entry.color) && (
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
                    ) : entry.reminder ? (
                      // Queda el caso del día que solo existe por su aviso: ni
                      // marcado, ni con nota, ni con imágenes.
                      <span className="mt-0.5 block text-sm text-ink-muted italic">
                        Solo recordatorio
                      </span>
                    ) : (
                      // Y el del día que solo existe por sus etiquetas, que se
                      // enseñan aquí abajo y harían redundante repetirlas.
                      <span className="mt-0.5 block text-sm text-ink-muted italic">
                        Solo etiquetas
                      </span>
                    )}

                    <TagBadges catalogue={catalogue} tags={entry.tags} className="mt-1.5" />
                  </span>

                  {hasImages(entry) && preview && (
                    <span className="relative shrink-0">
                      <img
                        src={preview}
                        alt=""
                        className="h-12 w-12 rounded-lg object-cover ring-1 ring-edge"
                      />
                      {images > 1 && (
                        <span className="absolute -right-1 -bottom-1 rounded-md bg-ink px-1 text-[10px] font-semibold text-canvas">
                          +{images - 1}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * El campo de búsqueda: lupa a la izquierda y aspa para vaciarlo a la derecha.
 *
 * Filtra según se teclea, sin retardo ni botón de buscar: el año entero son
 * unos cientos de días ya indexados, así que no hay nada que esperar. La tecla
 * Escape vacía el campo, que es lo que hace cualquier buscador y ahorra ir a
 * por el aspa con el ratón.
 *
 * El aspa es **propia** y la nativa de `type="search"` se esconde: la de WebKit
 * solo aparece en algunos navegadores, no se deja teñir con los tokens del
 * tema y dejaría dos aspas juntas en Safari.
 */
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Buscar en la agenda
      </label>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-muted"
      >
        <SearchIcon />
      </span>

      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
        placeholder="Buscar por texto, fecha o categoría…"
        autoComplete="off"
        className={
          'w-full rounded-xl border border-edge bg-raised py-2.5 pr-10 pl-10 text-sm text-ink ' +
          'placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 ' +
          'focus:outline-none [&::-webkit-search-cancel-button]:appearance-none'
        }
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className={
            'absolute inset-y-0 right-0 flex items-center px-3 text-ink-muted transition-colors ' +
            'hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:rounded-xl ' +
            'focus-visible:outline-none'
          }
        >
          <ClearIcon />
        </button>
      )}
    </div>
  );
}

/**
 * Hay días anotados, pero ninguno pasa la lente puesta.
 *
 * Dice **por qué** está vacío —lo buscado, el tipo elegido— en vez de un
 * "sin resultados" a secas, y deja a un clic el volver a verlo todo: quien
 * llega aquí casi siempre quiere deshacer, no seguir afinando.
 */
function NoResults({
  query,
  type,
  onClear,
}: {
  query: string;
  type: AgendaType;
  onClear?: () => void;
}) {
  const typeLabel =
    type === 'notes' ? 'notas' : type === 'reminders' ? 'recordatorios' : '';

  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge bg-surface px-6 py-12 text-center">
      <span aria-hidden="true" className="text-ink-muted">
        <SearchIcon size={32} strokeWidth={1.75} />
      </span>

      <h2 className="mt-4 text-base font-semibold text-ink">Sin resultados</h2>

      <p className="mt-2 max-w-sm text-sm text-ink-soft" aria-live="polite">
        {query ? (
          <>
            Ningún día {typeLabel ? `con ${typeLabel} ` : ''}coincide con{' '}
            <span className="font-medium text-ink">«{query}»</span>. Prueba con otra palabra o
            con una fecha, como «marzo» o «15/03».
          </>
        ) : typeLabel ? (
          `No hay ningún día con ${typeLabel} entre los que deja ver el filtro.`
        ) : (
          'Ningún día coincide con el filtro.'
        )}
      </p>

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 rounded-xl border border-edge bg-raised px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Quitar los filtros
        </button>
      )}
    </div>
  );
}

/** Lupa. Sirve al campo de búsqueda y al estado sin resultados. */
function SearchIcon({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

/** Aspa del campo de búsqueda. */
function ClearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
    </svg>
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
