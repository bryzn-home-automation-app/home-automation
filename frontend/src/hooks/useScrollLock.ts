import { useEffect } from 'react';

/**
 * While `locked`, the page itself can't be scrolled by touch or wheel, so a swipe on an
 * overlay (the phone menu, its backdrop) doesn't move the page underneath. Scrolling
 * from code (scrollTo) still works, and the page keeps its position.
 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [locked]);
}

export default useScrollLock;
