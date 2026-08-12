import { useEffect, type RefObject } from 'react';

/**
 * Focusable element selectors used to find the first/last tabbable items in a panel.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
}

/**
 * useFocusTrap
 *
 * While `open` is true:
 *  - moves focus to the first focusable element inside `panelRef`
 *  - traps Tab / Shift+Tab within the panel
 *  - closes on Escape (calls `onEscape`)
 *
 * When `open` flips to false:
 *  - returns focus to `returnFocusRef.current` (e.g. the element that triggered the panel)
 *
 * @param open           Whether the panel is currently open.
 * @param panelRef       Ref to the panel container.
 * @param returnFocusRef Ref to the element that should receive focus when the panel closes.
 * @param onEscape       Optional callback invoked when the user presses Escape.
 */
export function useFocusTrap(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  returnFocusRef?: RefObject<HTMLElement | null>,
  onEscape?: () => void,
): void {
  // On open: move focus into the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = getFocusableElements(panel);
    if (focusables.length > 0) {
      // Defer to allow layout / slide-in animation to finish.
      const id = window.setTimeout(() => focusables[0].focus(), 0);
      return () => window.clearTimeout(id);
    }
    return;
  }, [open, panelRef]);

  // While open: trap Tab and handle Escape.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (onEscape) {
          onEscape();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const focusables = getFocusableElements(panel);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, panelRef, onEscape]);

  // On close: return focus to the trigger.
  useEffect(() => {
    if (open) return;
    const trigger = returnFocusRef?.current;
    if (trigger && typeof trigger.focus === 'function') {
      // Defer so layout has settled.
      const id = window.setTimeout(() => trigger.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return;
  }, [open, returnFocusRef]);
}

export default useFocusTrap;
