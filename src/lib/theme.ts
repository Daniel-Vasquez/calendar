/**
 * Claro u oscuro, y cómo se recuerda.
 *
 * **La fuente de verdad es la clase de `<html>`**, no una variable de React ni
 * lo que haya en `localStorage`. La pone un script que corre en el `<head>`
 * antes de que exista el `<body>` —ver `Layout.astro`—, y eso es lo que evita
 * el destello blanco al recargar: cuando el navegador pinta el primer píxel, el
 * tema ya está decidido. Cualquier componente que quiera saberlo lo pregunta al
 * DOM; así tampoco hay nada que pueda discrepar entre el servidor y el cliente.
 */

/** Clave de `localStorage`. Fuera del espacio de nombres del calendario: no es
 *  contenido, es una preferencia del aparato, y no se exporta ni se importa. */
export const THEME_KEY = 'theme';

/** La clase que enciende el tema oscuro. La misma que espera `@custom-variant`. */
export const DARK_CLASS = 'dark';

/** Clase efímera que abre la transición del cambio. Ver `global.css`. */
export const SWITCHING_CLASS = 'theme-switching';

/** Cuánto dura el fundido. Tiene que cuadrar con la regla de `global.css`. */
export const SWITCH_MS = 220;

export type Theme = 'light' | 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** Lo que eligió esta persona, o `null` si nunca lo ha tocado. */
export function storedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    // Almacenamiento bloqueado: se sigue con lo que diga el sistema.
    return null;
  }
}

/** Lo que pide el sistema operativo. Sin `matchMedia`, claro. */
export function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** El que está puesto ahora mismo, leído de donde manda: el DOM. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light';
}

/**
 * Pinta el tema. `remember` distingue las dos formas de llegar aquí: pulsar el
 * botón elige y se recuerda; seguir al sistema operativo cuando nunca se ha
 * elegido, no — guardarlo ahí congelaría la preferencia a la primera vez que el
 * sistema cambiara de humor, y ya no volvería a seguirlo.
 */
export function applyTheme(theme: Theme, remember: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.classList.toggle(DARK_CLASS, theme === 'dark');

  if (remember) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Sin espacio o sin permiso: el tema vale para esta página y se olvida. */
    }
  }
}

/**
 * Como `applyTheme`, pero con el fundido de doscientos milisegundos.
 *
 * La clase se quita con un temporizador en vez de esperar a `transitionend`:
 * ese evento llega una vez por propiedad y por elemento —miles en esta página—
 * y con `prefers-reduced-motion` no llega ninguno, que es justo cuando dejaría
 * la clase puesta para siempre.
 */
export function switchTheme(theme: Theme, remember: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.classList.add(SWITCHING_CLASS);
  applyTheme(theme, remember);
  window.setTimeout(() => root.classList.remove(SWITCHING_CLASS), SWITCH_MS + 30);
}
