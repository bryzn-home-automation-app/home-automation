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

/** The last minute before sleep: a quiet countdown above the phone nav. Any movement cancels it. */
export function SleepWarning({ secondsLeft, onStay }: { secondsLeft: number; onStay: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6"
    >
      <div className="flex max-w-md items-center gap-3 rounded-2xl border border-appborder bg-appsurface-raised px-4 py-3 shadow-[0_10px_28px_var(--appshadow)]">
        <p className="text-xs text-apptext">
          Still there? Going to sleep in <span className="font-semibold tabular-nums">{secondsLeft} s</span>; cameras will
          pause.
        </p>
        <button
          type="button"
          onClick={onStay}
          className={`h-9 shrink-0 rounded-lg border border-appaccent-border bg-appaccent-soft px-3 text-xs font-semibold text-apptext ${FOCUS_RING}`}
        >
          I'm here
        </button>
      </div>
    </div>
  );
}
