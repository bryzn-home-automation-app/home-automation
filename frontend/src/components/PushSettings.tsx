import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { sendTestPush } from '../api/push';
import { errorMessage } from '../api/climate';
import { currentEnv, disablePush, enablePush, isSubscribed, pushSupport } from '../utils/push';
import { FOCUS_RING } from './ThermostatControls';

/** The HTTPS address (Tailscale cert) — push needs a secure origin. */
export const SECURE_APP_URL = 'https://nuc.tailf10ac4.ts.net';

const BUTTON = `h-11 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${FOCUS_RING}`;

/**
 * "Phone alerts" on the Profile page: turn Web Push on/off for this device and send a
 * test. Members only — guests never get camera alerts. Walks through whatever is in
 * the way first (wrong address, not the Home Screen app, notifications blocked).
 */
export default function PushSettings() {
  const { isGuest } = useAuth();
  const env = useMemo(currentEnv, []);
  const support = pushSupport(env);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (support !== 'ok') return;
    isSubscribed().then(setOn).catch(() => setOn(false));
  }, [support]);

  if (isGuest) return null;

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const permission = await enablePush(); // first await: iOS needs the prompt tied to this tap
      if (permission === 'granted') {
        setOn(true);
        setNote('Alerts are on for this device.');
      } else {
        setNote(permission === 'denied' ? 'Notifications are blocked — see the steps above.' : 'No change — permission wasn’t granted.');
      }
    } catch (err) {
      setNote(errorMessage(err, 'Couldn’t turn on alerts'));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setNote(null);
    try {
      await disablePush();
      setOn(false);
      setNote('Alerts are off for this device.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNote(null);
    try {
      const n = await sendTestPush();
      setNote(n > 0 ? `Test alert sent to ${n} device${n === 1 ? '' : 's'} — it should arrive in a few seconds.` : 'No device accepted the test. Try turning alerts off and on again.');
    } catch (err) {
      setNote(errorMessage(err, 'Couldn’t send a test'));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (support === 'insecure') {
    body = (
      <p className="text-sm text-apptext-soft">
        Phone alerts need the secure address. With Tailscale on, open{' '}
        <a className="font-semibold text-appaccent-text underline" href={SECURE_APP_URL}>
          {SECURE_APP_URL.replace('https://', '')}
        </a>
        {env.ios ? ', add it to your Home Screen, and turn alerts on from there.' : ' and turn alerts on from there.'}
      </p>
    );
  } else if (support === 'install') {
    body = (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-apptext-soft">
        <li>Tap the Share button, then <span className="font-semibold">Add to Home Screen</span>.</li>
        <li>Open <span className="font-semibold">HomeOS</span> from the new icon.</li>
        <li>Come back to Profile and turn alerts on.</li>
      </ol>
    );
  } else if (support === 'denied') {
    body = (
      <p className="text-sm text-apptext-soft">
        Notifications are blocked for HomeOS. Allow them in{' '}
        {env.ios ? 'Settings → Notifications → HomeOS' : "your browser's site settings"}, then come back here.
      </p>
    );
  } else if (support === 'unsupported') {
    body = <p className="text-sm text-apptext-soft">This browser can't receive alerts. On iPhone, use the Home Screen app (iOS 16.4 or later).</p>;
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <>
            <button type="button" onClick={test} disabled={busy} className={`${BUTTON} border border-appaccent-border bg-appaccent-soft text-appaccent-text`}>
              Send a test alert
            </button>
            <button type="button" onClick={turnOff} disabled={busy} className={`${BUTTON} border border-appborder bg-appinset text-apptext-soft hover:bg-appinset-strong`}>
              Turn off on this device
            </button>
          </>
        ) : (
          <button type="button" onClick={turnOn} disabled={busy || on === null} className={`${BUTTON} border border-appaccent-border bg-appaccent-soft text-appaccent-text`}>
            {busy ? 'Turning on…' : 'Turn on alerts on this device'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Notifications</p>
      <h3 className="mt-2 text-xl font-semibold text-apptext">Phone alerts</h3>
      <p className="mt-1 mb-4 text-xs text-apptext-muted">
        Camera alerts (people outside, low or no-charge batteries, cameras offline) and anything critical, even
        when the app is closed. Everything else stays in Alerts.
      </p>
      {body}
      {note && (
        <p role="status" className="mt-3 text-xs text-apptext-soft">
          {note}
        </p>
      )}
    </div>
  );
}
