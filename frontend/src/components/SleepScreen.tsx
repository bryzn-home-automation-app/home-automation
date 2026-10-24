import { useEffect, useState } from 'react';
import { FOCUS_RING } from './ThermostatControls';

/** The app at rest: a dim clock over everything, until someone taps or presses a key. */
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
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/90 px-6 text-center text-white"
      onClick={onWake}
    >
      <p className="text-6xl font-light tabular-nums tracking-tight sm:text-7xl">
        {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </p>
      <p className="text-sm text-white/60">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <p className="mt-6 max-w-xs text-xs text-white/50">
        {testing ? 'Sleep test: asleep after 30 seconds with no activity. Waking returns to the usual 10 minutes.' : 'Asleep after 10 minutes with no activity.'}{' '}
        Cameras and live data are paused.
      </p>
      <button
        type="button"
        autoFocus
        onClick={onWake}
        className={`mt-2 h-11 rounded-xl bg-white/10 px-5 text-sm font-semibold text-white hover:bg-white/20 ${FOCUS_RING}`}
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
 * The last stretch before sleep: a card in the middle of a blurred page, with a ring
 * that drains as the seconds run out. Any movement cancels it (useAppSleep). It stays
 * mounted for a moment while it fades out, still catching taps, so the tap that
 * dismissed it can't fall through to a button on the page behind.
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
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md transition-opacity duration-300 motion-reduce:transition-none ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onStay}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sleep-warning-title"
        aria-describedby="sleep-warning-body"
        className={`w-full max-w-sm rounded-[28px] border border-appborder bg-appsurface-raised p-6 text-center shadow-[0_24px_60px_rgba(0,0,0,0.35)] transition-transform duration-300 motion-reduce:transition-none ${
          shown ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className="relative mx-auto h-24 w-24">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r={RING_R} fill="none" strokeWidth="6" className="stroke-appinset" />
            <circle
              cx="50"
              cy="50"
              r={RING_R}
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - fraction)}
              className="stroke-appaccent transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums text-apptext">
            {left}
          </span>
        </div>
        <h2 id="sleep-warning-title" className="mt-4 text-lg font-semibold text-apptext">
          Still there?
        </h2>
        <p id="sleep-warning-body" className="mt-1 text-sm text-apptext-muted" aria-live="polite">
          The app goes to sleep in {left} second{left === 1 ? '' : 's'} and the cameras pause. Move the mouse or tap to
          keep going.
        </p>
        <button
          type="button"
          onClick={onStay}
          className={`mt-5 h-11 w-full rounded-xl bg-appaccent text-sm font-semibold text-appaccent-fg transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          I'm here
        </button>
      </div>
    </div>
  );
}
