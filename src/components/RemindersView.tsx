import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NavBar, { type NavUser } from './NavBar';
import ReminderChip, { BellIcon } from './ReminderChip';
import ReminderModal from './ReminderModal';
import SyncBadge from './SyncBadge';
import { useCalendarStore } from './useCalendarStore';
import {
  dayHref,
  dayTimeState,
  formatLongDate,
  formatWeekday,
  isInQuarter,
  todayKey,
  YEAR,
} from '../lib/calendar';
import { colorHex } from '../lib/palette';
import { reminderText, type Reminder } from '../lib/reminder';
import {
  collectReminders,
  countReminders,
  matchesFilter,
  moveReminder,
  REMINDER_LABEL,
  splitReminders,
  withDone,
  withReminder,
  type ReminderFilter,
  type ReminderItem,
} from '../lib/reminders';
import type { CalendarData } from '../lib/storage';

/**
 * Aviso efímero del pie. Con `snapshot` ofrece deshacer —guarda el calendario
 * entero anterior al cambio—; sin él es solo un mensaje. Igual que el del
 * calendario, y por el mismo motivo: borrar un recordatorio es irreversible y
 * aquí se borra de un clic.
 */
type Notice = { message: string; snapshot?: CalendarData };

const TABS: { id: ReminderFilter; label: string }[] = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'done', label: 'Completados' },
  { id: 'all', label: 'Todos' },
];

const CHIP =
  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:outline-none';

const ROW_ACTION =
  'rounded-lg border border-edge bg-white px-2.5 py-1 text-xs font-medium text-ink-soft ' +
  'transition-colors hover:bg-edge hover:text-ink ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none';

/**
 * Todos los recordatorios del año en una sola lista.
 *
 * El calendario responde a «¿qué pasa este día?» y la agenda a «¿qué tengo por
 * delante?»; esta página responde a la tercera pregunta, que hasta ahora no
 * tenía dónde hacerse: «¿qué me queda por hacer, y qué ya está?».
 *
 * Escribe en el mismo sitio que el calendario —`useCalendarStore`—, así que
 * marcar algo aquí es marcarlo allí: el día se guarda, se encola y sube a la
 * cuenta por la misma vía que una edición hecha en la rejilla.
 */
