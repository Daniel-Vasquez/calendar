export type SyncState = 'starting' | 'saving' | 'synced' | 'offline';

type Props = {
  state: SyncState;
  /** Cambios que aún no han llegado al servidor. */
  pending: number;
  onRetry: () => void;
};

const SHELL = 'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium';

/**
 * Estado de la sincronía, junto a los contadores de la cabecera.
 *
 * Está siempre a la vista porque el calendario guarda al instante en el
 * navegador y sube después: sin este aviso no habría forma de distinguir
 * "guardado en tu cuenta" de "guardado solo aquí", que es justo lo que
 * importa saber antes de cerrar el portátil.
 */
export default function SyncBadge({ state, pending, onRetry }: Props) {
  if (state === 'offline') {
    return (
      <div
        role="status"
        className={`${SHELL} border-highlight/30 bg-highlight-soft text-highlight`}
      >
        <WarnIcon />
        <span>
          {pending === 1 ? '1 cambio sin subir' : `${pending} cambios sin subir`}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-highlight/15 px-2 py-0.5 font-semibold transition-colors hover:bg-highlight/25 focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const busy = state === 'saving' || state === 'starting';

  return (
    <div role="status" className={`${SHELL} border-edge bg-surface text-ink-muted`}>
      {busy ? <SpinnerIcon /> : <CheckIcon />}
      <span>{state === 'starting' ? 'Sincronizando…' : busy ? 'Guardando…' : 'Al día'}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5l3.2 3.2L13 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5l6 11H2l6-11z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6.8v2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
    </svg>
  );
}

/* El giro se detiene con `prefers-reduced-motion`: la clase de Tailwind ya
   lo contempla, y sin animación el icono sigue diciendo "en marcha". */
function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="motion-safe:animate-spin"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.75" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
