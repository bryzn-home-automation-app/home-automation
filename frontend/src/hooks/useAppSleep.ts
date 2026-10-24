import { useCallback, useEffect, useRef, useState } from 'react';

/** Visible but untouched for this long → the app goes to sleep (cameras and polling stop). */
export const SLEEP_AFTER_MS = 10 * 60_000;
/** For this last stretch before sleeping, a "Still there?" countdown shows. */
export const SLEEP_WARNING_MS = 60_000;

/** Anything that shows someone's there, while awake (the countdown included). */
const PRESENCE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/**
 * What wakes a sleeping app here: a key, not a nudged mouse or a passing scroll. A tap
 * wakes it through the sleep screen's own click instead. Waking on pointerdown would
 * drop the screen mid-tap, and the click would land on whatever was underneath.
 */
const WAKE_EVENTS = new Set<string>(['keydown']);

export interface AppSleep {
  asleep: boolean;
  /** Seconds until sleep while the countdown shows, else null. */
  secondsLeft: number | null;
  wake: () => void;
}

/**
 * Whether anyone is still using the app. The page counts down only while it's visible.
 * A hidden tab or locked phone already stops live video and polling, and coming back to
 * the app counts as being there, so it wakes (or never sleeps). What it catches is an
 * app left open on screen: a desktop tab, a tablet on the counter. After
 * {@link SLEEP_AFTER_MS} of no input there, it sleeps, so the cameras aren't streaming
 * to nobody.
 */
export function useAppSleep(enabled: boolean): AppSleep {
  const [asleep, setAsleep] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastActive = useRef(Date.now());
  const asleepRef = useRef(false);

  const wake = useCallback(() => {
    lastActive.current = Date.now();
    asleepRef.current = false;
    setAsleep(false);
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      wake();
      return;
    }
    wake();
    const onInput = (e: Event) => {
      if (asleepRef.current && !WAKE_EVENTS.has(e.type)) return;
      if (asleepRef.current) {
        wake();
        return;
      }
      lastActive.current = Date.now();
      setSecondsLeft((s) => (s === null ? s : null));
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') wake();
    };
    const tick = () => {
      if (asleepRef.current || document.visibilityState === 'hidden') return;
      const idleFor = Date.now() - lastActive.current;
      if (idleFor >= SLEEP_AFTER_MS) {
        asleepRef.current = true;
        setAsleep(true);
        setSecondsLeft(null);
      } else if (idleFor >= SLEEP_AFTER_MS - SLEEP_WARNING_MS) {
        setSecondsLeft(Math.ceil((SLEEP_AFTER_MS - idleFor) / 1000));
      }
    };
    PRESENCE_EVENTS.forEach((e) => window.addEventListener(e, onInput, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      PRESENCE_EVENTS.forEach((e) => window.removeEventListener(e, onInput, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [enabled, wake]);

  return { asleep, secondsLeft, wake };
}
