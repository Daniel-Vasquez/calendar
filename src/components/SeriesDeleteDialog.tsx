import { useEffect, useId, useRef } from 'react';
import { formatLongDate } from '../lib/calendar';
import type { DeleteScope } from '../lib/repeat';
import { useDialog } from './useDialog';

type Props = {
  dateKey: string;
  /** Cuántos días se lleva cada opción. Lo calcula `scopeKeys`. */
  counts: Record<DeleteScope, number>;
  onPick: (scope: DeleteScope) => void;
  onClose: () => void;
};

const OPTION =
  'w-full rounded-xl border border-edge bg-raised px-4 py-3 text-left transition-colors ' +
  'hover:border-highlight/50 hover:bg-highlight-soft ' +
  'focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:outline-none';

/**
 * Las tres formas de borrar un día que pertenece a una serie.
 *
 * Se interpone **antes** del borrado y no después, porque las tres son
 * destructivas y dos de ellas alcanzan a días que no están en pantalla: pulsar
 * «eliminar» en un día de una serie semanal puede llevarse sesenta y tres
 * fechas, y eso no se pregunta con un «¿seguro?».
 *
 * Cada opción lleva **su número** al lado. Es lo que convierte la pregunta en
 * una decisión: sin él, «y los siguientes» obliga a contar casillas en la
 * rejilla para saber qué se está aceptando.
 *
 * No hay opción predeterminada ni foco en ninguna de las tres: el foco entra en
 * «Cancelar», que es lo único que no rompe nada. Las tres borran de verdad, y
 * el aviso del pie ofrece deshacerlo.
 */
export default function SeriesDeleteDialog({ dateKey, counts, onPick, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useDialog(panelRef, onClose);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const opciones: { scope: DeleteScope; label: string; hint: string }[] = [
    {
      scope: 'one',
      label: 'Solo este evento',
      hint: 'Se borra este día y el resto de la serie se queda como está.',
    },
    {
      scope: 'forward',
      label: 'Este y los eventos futuros',
      hint: 'Se borran este día y todos los de la serie posteriores a él.',
    },
    {
      scope: 'all',
      label: 'Todos los eventos',
      hint: 'Se borra la serie entera, también los días ya pasados.',
    },
  ];

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[60] flex items-end justify-center bg-scrim/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-panel-in w-11/12 max-w-md rounded-2xl border border-edge bg-canvas p-6 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          Este día se repite
        </h2>
        <p className="mt-1.5 text-sm text-ink-soft">
          El {formatLongDate(dateKey)} forma parte de una serie de{' '}
          {counts.all === 1 ? 'un día' : `${counts.all} días`}. ¿Qué quieres borrar?
        </p>

        <div className="mt-5 space-y-2">
          {opciones.map((opcion) => {
            const total = counts[opcion.scope];
            return (
              <button
                key={opcion.scope}
                type="button"
                onClick={() => onPick(opcion.scope)}
                className={OPTION}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{opcion.label}</span>
                  <span className="shrink-0 text-xs font-semibold text-ink-muted tabular-nums">
                    {total === 1 ? '1 día' : `${total} días`}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">{opcion.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="rounded-xl border border-edge bg-raised px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-edge focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Cancelar
          </button>
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          Se puede deshacer desde el aviso que aparece abajo.
        </p>
      </div>
    </div>
  );
}
