import { useCallback, useEffect, useRef, useState } from 'react';

/** True while the tab is in the foreground (false when hidden, minimized, or the phone is locked). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * `idle` turns true after `idleMs` without pointer, key, scroll or touch input
 * on the page; any input (or `wake()`) clears it. Input is sampled, not timed
 * per event, so mouse moves cost nothing.
 */
export function useIdle(idleMs: number): { idle: boolean; wake: () => void } {
  const [idle, setIdle] = useState(false);
  const lastActive = useRef(Date.now());

  const wake = useCallback(() => {
    lastActive.current = Date.now();
    setIdle(false);
  }, []);

  useEffect(() => {
    const mark = () => {
      lastActive.current = Date.now();
      setIdle((was) => (was ? false : was));
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActive.current >= idleMs) setIdle(true);
    }, Math.min(10_000, idleMs));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
      window.clearInterval(timer);
    };
  }, [idleMs]);

  return { idle, wake };
}
