import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { sendTestPush } from '../api/push';
import { errorMessage } from '../api/climate';
import { currentEnv, disablePush, enablePush, isSubscribed, pushSupport, type PushEnv } from '../utils/push';
import { Button, Disclosure, List, Notice, Panel, Stack, Switch } from './ui';

/** The HTTPS address (Tailscale cert) — push needs a secure origin. */
export const SECURE_APP_URL = 'https://nuc.tailf10ac4.ts.net';

/** Whether this device is subscribed; Profile's verdict reads the same query. */
export const PUSH_SUBSCRIBED_KEY = ['push-subscribed'];

/** Is this device subscribed? (only asked where push can work at all). */
export function usePushSubscribed(enabled: boolean) {
  return useQuery({ queryKey: PUSH_SUBSCRIBED_KEY, queryFn: isSubscribed, enabled, staleTime: Infinity, retry: false });
}

/**
 * "Phone alerts" on the Profile page: turn Web Push on/off for this device and send a
 * test. Members only — guests never get camera alerts. Walks through whatever is in
 * the way first (wrong address, not the Home Screen app, notifications blocked).
 */
export default function PushSettings() {
  const { isGuest } = useAuth();
  // Held in state, not read once: after "Don't Allow" the permission changes under us, and
  // the card has to switch to the "notifications are blocked" steps it points at (B-162).
  const [env, setEnv] = useState<PushEnv>(currentEnv);
  const support = pushSupport(env);
  const queryClient = useQueryClient();
  const subscribed = usePushSubscribed(!isGuest && support === 'ok');
  const on = support === 'ok' ? (subscribed.isError ? false : subscribed.data ?? null) : false;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (isGuest) return null;

  const setOn = (value: boolean) => queryClient.setQueryData(PUSH_SUBSCRIBED_KEY, value);

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const permission = await enablePush(); // first await: iOS needs the prompt tied to this tap
      if (permission === 'granted') {
        setOn(true);
        setNote('Alerts are on for this device.');
      } else {
        setNote(permission === 'denied' ? null : 'No change. Permission wasn’t granted.');
      }
    } catch (err) {
      setNote(errorMessage(err, 'Couldn’t turn on alerts'));
    } finally {
      setEnv(currentEnv());
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
      setNote(n > 0 ? `Test alert sent to ${n} device${n === 1 ? '' : 's'}. It should arrive in a few seconds.` : 'No device accepted the test. Try turning alerts off and on again.');
    } catch (err) {
      setNote(errorMessage(err, 'Couldn’t send a test'));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (support === 'insecure') {
    body = (
      <Notice tone="headsup" title="Phone alerts need the secure address.">
        With Tailscale on, open{' '}
        <a className="font-semibold underline" href={SECURE_APP_URL}>
          {SECURE_APP_URL.replace('https://', '')}
        </a>
        {env.ios ? ', add it to your Home Screen, and turn alerts on from there.' : ' and turn alerts on from there.'}
      </Notice>
    );
  } else if (support === 'install') {
    body = (
      <Notice tone="info" title="Alerts work from the Home Screen app.">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Tap the Share button, then <span className="font-semibold">Add to Home Screen</span>.</li>
          <li>Open <span className="font-semibold">HomeOS</span> from the new icon.</li>
          <li>Come back to Profile and turn alerts on.</li>
        </ol>
      </Notice>
    );
  } else if (support === 'denied') {
    body = (
      <Notice tone="headsup" title="Notifications are blocked for HomeOS.">
        Allow them in {env.ios ? 'Settings → Notifications → HomeOS' : "your browser's site settings"}, then come back here.
      </Notice>
    );
  } else if (support === 'unsupported') {
    body = <Notice tone="neutral">This browser can't receive alerts. On iPhone, use the Home Screen app (iOS 16.4 or later).</Notice>;
  } else {
    body = (
      <Stack gap="m">
        <List inset>
          <li>
            <Switch
              checked={!!on}
              onChange={(next) => (next ? turnOn() : turnOff())}
              disabled={on === null}
              busy={busy}
              label="Alerts on this device"
              help={on === null ? 'Checking…' : on ? 'On. Alerts reach this device even when the app is closed.' : 'Off. Turn it on to get alerts here.'}
            />
          </li>
        </List>
        {on && (
          <div>
            <Button icon="bell" onClick={test} busy={busy} busyLabel="Sending…">Send a test alert</Button>
          </div>
        )}
      </Stack>
    );
  }

  return (
    <Panel
      title="Phone alerts"
      subtitle="Alerts on this device, even when the app is closed. Pick which ones under Alert types: by default, camera alerts and Roomba errors."
    >
      <Stack gap="m">
        {body}
        {note && <p role="status" className="fp-small fp-muted">{note}</p>}
      </Stack>
      {support === 'ok' && (
        <Disclosure variant="row" summary="Not getting alerts?" openSummary="Hide the help" className="mt-3">
          <ul className="fp-small fp-muted list-disc space-y-1 pl-5">
            <li>Send a test alert. If it doesn't arrive, turn alerts off and on again here.</li>
            <li>Check Alert types: a kind of alert reaches your phone only when its Phone switch is on.</li>
            <li>On iPhone, alerts come to the Home Screen app, and Focus modes can hold them back.</li>
          </ul>
        </Disclosure>
      )}
    </Panel>
  );
}