export default function RemindersView({ user }: { user: NavUser }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const announce = useCallback((message: string) => setNotice({ message }), []);
  const { data, setData, hydrated, sync, pending, retry } = useCalendarStore(announce);

  const [filter, setFilter] = useState<ReminderFilter>('pending');
  /**
   * Qué hace el modal ahora mismo. Tres estados en uno:
   * `null` cerrado, `{ key: null }` creando y `{ key: '2026-…' }` editando ese
   * día. Van juntos porque es un único modal con dos modos, y tenerlos en dos
   * banderas permitiría el estado imposible de crear y editar a la vez.
   */
  const [editor, setEditor] = useState<{ key: string | null } | null>(null);
  /** Botón que abrió el modal: a él vuelve el foco al cerrarse. */
  const triggerRef = useRef<HTMLElement | null>(null);

  /**
   * El reloj de la página.
   *
   * Se guarda en el estado en vez de leerse al pintar por dos razones: el
   * primer render tiene que coincidir con el HTML del servidor —que no tiene
   * reloj—, y una lista que se deja abierta toda la mañana debe ir moviendo a
   * «pasados» lo que vaya venciendo sin que haya que recargarla.
   */
  const [clock, setClock] = useState({ now: 0, today: '' });

  useEffect(() => {
    function refresh() {
      setClock({ now: Date.now(), today: todayKey() });
    }
    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }

    refresh();
    // Cada minuto basta: la hora de un aviso no tiene segundos.
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const items = useMemo(() => collectReminders(data, clock.now), [data, clock.now]);
  const counts = useMemo(() => countReminders(items), [items]);
  const visible = useMemo(
    () => items.filter((item) => matchesFilter(item, filter)),
    [items, filter],
  );
  const { upcoming, past } = useMemo(
    () => splitReminders(visible, clock.now),
    [visible, clock.now],
  );

  // El aviso caduca solo. Cada cambio crea un objeto nuevo, así que el
  // temporizador se reinicia con él en lugar de heredar la cuenta anterior.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Si el día que se está editando se va desde otra pestaña, el modal se
  // cierra solo en vez de quedarse editando algo que ya no existe. Creando no
  // hay nada que vigilar: todavía no existe por definición.
  const editingKey = editor?.key ?? null;
  const editingEntry = editingKey ? data[editingKey] : undefined;
  useEffect(() => {
    if (editingKey && !editingEntry?.reminder) setEditor(null);
  }, [editingKey, editingEntry]);

  const handleToggle = useCallback(
    (key: string, done: boolean) => {
      setData((current) => withDone(current, key, done));
      setNotice(null);
    },
    [setData],
  );

  const handleDelete = useCallback(
    (key: string) => {
      const snapshot = data;
      setData((current) => withReminder(current, key, undefined));
      setEditor(null);
      setNotice({ message: `Se borró el recordatorio del ${formatLongDate(key)}.`, snapshot });
    },
    [data, setData],
  );

  /**
   * Guarda lo que salga del modal, venga de crear o de editar. La instantánea
   * va siempre: crear puede pisar el aviso que ya tuviera ese día, y editar
   * sustituye el texto y la hora anteriores. En los tres casos hay algo que
   * deshacer.
   */
  const handleSaveEditor = useCallback(
    (from: string | null, to: string, reminder: Reminder) => {
      const snapshot = data;
      const pisa = from !== to && Boolean(data[to]?.reminder);
      setData((current) =>
        from === null ? withReminder(current, to, reminder) : moveReminder(current, from, to, reminder),
      );
      setEditor(null);

      const cuando = formatLongDate(to);
      setNotice({
        message: pisa
          ? `Se sustituyó el recordatorio del ${cuando}.`
          : from === null
            ? `Se creó el recordatorio del ${cuando}.`
            : from === to
              ? `Se guardó el recordatorio del ${cuando}.`
              : `El recordatorio se movió al ${cuando}.`,
        snapshot,
      });
    },
    [data, setData],
  );

  const handleUndo = useCallback(() => {
    if (!notice?.snapshot) return;
    setData(notice.snapshot);
    setNotice(null);
  }, [notice, setData]);

  const hasReminder = useCallback((key: string) => Boolean(data[key]?.reminder), [data]);
  const noteOf = useCallback((key: string) => data[key]?.note ?? '', [data]);

  /** Día que se propone al crear: hoy, o el principio del año si queda fuera. */
  const defaultKey = clock.today && isInQuarter(clock.today) ? clock.today : `${YEAR}-01-01`;

  function openEditor(key: string | null, event: React.MouseEvent<HTMLElement>) {
    triggerRef.current = event.currentTarget;
    setEditor({ key });
  }

  const row = (item: ReminderItem) => (
    <ReminderCard
      key={item.key}
      item={item}
      now={clock.now}
      today={clock.today}
      onToggle={handleToggle}
      onEdit={openEditor}
      onDelete={handleDelete}
    />
  );

  return (
    <>
      <NavBar current="reminders" user={user} />

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-highlight uppercase">
                Avisos programados
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Recordatorios
              </h1>
              <p className="mt-2 text-sm text-ink-soft">
                {/* El recuento espera a la hidratación: en el servidor siempre sería cero. */}
                {!hydrated
                  ? 'Los recordatorios que pongas en tus días aparecen aquí.'
                  : counts.all === 0
                    ? 'Los recordatorios que pongas en tus días aparecen aquí.'
                    : counts.pending > 0
                      ? `${counts.pending} sin hacer de ${counts.all} en total.`
                      : `Los ${counts.all} están hechos.`}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <SyncBadge state={sync} pending={pending} onRetry={retry} />
              <button
                type="button"
                onClick={(event) => openEditor(null, event)}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Nuevo recordatorio
              </button>
            </div>
          </div>
        </header>

        {/* Hasta hidratar no se sabe si hay avisos: mejor un hueco que un
            estado vacío que desaparece al instante. */}
        {!hydrated ? (
          <div className="min-h-64" aria-busy="true" />
        ) : counts.all === 0 ? (
          <EmptyState onCreate={openEditor} />
        ) : (
          <>
            <div
              role="group"
              aria-label="Filtrar recordatorios"
              className="mb-6 flex flex-wrap items-center gap-2"
            >
              {TABS.map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(tab.id)}
                    className={
                      CHIP +
                      (active
                        ? ' border-ink bg-ink text-white'
                        : ' border-edge bg-white text-ink-soft hover:bg-edge')
                    }
                  >
                    {tab.label}
                    <span
                      className={
                        'ml-2 tabular-nums ' + (active ? 'text-white/70' : 'text-ink-muted')
                      }
                    >
                      {counts[tab.id]}
                    </span>
                  </button>
                );
              })}
            </div>

            {visible.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-edge bg-surface py-12 text-center text-sm text-ink-muted">
                {filter === 'done'
                  ? 'Todavía no has dado ninguno por hecho.'
                  : 'No queda ninguno pendiente. Están todos hechos.'}
              </p>
            ) : (
              <div className="space-y-8">
                {upcoming.length > 0 && (
                  <section aria-labelledby="proximos">
                    <SectionTitle id="proximos" count={upcoming.length}>
                      Próximos
                    </SectionTitle>
                    <ul className="space-y-3">{upcoming.map(row)}</ul>
                  </section>
                )}

                {past.length > 0 && (
                  <section aria-labelledby="pasados">
                    <SectionTitle id="pasados" count={past.length}>
                      Ya pasaron
                    </SectionTitle>
                    <ul className="space-y-3">{past.map(row)}</ul>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {notice && (
        // Bajo el modal (z-50) y sin capturar el cursor salvo en la tarjeta:
        // la banda ocupa todo el ancho y bloquearía lo que haya debajo.
        <div
          role="status"
          className="animate-panel-in pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
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
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {editor && (editor.key === null || editingEntry?.reminder) && (
        <ReminderModal
          dateKey={editor.key}
          reminder={editingEntry?.reminder}
          defaultKey={defaultKey}
          noteOf={noteOf}
          hasReminder={hasReminder}
          triggerRef={triggerRef}
          onSave={handleSaveEditor}
          onDelete={handleDelete}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

function SectionTitle({
  id,
  count,
  children,
}: {
  id: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="mb-3 flex items-baseline gap-2 text-sm font-semibold tracking-tight text-ink">
      {children}
      <span className="text-xs font-medium text-ink-muted tabular-nums">{count}</span>
    </h2>
  );
}

/**
 * Una tarjeta por recordatorio: cuándo, qué, en qué punto está y qué se puede
 * hacer con él. La casilla no abre nada —marcar algo como hecho es un clic y
 * no debería costar dos—, y el resto son acciones explícitas.
 */
function ReminderCard({
  item,
  now,
  today,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: ReminderItem;
  now: number;
  today: string;
  onToggle: (key: string, done: boolean) => void;
  onEdit: (key: string, event: React.MouseEvent<HTMLElement>) => void;
  onDelete: (key: string) => void;
}) {
  const { key, reminder, note, done, state } = item;
  const text = reminderText(reminder, note);
  /** Sin texto propio, lo que se manda es la nota: conviene decirlo. */
  const fromNote = !reminder.text?.trim();
  const timeState = dayTimeState(key, today);

  return (
    <li
      className={
        'rounded-2xl border border-edge bg-surface p-4 shadow-sm transition-opacity ' +
        (done ? 'opacity-70 hover:opacity-100' : '')
      }
    >
      <div className="flex items-start gap-3">
        <label className="mt-0.5 flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={done}
            onChange={(event) => onToggle(key, event.target.checked)}
            aria-label={`Dar por hecho: ${text}`}
            className="peer sr-only"
          />
          <span className="flex h-5 w-5 items-center justify-center rounded-md border border-edge bg-white text-white transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.5 6.3l2.4 2.4L9.6 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ReminderChip reminder={reminder} now={now} />
            <span className="text-sm font-semibold text-ink">
              {formatWeekday(key)} {formatLongDate(key)}
            </span>
            {timeState === 'today' && (
              <span className="rounded-full bg-today/10 px-2 py-0.5 text-[11px] font-semibold text-today">
                Hoy
              </span>
            )}
            {item.marked && (
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorHex(item.color) }}
              />
            )}
            {/* Lo que ya no va a pasar se dice con palabras, no solo con el
                color del chip: «se pasó» y «enviado» no se adivinan. */}
            {(state === 'missed' || state === 'sent') && (
              <span className="text-[11px] font-medium text-ink-muted">
                {REMINDER_LABEL[state]}
              </span>
            )}
          </div>

          <p
            className={
              'mt-1 text-sm ' + (done ? 'text-ink-muted line-through' : 'text-ink-soft')
            }
          >
            {text}
          </p>
          {fromNote && (
            <p className="mt-0.5 text-xs text-ink-muted italic">Texto tomado de la nota del día</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={(event) => onEdit(key, event)} className={ROW_ACTION}>
              Editar
            </button>
            <a href={dayHref(key)} className={ROW_ACTION + ' inline-block'}>
              Ver en el calendario
            </a>
            <button
              type="button"
              onClick={() => onDelete(key)}
              className={ROW_ACTION + ' hover:bg-highlight-soft hover:text-highlight'}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Sin recordatorios todavía: explica qué son y ofrece las dos formas de poner uno. */
function EmptyState({
  onCreate,
}: {
  onCreate: (key: null, event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge bg-surface px-6 py-16 text-center">
      <span className="text-ink-muted">
        <BellIcon size={64} />
      </span>
      <h2 className="mt-5 text-lg font-semibold text-ink">Todavía no hay recordatorios</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">
        Un recordatorio es una hora de un día y un aviso que llega por Telegram. Puedes crear uno
        aquí mismo, o encender «Recordarme este día» en cualquier día del calendario: acaben donde
        acaben, se reúnen todos en esta lista para repasarlos y tacharlos.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={(event) => onCreate(null, event)}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Crear el primero
        </button>
        <a
          href="/"
          className="rounded-xl border border-edge bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Ir al calendario
        </a>
      </div>
    </div>
  );
}
