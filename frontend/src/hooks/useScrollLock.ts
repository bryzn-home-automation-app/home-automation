import { useEffect } from 'react';

/**
 * While `locked`, the page behind an overlay (the phone menu, a dialog) can't be scrolled
 * by touch or wheel; the overlay's own scroll areas still scroll. Scrolling from code
 * (scrollTo) still works, and the page keeps its position. Locks can overlap (a dialog
 * over the menu): the page is free again once the last one lets go.
 *
 * A touch screen blocks the swipe instead of hiding overflow: in Safari 26 hiding
 * <html>'s overflow doesn't keep the page still (WebKit bug 299084). A screen without
 * touch hides the overflow of the window and of the app's page box, which also stops
 * arrow-key and space-bar scrolling.
 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    if (holders++ === 0) release = engage();
    return () => {
      if (--holders === 0) {
        release?.();
        release = null;
      }
    };
  }, [locked]);
}

let holders = 0;
let release: (() => void) | null = null;

function engage(): () => void {
  if (!(navigator.maxTouchPoints > 0)) {
    // The window, and the app's own page box while the page scrolls in it (narrow screens).
    const boxes = [document.documentElement, ...document.querySelectorAll<HTMLElement>('[data-page-scroller]')]
      .filter((el) => el === document.documentElement || getComputedStyle(el).overflowY === 'auto');
    const previous = boxes.map((el) => el.style.overflow);
    boxes.forEach((el) => (el.style.overflow = 'hidden'));
    return () => boxes.forEach((el, i) => (el.style.overflow = previous[i]));
  }

  let startX = 0;
  let startY = 0;
  const onStart = (e: TouchEvent) => {
    startX = e.touches[0]?.clientX ?? 0;
    startY = e.touches[0]?.clientY ?? 0;
  };
  const onMove = (e: TouchEvent) => {
    // A pinch, or a scroll iOS has already started (its moves can't be cancelled).
    if (!e.cancelable || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // The page never scrolls sideways, so a sideways swipe is left to carousels and the back gesture.
    if (Math.abs(dy) <= Math.abs(dx)) return;
    if (!handledInside(e.target, dy > 0)) e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // pinch-zoom, or sideways
    if (!handledInside(e.target, e.deltaY < 0)) e.preventDefault();
  };
  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('wheel', onWheel);
  };
}

/**
 * Something between the gesture and the page takes it: a text box or slider, or a scroll
 * area (the menu, a dialog's body) with room left that way. `towardTop`: the gesture
 * scrolls up, toward the start. The search stops at the overlay itself (it's fixed), so
 * the page's own scroll box, which the overlay may sit inside, never counts.
 */
function handledInside(target: EventTarget | null, towardTop: boolean): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, textarea, select, video, audio, [contenteditable="true"]')) return true;
    const style = getComputedStyle(el);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
      if (towardTop ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    }
    if (style.position === 'fixed') break;
  }
  return false;
}

export default useScrollLock;
