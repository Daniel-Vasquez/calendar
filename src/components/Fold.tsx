import { useId } from 'react';

type Props = {
  /** Rótulo de la pestaña. Es lo único visible cuando el panel está plegado. */
  title: string;
  open: boolean;
  /** Pulsar la cabecera. Quien manda decide a quién cierra al abrir este. */
  onToggle: () => void;
  children: React.ReactNode;
};

/**
 * Una sección plegable de los ajustes.
 *
 * No guarda si está abierta: eso lo lleva SettingsPanel, que es quien puede
 * cumplir la regla de que solo haya una desplegada. Aquí solo se pinta lo que
 * le digan.
 *
 * El cuerpo sigue en el DOM al plegarse —como en MonthCard, y por el mismo
 * motivo: un campo a medio escribir no debe perderse porque se mire otra
 * sección—, e `inert` lo saca del tabulado y del lector mientras no se vea.
 */
export default function Fold({ title, open, onToggle, children }: Props) {
  const bodyId = useId();

  return (
    <section
      data-open={open || undefined}
      className="overflow-hidden rounded-xl border border-edge bg-surface"
    >
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-ink-soft transition-colors hover:bg-edge/60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none"
        >
          <span className="flex-1">{title}</span>
          <ChevronIcon />
        </button>
      </h3>

      <div id={bodyId} className="fold-body" inert={!open}>
        {/* Sin clases: es el ítem de la rejilla plegable y un relleno suyo no
            se encoge a 0fr. El aire va dentro. */}
        <div>
          <div className="px-4 pt-1 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** El mismo chevron de los meses; global.css lo gira según `data-open`. */
function ChevronIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="fold-chevron shrink-0 text-ink-muted"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
