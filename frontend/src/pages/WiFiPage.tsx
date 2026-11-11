import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  Button,
  Dialog,
  Disclosure,
  Icon,
  IconButton,
  InstrumentPanel,
  KeyValue,
  KV,
  List,
  Num,
  Panel,
  Row,
  Screen,
  Stack,
  Verdict,
  cx,
} from '../components/ui';
import { QR_COLOURS, copyText, wifiPayload } from './wifi/wifiCode';

/*
 * Guest Wi-Fi: hand your phone to a guest. The instrument is the join code on a white label
 * plate (dark on white in both themes, B-156) with the network name stamped under it; tap it
 * for the big version. Beside it, the two facts a guest needs, then the three steps.
 */

// What copying says for a moment. Failure is said honestly (B-155): the clipboard doesn't exist
// on the plain-http LAN address.
type CopyNote = { ok: boolean; text: string } | null;
const COPY_FAILED = 'Couldn’t copy here. Press and hold the password to copy it.';

export default function WiFiPage() {
  const [qrSmall, setQrSmall] = useState('');
  const [qrLarge, setQrLarge] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [note, setNote] = useState<CopyNote>(null);
  const noteTimer = useRef<number | undefined>(undefined);

  // Read network credentials from build-time env so the real password never
  // lives in source control. Set VITE_WIFI_SSID / VITE_WIFI_PASSWORD (see .env.example).
  const ssid: string = import.meta.env.VITE_WIFI_SSID ?? '';
  const password: string = import.meta.env.VITE_WIFI_PASSWORD ?? '';
  const payload = useMemo(() => wifiPayload(ssid, password), [ssid, password]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    // Quiet zone of 4 modules, as the spec asks; the plate's white carries on around it.
    QRCode.toDataURL(payload, { width: 320, margin: 4, color: QR_COLOURS })
      .then((url) => { if (!cancelled) setQrSmall(url); })
      .catch(() => { /* the plate keeps its placeholder */ });
    QRCode.toDataURL(payload, { width: 800, margin: 4, color: QR_COLOURS })
      .then((url) => { if (!cancelled) setQrLarge(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [payload]);

  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const copy = async (text: string, done: string) => {
    const ok = await copyText(text);
    setNote({ ok, text: ok ? done : COPY_FAILED });
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), ok ? 2000 : 5000);
  };
  const copyBoth = () =>
    copy([ssid && `Network: ${ssid}`, password && `Password: ${password}`].filter(Boolean).join('\n'), 'Network name and password copied');
  const copyPassword = () => copy(password, 'Password copied');

  const shownPassword = hidden ? '•'.repeat(Math.max(password.length, 8)) : password;

  return (
    <Screen>
      <InstrumentPanel
        instrument={
          <>
            <WifiPlate
              qr={qrSmall}
              ssid={ssid}
              hint="Scan with the Camera app"
              onOpen={ssid ? () => setQrOpen(true) : undefined}
            />
            {ssid && (
              <p className="fp-small fp-muted inline-flex items-center gap-1.5">
                <Icon name="maximize" />
                Tap the code to show it bigger
              </p>
            )}
          </>
        }
        verdict={
          ssid ? (
            <Verdict tone="ok" note="No typing: the code carries the password.">
              Guests can scan the code to join.
            </Verdict>
          ) : (
            <Verdict tone="headsup" note="The network name and password are set when the app is built (VITE_WIFI_SSID and VITE_WIFI_PASSWORD).">
              The guest Wi-Fi isn’t set up in the app yet.
            </Verdict>
          )
        }
        readouts={
          <Stack gap="s">
            <CredentialWell label="Network" value={ssid || 'Not set up'} note="WPA2, password protected" />
            <CredentialWell
              label="Password"
              value={password ? shownPassword : 'Not set up'}
              note={password ? (hidden ? 'Hidden. Tap the eye to show it' : 'Type it exactly as shown') : undefined}
              keys={
                password ? (
                  <>
                    <IconButton
                      icon={hidden ? 'eye' : 'eye-off'}
                      label={hidden ? 'Show password' : 'Hide password'}
                      variant="quiet"
                      small
                      onClick={() => setHidden((h) => !h)}
                    />
                    <IconButton icon="copy" label="Copy password" variant="quiet" small onClick={copyPassword} />
                  </>
                ) : undefined
              }
            />
          </Stack>
        }
      >
        <Stack gap="s">
          <Button variant="primary" size="lg" block icon="maximize" disabled={!ssid} onClick={() => setQrOpen(true)}>
            Show the code full screen
          </Button>
          <Button block icon="copy" disabled={!ssid && !password} onClick={copyBoth}>
            Copy name and password
          </Button>
        </Stack>
      </InstrumentPanel>

      <Panel title="How to join" subtitle="Works on any iPhone or Android phone" footer={
        <span className="fp-small fp-muted">On a laptop or a TV? Pick {ssid || 'the network'} and type the password.</span>
      }>
        <List aria-label="Steps">
          <Row lead={<Step n={1} />} title="Open the Camera app" meta="Not a browser or another app’s scanner. The code scanner in Control Center works too." />
          <Row lead={<Step n={2} />} title="Point it at the code" meta="Hold still until a “Join network” banner appears." />
          <Row lead={<Step n={3} />} title="Tap Join" meta="The password fills in by itself. That’s it." />
        </List>
      </Panel>

      {payload && (
        <Panel flush aria-label="How the code works">
          <Disclosure variant="row" summary="For the curious: what’s in the code" openSummary="What’s in the code">
            <Stack gap="s">
              <p className="fp-small fp-muted">A standard Wi-Fi join code, made on this device. Nothing is sent anywhere.</p>
              <p className="fp-mono rounded-well bg-appinset px-3 py-2.5 [overflow-wrap:anywhere]">{payload}</p>
              <KeyValue cols>
                <KV label="Security" value="WPA2-Personal" />
                <KV label="Set in" value="The app’s build settings" />
              </KeyValue>
            </Stack>
          </Disclosure>
        </Panel>
      )}

      <Dialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        eyebrow="Guest Wi-Fi"
        title="Scan to join"
        subtitle="Hand your phone over, or hold it up to theirs"
        fullOnPhone
        wellBody
        footer={
          <>
            {password && <Button variant="quiet" icon="copy" onClick={copyPassword}>Copy password</Button>}
            <Button variant="primary" onClick={() => setQrOpen(false)}>Done</Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4 py-2">
          <WifiPlate big qr={qrLarge} ssid={ssid} hint="Point the Camera app here" />
          {password && (
            <div className="w-full max-w-[400px]">
              <KeyValue>
                <KV label="Or type the password" value={password} mono />
              </KeyValue>
            </div>
          )}
          <p className="fp-small fp-muted fp-t-center">Won’t scan? Turn the screen brightness up.</p>
        </div>
      </Dialog>

      {note && (
        <div className="fp-toast" role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </div>
      )}
    </Screen>
  );
}

/**
 * The label plate: white enamel with four screw heads, the code, a rule, the network name. A
 * button when it opens the big version (a real button: keyboard, Enter and Space; B-043).
 */
function WifiPlate({ qr, ssid, hint, big, onOpen }: { qr: string; ssid: string; hint: string; big?: boolean; onOpen?: () => void }) {
  const screws = (
    <span aria-hidden="true">
      {['left-2 top-2', 'right-2 top-2', 'left-2 bottom-2', 'right-2 bottom-2'].map((pos) => (
        <span key={pos} className={cx('absolute h-[5px] w-[5px] rounded-full bg-[var(--appplate-edge)]', pos)} />
      ))}
    </span>
  );
  const body = (
    <>
      {screws}
      <span className="flex w-full items-center justify-between px-1 text-[var(--appplate-soft)]">
        <PlateLabel>Guest Wi-Fi</PlateLabel>
        <Icon name="wifi" />
      </span>
      {qr ? (
        <img src={qr} alt="" className="block aspect-square w-full" draggable={false} />
      ) : (
        <span className="grid aspect-square w-full place-items-center px-4 text-center text-[13px] text-[var(--appplate-soft)]">
          {ssid ? 'Making the code…' : 'No code yet: the network isn’t set up'}
        </span>
      )}
      <span className={cx('w-full border-t border-[var(--appplate-edge)] pt-2.5 font-mono font-medium tracking-[.02em] [overflow-wrap:anywhere]', big ? 'text-[19px]' : 'text-[15.5px]')}>
        {ssid || 'Not set up'}
      </span>
      <PlateLabel>{hint}</PlateLabel>
    </>
  );
  const cls = cx(
    'relative m-0 flex flex-col items-center gap-2 rounded-[10px] border border-[var(--appplate-edge)] bg-appplate text-center text-appplate-ink',
    big ? 'w-[min(100%,400px)] px-6 pb-5 pt-[18px]' : 'w-[min(100%,268px)] px-[18px] pb-4 pt-3.5 lg:w-[296px]',
  );
  if (onOpen) {
    return (
      <button type="button" className={cx(cls, 'cursor-zoom-in active:translate-y-px')} onClick={onOpen} aria-label={`Wi-Fi code for ${ssid}. Show it full screen`}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} role="img" aria-label={ssid ? `Wi-Fi code for ${ssid}` : 'No Wi-Fi code yet'}>
      {body}
    </div>
  );
}

/** The silk-screen lettering on the plate, in the plate's own ink (it is white in both themes). */
function PlateLabel({ children }: { children: string }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase leading-tight tracking-[.1em] text-[var(--appplate-soft)] [font-stretch:var(--appstretch-label)]">
      {children}
    </span>
  );
}

/** A readout well holding text to type (mono), with optional small keys on the right. */
function CredentialWell({ label, value, note, keys }: { label: string; value: string; note?: string; keys?: ReactNode }) {
  return (
    <div className={cx('fp-readout', keys != null && 'pr-[96px]')}>
      <span className="fp-label">{label}</span>
      <span className="fp-readout-value">
        <span className="font-mono text-[15px] font-medium leading-snug text-apptext [overflow-wrap:anywhere] lg:text-lg">{value}</span>
      </span>
      {note && <span className="fp-readout-note">{note}</span>}
      {keys != null && <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">{keys}</span>}
    </div>
  );
}

/** A step number in the row's lead well. */
function Step({ n }: { n: number }) {
  return (
    <span className="fp-row-lead">
      <Num size="s" value={n} />
    </span>
  );
}
