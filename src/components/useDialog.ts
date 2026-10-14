import { useEffect, type RefObject } from 'react';

/** Lo que Tab puede visitar dentro del panel; los `tabindex="-1"` se saltan. */
const FOCUSABLE =
  'button:not([disabled]), textarea, input:not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Comportamiento común de los modales: Escape cierra, Tab queda atrapado
 * dentro del panel y el fondo deja de hacer scroll mientras está abierto.
 * El foco inicial lo decide cada modal: no todos quieren empezar en la X.
 */
export function useDialog(panelRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panelRef, onClose]);

  useEffect(lockScroll, []);
}

/* ------------------------------------------------------------------ *
 * El bloqueo del scroll
 * ------------------------------------------------------------------ */

/**
 * Cuántos modales lo tienen bloqueado ahora mismo, y qué había antes.
 *
 * Viven en el módulo y no en cada `useDialog` porque el bloqueo es **del
 * documento**, que es uno solo: dos modales a la vez no pueden tener cada uno
 * su propia idea de cómo dejarlo.
 */
let locks = 0;
let previousOverflow = '';

/**
 * Bloquea el scroll del fondo y devuelve cómo soltarlo.
 *
 * **Cuenta en vez de guardar y restaurar**, y esa diferencia es un error
 * corregido, no una preferencia. Guardando el valor anterior, dos modales
 * anidados se pisan: el de dentro guarda el `hidden` que acaba de poner el de
 * fuera, y al desmontarse los dos a la vez lo repone. El fondo se queda sin
 * scroll hasta recargar.
 *
 * Y no bastaba con desmontarlos en otro orden, porque el orden no se elige:
 * React recorre el subárbol que borra **de padre a hijo**, así que la limpieza
 * del de dentro es siempre la última en hablar. Pasó al borrar una serie desde
 * el modal del día, que es el primer sitio del proyecto con un modal dentro de
 * otro.
 *
 * Con un contador da igual el orden: el último en soltar es el que repone, sea
 * quien sea.
 */
function lockScroll(): () => void {
  if (locks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks++;

  /* Soltar dos veces restaría dos veces y dejaría la cuenta en negativo, y con
     ella el siguiente modal sin poder bloquear nada. Lo haría el modo estricto
     de React en desarrollo, que monta, desmonta y vuelve a montar. */
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) document.body.style.overflow = previousOverflow;
  };
}
