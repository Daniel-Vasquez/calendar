import { signOut } from '../auth-client';

export type NavUser = { name: string; email: string };

type Props = {
  /** Página que se está viendo: marca el enlace activo. */
  current: 'calendar' | 'gallery';
  /** Quién ha entrado. Lo resuelve el servidor y baja como prop. */
  user: NavUser;
  /**
   * Engrane de ajustes. Solo el calendario lo ofrece: el modal necesita los
   * datos y sus manejadores, que viven en CalendarDashboard. En la galería
   * la barra se queda sin acciones.
   */
  settings?: {
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    onOpen: () => void;
  };
};

const LINKS = [
  { id: 'calendar', href: '/', label: 'Calendario' },
  { id: 'gallery', href: '/galeria', label: 'Galería' },
] as const;

/**
 * Barra delgada fijada arriba. Se dibuja fuera de `<main>` para cruzar la
 * pantalla entera; el contenido se alinea con el mismo ancho que la página.
 * Va bajo los modales (z-50) y sobre el resto, y no se imprime.
 */
export default function NavBar({ current, user, settings }: Props) {
  return (
    <nav
      aria-label="Principal"
      className="print-hidden sticky top-0 z-40 border-b border-edge/80 bg-canvas/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <a
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg font-semibold tracking-tight text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <img src="/calendar.svg" alt="" width="24" height="24" className="h-6 w-6" />
          {/* En móvil el icono basta como marca: el hueco es para los enlaces. */}
          <span className="hidden text-sm sm:inline">Planificador 2026</span>
          <span className="sr-only sm:hidden">Planificador 2026</span>
        </a>

        <ul className="flex flex-1 items-center gap-1">
          {LINKS.map((link) => {
            const active = link.id === current;
            return (
              <li key={link.id}>
                <a
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'block rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ' +
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ' +
                    (active ? 'bg-edge text-ink' : 'text-ink-soft hover:bg-edge/60 hover:text-ink')
                  }
                >
                  {link.label}
                </a>
              </li>
            );
          })}
        </ul>

        {/* El nombre no cabe en móvil, donde la barra ya va justa de sitio;
            el botón de salir sí, porque es la única vía para cambiar de
            cuenta. El correo va en el `title` para distinguir dos cuentas
            con el mismo nombre. */}
        <span
          title={user.email}
          className="hidden max-w-40 truncate text-sm font-medium text-ink-soft sm:inline"
        >
          {user.name}
        </span>

        {settings && (
          <button
            ref={settings.buttonRef}
            type="button"
            onClick={settings.onOpen}
            aria-haspopup="dialog"
            aria-expanded={settings.open}
            aria-label="Categorías y datos"
            title="Categorías y datos"
            className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <GearIcon />
          </button>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          aria-label={`Cerrar la sesión de ${user.name}`}
          title="Cerrar sesión"
          className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <SignOutIcon />
        </button>
      </div>
    </nav>
  );
}

/**
 * Cierra la sesión y recarga contra el servidor. Una navegación completa —y no
 * un cambio de ruta en el cliente— es lo que hace que el middleware vea que ya
 * no hay cookie y devuelva la pantalla de acceso.
 */
async function handleSignOut() {
  await signOut();
  window.location.href = '/login';
}

/** Engrane de ajustes, trazado a mano como el resto de iconos del proyecto. */
function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Puerta con una flecha saliendo: cerrar sesión. */
function SignOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
