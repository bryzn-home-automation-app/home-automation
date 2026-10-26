import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { checkDeviceLink, startDeviceLink, type LinkStart, type LinkStatus } from '../api/presence';
import { errorMessage } from '../api/climate';
import { FOCUS_RING } from './ThermostatControls';

const BUTTON = `inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${FOCUS_RING}`;
const POLL_MS = 2_000;

const TYPE_LABEL: Record<string, string> = {
  MOBILE: 'mobile', COMPUTER: 'computer', TABLET: 'tablet', WATCH: 'watch', TV: 'TV', SMART_HOME: 'smart home device', OTHER: 'device',
};

/**
 * "This device" on Profile: link the phone (or computer) in your hand to your account,
 * so Who's home knows whose it is. Step 1 starts a link; step 2 opens a page served by
 * the NUC over the home Wi-Fi, which is how the NUC tells which device this is (Docker
 * hides it from the app). Members only.
 */
export default function LinkDeviceCard() {
  const { isGuest } = useAuth();
  const [link, setLink] = useState<LinkStart | null>(null);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wait for the device to open the NUC's page, then for the backend to finish the link.
  useEffect(() => {
    if (!link) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const s = await checkDeviceLink(link.token);
        if (stopped) return;
        if (s.status !== 'PENDING') {
          setStatus(s);
          setLink(null);
        }
      } catch (err) {
        if (stopped) return;
        setError(errorMessage(err, 'Couldn’t finish linking'));
        setLink(null);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [link]);

  if (isGuest) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setLink(await startDeviceLink());
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t start linking'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Who's home</p>
      <h3 className="mt-2 text-xl font-semibold text-apptext">This device</h3>
      <p className="mt-1 mb-4 text-xs text-apptext-muted">
        Link the phone you're holding to your account, so the house knows you're home while it's on the Wi-Fi. Connect
        it to the home Wi-Fi first.
      </p>

      {link ? (
        <div className="flex flex-col gap-2">
          <a href={link.url} target="_blank" rel="noopener noreferrer"
            className={`${BUTTON} self-start border border-appaccent-border bg-appaccent-soft text-appaccent-text`}>
            Tap to confirm this device
          </a>
          <p role="status" className="text-xs text-apptext-soft">
            That opens a page from the NUC. Once it says “Device found”, come back here. Waiting…
          </p>
          <button type="button" onClick={() => setLink(null)}
            className={`${BUTTON} self-start border border-appborder bg-appinset text-apptext-soft hover:bg-appinset-strong`}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={start} disabled={busy}
          className={`${BUTTON} border border-appaccent-border bg-appaccent-soft text-appaccent-text`}>
          {busy ? 'Starting…' : status?.status === 'LINKED' ? 'Link again' : 'Link this device'}
        </button>
      )}

      {status?.status === 'LINKED' && (
        <p role="status" className="mt-3 text-sm text-apptext-success">
          Linked: {status.name ?? 'this device'}
          {status.type ? ` (${TYPE_LABEL[status.type] ?? status.type.toLowerCase()})` : ''}.
          {status.type === 'MOBILE' || status.type === 'WATCH'
            ? ' You’ll show as home while it’s on the Wi-Fi.'
            : ' Only phones and watches count toward being home.'}
        </p>
      )}
      {status?.status === 'EXPIRED' && (
        <p role="status" className="mt-3 text-xs text-apptext-warning">That link timed out. Try again.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-apptext-danger">
          {error}
        </p>
      )}
    </div>
  );
}
