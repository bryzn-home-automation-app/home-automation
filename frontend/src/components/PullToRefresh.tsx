import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** How far (px, after resistance) to pull before letting go refreshes. */
export const PULL_THRESHOLD = 64;
const MAX_PULL = 110;
/** How long the "Updated" check stays up. */
const DONE_MS = 900;

/** Finger travel → indicator travel: 1:2 at first, firming up toward MAX_PULL. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(MAX_PULL, dy * 0.5 * (1 - Math.min(dy, 400) / 1200));
}

/** The touch is inside something scrolled down on its own (a list, the menu), or a dialog. */
function insideScrolled(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.closest('[role="dialog"], [data-no-pull]')) return true;
    if (el.scrollTop > 0) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }
  }
  return false;
}

type Phase = 'idle' | 'pulling' | 'refreshing' | 'done';

/**
 * Pull-to-refresh for phones: at the top of a page, drag down and let go to refetch
 * everything on screen. A round chip follows the finger (its arrow turns once far
 * enough), spins while the data reloads, then shows a check. The Home Screen app has
 * no browser refresh of its own, so this is the way to force fresh data there.
 */
export default function PullToRefresh() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    let decided = false; // vertical drag confirmed (vs. a sideways swipe)
    let current = 0;

    const onStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing' || e.touches.length !== 1) return;
      if (window.scrollY > 0 || insideScrolled(e.target)) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      decided = false;
      current = 0;
    };

    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          start.current = null; // scrolling down the page or swiping sideways
          return;
        }
        decided = true;
      }
      // Keep the page still (no iOS bounce) while the chip follows the finger.
      if (e.cancelable) e.preventDefault();
      current = pullDistance(dy);
      setPull(current);
      setPhase('pulling');
    };

    const onEnd = async () => {
      if (!start.current) return;
      start.current = null;
      if (!decided) return;
      if (current < PULL_THRESHOLD) {
        setPull(0);
        setPhase('idle');
        return;
      }
      setPull(PULL_THRESHOLD);
      setPhase('refreshing');
      try {
        await queryClient.refetchQueries({ type: 'active' });
      } finally {
        setPhase('done');
        setTimeout(() => {
          setPhase('idle');
          setPull(0);
        }, DONE_MS);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [queryClient]);

  const ready = pull >= PULL_THRESHOLD;
  const visible = phase !== 'idle';
  // Ease back only after the finger lifts; follow it 1:1 while pulling.
  const transition = phase === 'pulling' ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out';

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 top-0 z-[60] -ml-5"
        style={{
          transform: `translateY(calc(env(safe-area-inset-top, 0px) + ${pull - 44}px))`,
          opacity: visible ? Math.min(1, pull / 32) : 0,
          transition,
        }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-appaccent-border bg-appsurface-raised text-appaccent-text shadow-[0_8px_24px_var(--appshadow-lg)]">
          {phase === 'done' ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : phase === 'refreshing' ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 3a9 9 0 1 1-9 9" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: `rotate(${ready ? 180 : (pull / PULL_THRESHOLD) * 180}deg)`, transition: 'transform 120ms ease-out' }}
            >
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          )}
        </div>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {phase === 'refreshing' ? 'Refreshing' : phase === 'done' ? 'Updated' : ''}
      </span>
    </>
  );
}
