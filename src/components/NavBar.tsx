import { signOut } from '../auth-client';
import { BellIcon } from './ReminderChip';
import ThemeToggle from './ThemeToggle';

export type NavUser = { name: string; email: string };

type Props = {
  /** Página que se está viendo: marca el enlace activo. */
  current: 'calendar' | 'agenda' | 'reminders' | 'gallery';
  /** Quién ha entrado. Lo resuelve el servidor y baja como prop. */
  user: NavUser;
  /**
   * Engrane de ajustes. Solo el calendario lo ofrece: el modal necesita los
   * datos y sus manejadores, que viven en CalendarDashboard. En las demás
   * páginas la barra se queda sin acciones.
   */
  settings?: {
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    onOpen: () => void;
  };
};

/**
 * Los enlaces de la barra. **El calendario no está**: su sitio lo ocupa la
 * marca, que lleva a la portada, y repetirlo al lado gastaba el ancho que en un
 * teléfono hace falta para todo lo demás.
 *
 * Los dos que quedan van igual: icono solo en un teléfono, icono y rótulo a
 * partir de `sm`. `showLabel` está por si algún día entra uno cuyo dibujo se
 * explique solo y no necesite texto ni habiendo sitio.
 *
 * Ocultar el rótulo **no** le quita el nombre: va en `aria-label`, que es lo
 * único que sigue estando cuando el texto desaparece de la pantalla.
 */
const LINKS = [
  {
    id: 'agenda',
    href: '/agenda',
    label: 'Agenda',
    Icon: NotebookIcon,
    showLabel: true,
  },
  {
    id: 'reminders',
    href: '/recordatorios',
    label: 'Recordatorios',
    Icon: () => <BellIcon size={17} />,
    showLabel: true,
  },
  {
    id: 'gallery',
    href: '/galeria',
    label: 'Galería',
    Icon: ImageIcon,
    showLabel: true,
  },
] as const;

const ICON_BUTTON =
  'shrink-0 rounded-lg p-2 text-ink-soft transition-colors hover:bg-edge hover:text-ink ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';

/**
 * Barra delgada fijada arriba. Se dibuja fuera de `<main>` para cruzar la
 * pantalla entera; el contenido se alinea con el mismo ancho que la página.
 * Va bajo los modales (z-50) y sobre el resto, y no se imprime.
 *
 * En un teléfono todo lo que puede ser un icono lo es: con seis elementos de
 * texto la barra se amontonaba y acababa solapándose. Los rótulos vuelven a
 * partir de `sm`, donde sí hay sitio.
 */
export default function NavBar({ current, user, settings }: Props) {
  return (
    <nav
      aria-label="Principal"
      className="print-hidden sticky top-0 z-40 border-b border-edge/80 bg-canvas/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-2 sm:gap-4 sm:px-6">
        {/* La marca es el enlace a la portada, y por eso lleva `aria-current`
            cuando se está en ella: es el único elemento que la representa. */}
        <a
          href="/"
          aria-label="Planificador 2026 · Ir al calendario"
          title="Planificador 2026"
          aria-current={current === 'calendar' ? 'page' : undefined}
          className="flex shrink-0 items-center rounded-lg p-1.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <img src="/calendar.svg" alt="" width="24" height="24" className="h-6 w-6" />
        </a>

        <ul className="flex flex-1 items-center gap-0.5 sm:gap-1">
          {LINKS.map(({ id, href, label, Icon, showLabel }) => {
            const active = id === current;
            return (
              <li key={id}>
                <a
                  href={href}
                  aria-label={label}
                  title={label}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'flex items-center gap-2 rounded-lg p-2 text-sm font-medium transition-colors ' +
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ' +
                    (showLabel ? 'sm:px-3 sm:py-1.5 ' : '') +
                    (active ? 'bg-edge text-ink' : 'text-ink-soft hover:bg-edge/60 hover:text-ink')
                  }
                >
                  <Icon />
                  {showLabel && <span className="hidden sm:inline">{label}</span>}
                </a>
              </li>
            );
          })}
        </ul>

        {/* Quién ha entrado. El nombre no cabe en un teléfono, así que ahí lo
            representa la silueta y el nombre se queda para quien lea la página
            con un lector; el correo va en el `title` para distinguir dos
            cuentas que se llamen igual. No es un botón: no hace nada. */}
        <span
          title={`${user.name} · ${user.email}`}
          className="flex min-w-0 shrink-0 items-center gap-2 p-2 text-sm font-medium text-ink-soft"
        >
          <UserIcon />
          <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
          <span className="sr-only sm:hidden">{user.name}</span>
        </span>

        <ThemeToggle />

        {settings && (
          <button
            ref={settings.buttonRef}
            type="button"
            onClick={settings.onOpen}
            aria-haspopup="dialog"
            aria-expanded={settings.open}
            aria-label="Categorías y datos"
            title="Categorías y datos"
            className={ICON_BUTTON}
          >
            <GearIcon />
          </button>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          aria-label={`Cerrar la sesión de ${user.name}`}
          title="Cerrar sesión"
          className={ICON_BUTTON}
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

/** Libreta con renglones y su canto: la agenda del año. */
function NotebookIcon() {
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
      <path d="M6.5 3h11a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 17.5 21h-11" />
      <path d="M6.5 3A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21" />
      <path d="M8.5 8.5h7M8.5 12.5h7M8.5 16.5h4" />
    </svg>
  );
}

/** Marco con un paisaje dentro: la galería. El mismo dibujo que su estado vacío. */
function ImageIcon() {
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
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 16l4.5-4.5a2 2 0 0 1 2.8 0L14 15l1.8-1.8a2 2 0 0 1 2.8 0L21 15" />
      <circle cx="15.5" cy="9" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Silueta de persona: quién ha entrado. */
function UserIcon() {
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
      className="shrink-0"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
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
