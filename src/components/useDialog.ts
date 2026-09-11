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

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}
