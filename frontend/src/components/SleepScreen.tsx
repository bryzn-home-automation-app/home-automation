import { useEffect, useState } from 'react';

/**
 * The app at rest: a dim clock over everything, until someone taps or presses a key.
 * Always the dark "media" surface, in either theme (it is a night-light, not a page),
 * and fully opaque: the old 90% black let the page's header and footer show through
 * behind the date (B-054). z-90: above every overlay (kit dialogs 70, the "Still there?"
 * countdown 75, the skip link and toasts 80), so nothing left open can cover it.
 */
export function SleepScreen({ onWake, testing = false }: { onWake: () => void; testing?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App is asleep"
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-appmedia-bg px-6 text-center text-appmedia-ink"
      onClick={onWake}
    >
      <p className="fp-num text-[clamp(4rem,18vw,7rem)] font-normal" style={{ color: 'var(--appmedia-ink)' }}>
        {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </p>
      <p className="fp-label" style={{ color: 'var(--appmedia-ink-soft)' }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      <p className="mt-6 max-w-xs text-xs leading-5" style={{ color: 'var(--appmedia-ink-soft)' }}>
        {testing ? 'Sleep test: asleep after 30 seconds with no activity. Waking returns to the usual 10 minutes.' : 'Asleep after 10 minutes with no activity.'}{' '}
        Cameras and live data are paused.
      </p>
      <button
        type="button"
        autoFocus
        onClick={onWake}
        className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-key border px-5 text-sm font-semibold focus-visible:[outline-color:var(--appmedia-ink)]"
        style={{ borderColor: 'var(--appmedia-ink-soft)', color: 'var(--appmedia-ink)' }}
      >
        Tap to wake
      </button>
    </div>
  );
}

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;
/** How long the warning lingers, fading, after it's dismissed. */
const FADE_MS = 300;

/**
 * What a screen reader hears of the countdown. The paragraph that shows the seconds
 * is read once, when the dialog appears; a live region on it was re-read every
 * second (B-055). This one changes only at 30 and 10 seconds.
 */
function spokenMilestone(left: number): string {
  if (left <= 10) return 'Ten seconds left.';
  if (left <= 30) return 'Thirty seconds left.';
  return '';
}

/**
 * The last stretch before sleep: a panel over the dimmed page, with a ring that
 * drains as the seconds run out. Any movement cancels it (useAppSleep). It stays
 * mounted for a moment while it fades out, still catching taps, so the tap that
 * dismissed it can't fall through to a button on the page behind. No backdrop blur
 * (blurring the whole page every frame of the fade stuttered on phones). z-75: over any
 * dialog left open (70), under the sleep screen (90).
 */
export function SleepWarning({
  secondsLeft,
  totalSeconds,
  onStay,
}: {
  /** null when there's no countdown. */
  secondsLeft: number | null;
  totalSeconds: number;
  onStay: () => void;
}) {
  const open = secondsLeft !== null;
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [lastSeconds, setLastSeconds] = useState(secondsLeft ?? totalSeconds);
  if (secondsLeft !== null && secondsLeft !== lastSeconds) setLastSeconds(secondsLeft);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  const left = Math.max(0, lastSeconds);
  const fraction = totalSeconds > 0 ? left / totalSeconds : 0;

  return (
    <div
      className={`fixed inset-0 z-[75] flex items-center justify-center bg-appscrim p-4 transition-opacity duration-300 motion-reduce:transition-none ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onStay}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sleep-warning-title"
        aria-describedby="sleep-warning-body"
        className={`fp-panel w-full max-w-sm p-6 text-center transition-transform duration-300 motion-reduce:transition-none ${
          shown ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className="relative mx-auto h-24 w-24">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r={RING_R} fill="none" strokeWidth="6" style={{ stroke: 'var(--appdial-track)' }} />
            <circle
              cx="50"
              cy="50"
              r={RING_R}
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - fraction)}
              style={{ stroke: 'var(--apptext)' }}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
            />
          </svg>
          <span className="fp-num fp-num--m absolute inset-0 flex items-center justify-center text-[1.75rem]">{left}</span>
        </div>
        <h2 id="sleep-warning-title" className="mt-4 text-section font-semibold text-apptext">
          Still there?
        </h2>
        <p id="sleep-warning-body" className="mt-1 text-sm text-apptext-muted">
          The app goes to sleep in {left} second{left === 1 ? '' : 's'} and the cameras pause. Move the mouse or tap to
          keep going.
        </p>
        <span role="status" className="fp-sr-only">
          {spokenMilestone(left)}
        </span>
        <button type="button" onClick={onStay} className="fp-btn fp-btn--primary fp-btn--block mt-5">
          I'm here
        </button>
      </div>
    </div>
  );
}
