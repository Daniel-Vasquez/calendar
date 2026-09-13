import { useEffect } from 'react';
import { currentTheme, storedTheme, switchTheme, systemTheme, THEME_KEY } from '../lib/theme';

/**
 * Sol y luna: el interruptor de tema.
 *
 * **No tiene estado de React, y es deliberado.** Qué icono se ve lo decide la
 * variante `dark:` sobre la clase de `<html>`, es decir, CSS puro; y al pulsar,
 * el tema siguiente se deduce leyendo esa misma clase. Con estado habría dos
 * copias de la verdad y un primer render que el servidor no puede acertar —no
 * sabe qué tiene guardado este navegador—, así que el icono correcto
 * aparecería un instante después del equivocado. Sin estado no hay nada que
 * sincronizar: el HTML que llega ya es el bueno.
 */
export default function ThemeToggle() {
  // Si nunca se ha elegido, se sigue al sistema operativo también en caliente:
  // quien tenga el portátil en oscurecerse al anochecer verá cambiar la página
  // sin recargarla. En cuanto hay elección guardada, el sistema deja de mandar.
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    function onSystemChange() {
      if (storedTheme() === null) switchTheme(systemTheme(), false);
    }

    query.addEventListener('change', onSystemChange);
    return () => query.removeEventListener('change', onSystemChange);
  }, []);

  // Y con lo que se elija en otra pestaña, como el resto de la aplicación.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== THEME_KEY) return;
      const saved = storedTheme();
      switchTheme(saved ?? systemTheme(), false);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <button
      type="button"
      onClick={() => switchTheme(currentTheme() === 'dark' ? 'light' : 'dark', true)}
      title="Cambiar entre modo claro y oscuro"
      className="shrink-0 rounded-lg p-2 text-ink-soft transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      {/* El rótulo no dice a cuál se cambia: eso dependería del tema actual, que
          en el servidor no se conoce. «Cambiar entre» vale en los dos sentidos
          y se lee igual de bien. */}
      <span className="sr-only">Cambiar entre modo claro y oscuro</span>

      {/* Los dos iconos ocupan la misma casilla y se cruzan girando: el que se
          va sale hacia un lado mientras el que llega entra desde el otro. */}
      <span className="relative block h-[18px] w-[18px]">
        <SunIcon />
        <MoonIcon />
      </span>
    </button>
  );
}

/** Lo común a los dos iconos: misma casilla, mismo giro, mismo desvanecido. */
const ICON =
  'absolute inset-0 transition-all duration-300 ease-out motion-reduce:transition-none';

/** Sol: el modo claro, el que está puesto mientras no haya clase `dark`. */
function SunIcon() {
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
      className={`${ICON} rotate-0 scale-100 opacity-100 dark:-rotate-90 dark:scale-50 dark:opacity-0`}
    >
      <circle cx="12" cy="12" r="4.25" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </svg>
  );
}

/** Luna: el modo oscuro. Espera girada y encogida hasta que le toca. */
function MoonIcon() {
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
      className={`${ICON} rotate-90 scale-50 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100`}
    >
      <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4z" />
    </svg>
  );
}
