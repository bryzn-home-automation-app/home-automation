import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { checkDeviceLink, startDeviceLink, type LinkStart, type LinkStatus } from '../api/presence';
import { errorMessage } from '../api/climate';
import { Button, ButtonRow, Disclosure, ExternalButton, Notice, Panel, Stack } from './ui';

// A short confirmation loop while a link is waiting (minutes at most), not a page poll.
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
    <Panel title="This device" subtitle="Link the phone you're holding, so the house knows you're home while it's on the Wi-Fi. Connect it to the home Wi-Fi first.">
      <Stack gap="m">
        {link ? (
          <>
            <div>
              <ExternalButton href={link.url} variant="primary" icon="phone" iconEnd={undefined}>Tap to confirm this device</ExternalButton>
            </div>
            <p role="status" className="fp-small fp-muted">
              That opens a page from the home server. Once it says “Device found”, come back here. Waiting…
            </p>
            <ButtonRow>
              <Button variant="quiet" onClick={() => setLink(null)}>Cancel</Button>
            </ButtonRow>
          </>
        ) : (
          <div>
            <Button icon="phone" onClick={start} busy={busy} busyLabel="Starting…">
              {status?.status === 'LINKED' ? 'Link again' : 'Link this device'}
            </Button>
          </div>
        )}

        {status?.status === 'LINKED' && (
          <Notice tone="ok" live="polite">
            Linked: {status.name ?? 'this device'}
            {status.type ? ` (${TYPE_LABEL[status.type] ?? status.type.toLowerCase()})` : ''}.
            {status.type === 'MOBILE' || status.type === 'WATCH'
              ? ' You’ll show as home while it’s on the Wi-Fi.'
              : ' Only phones and watches count toward being home.'}
          </Notice>
        )}
        {status?.status === 'EXPIRED' && (
          <Notice tone="headsup" live="polite">That link timed out. Try again.</Notice>
        )}
        {error && <Notice tone="problem" live="assertive">{error}</Notice>}
      </Stack>
      <Disclosure variant="row" summary="How the house knows you're home" openSummary="Hide the details" className="mt-3">
        <p className="fp-small fp-muted">
          The home server keeps an eye on the Wi-Fi for linked phones and watches. While yours is connected you
          show as home; a computer or tablet can be linked, but doesn't count. Linking only works from the home Wi-Fi,
          because that is how the server sees which device you're holding.
        </p>
      </Disclosure>
    </Panel>
  );
}
