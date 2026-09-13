export type SyncState = 'starting' | 'saving' | 'synced' | 'offline';

type Props = {
  state: SyncState;
  /** Cambios que aún no han llegado al servidor. */
  pending: number;
  onRetry: () => void;
};

const SHELL =
  'flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium sm:py-2.5';

/**
 * El rótulo de «sin subir», y **solo** ese.
 *
 * El estado normal dice su palabra en todas las pantallas: «Al día» cabe de
 * sobra y un visto suelto no se entiende. Aquí no cabe: en un teléfono este
 * distintivo ocupa media fila de la cabecera del calendario —unos 160 px— y ahí
 * ya van el icono, el número y el botón de reintentar, que es lo que de verdad
 * hace falta. La frase entera desbordaría la celda.
 *
 * Se va con `sr-only` y no con `display:none` porque **no debe desaparecer**:
 * eso lo mantiene en el árbol de accesibilidad y este `role="status"` sigue
 * teniendo qué anunciar justo donde menos sitio hay para enterarse de otro modo.
 */
const PENDING_LABEL = 'sr-only sm:not-sr-only';

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
        {/* El número sí se ve siempre: es lo que hay en juego. */}
        <span className="tabular-nums">{pending}</span>
        <span className={PENDING_LABEL}>
          {pending === 1 ? 'cambio sin subir' : 'cambios sin subir'}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg bg-highlight/15 px-2 py-0.5 font-semibold transition-colors hover:bg-highlight/25 focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
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
      {/* Sin la palabra, en un teléfono esto era un visto sin explicación. */}
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
