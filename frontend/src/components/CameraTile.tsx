import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchCameraSnapshot, goToCameraPreset, nudgeCamera, reportLiveDiagnostics, startCameraLive, type PanTiltDirection } from '../api/cameras';
import { errorMessage } from '../api/climate';
import { HlsPlayer, MsePlayer, liveSupported, preferHls, type LivePlayer } from '../utils/msePlayer';
import {
  BATTERY_LIVE_BUDGET_MS,
  autoLive,
  batteryLampTone,
  chargeLabel,
  isRecent,
  isSolar,
  latestEvent,
  shouldStream,
  type ChargeState,
} from '../utils/cameras';
import { formatRelative, formatStamp } from '../utils/format';
import { Button, Icon, IconButton, Lamp, cx, type IconName } from './ui';
import type { Camera } from '../types';

/** "2 min ago", "just now", "Mon, Nov 9": formatRelative to sit after a word. */
export function agoText(at: string | null | undefined): string {
  const r = formatRelative(at);
  return /^[A-Z][a-z]{2}, /.test(r) ? r : r.charAt(0).toLowerCase() + r.slice(1);
}

/**
 * The power line under a tile: "Battery 87% · Solar charging" with a lamp on the camera
 * alerts' thresholds, or "Wired power". The sun only shows for a solar charge (B-109).
 */
export function BatteryBadge({ camera, state, inferred }: { camera: Camera; state: ChargeState; inferred: boolean }) {
  if (camera.powerSource === 'wired') {
    return (
      <span className="fp-cluster min-w-0 text-small text-apptext-muted">
        <Icon name="plug" />
        <span>Wired power</span>
      </span>
    );
  }
  if (camera.batteryPercent == null) return null;
  const label = chargeLabel(camera, state, inferred);
  const charging = state === 'charging';
  const icon: IconName | null = charging ? (isSolar(camera.chargingStatus) ? 'sun' : 'battery-charging') : null;
  return (
    <span className="fp-cluster min-w-0 text-small">
      <Lamp tone={batteryLampTone(camera.batteryPercent, charging && !inferred)} size="s" />
      <span>
        Battery <span className="tabular-nums">{Math.round(camera.batteryPercent)}%</span>
        {label && (
          <span className="text-apptext-muted">
            {' · '}
            {icon && <Icon name={icon} className="mr-1 align-[-2px]" />}
            {label}
          </span>
        )}
      </span>
    </span>
  );
}

/** The latest still, as an object URL that's revoked when replaced. */
function useSnapshotUrl(camera: Camera) {
  // A new motion/person event changes the key → a fresh still.
  const eventKey = camera.lastPersonAt ?? camera.lastMotionAt ?? '';
  const query = useQuery({
    queryKey: ['camera-snapshot', camera.id, eventKey],
    queryFn: () => fetchCameraSnapshot(camera.id),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const url = useMemo(() => (query.data ? URL.createObjectURL(query.data) : null), [query.data]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return { url, query };
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/**
 * Full screen for the tile's picture, so the pan/tilt pad and Stop come along.
 * iPhone Safari can only take a bare <video> full screen, so it falls back to that.
 */
export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement != null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref]);
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else if (typeof el.requestFullscreen === 'function' && document.fullscreenEnabled !== false) {
      void el.requestFullscreen().catch(() => {});
    } else {
      (el.querySelector('video') as FullscreenVideo | null)?.webkitEnterFullscreen?.();
    }
  };
  return { active, toggle };
}

type LiveStatus = 'connecting' | 'playing';

/** Mounted only while the tile should stream; unmounting stops the camera. */
function LiveVideo({
  cameraId,
  onStatus,
  onError,
  onEnded,
  onBlocked,
}: {
  cameraId: string;
  onStatus: (s: LiveStatus) => void;
  onError: (message: string) => void;
  onEnded: () => void;
  onBlocked: (blocked: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Latest callbacks without restarting the stream when the parent re-renders.
  const cb = useRef({ onStatus, onError, onEnded, onBlocked });
  cb.current = { onStatus, onError, onEnded, onBlocked };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let playing = false;
    let reported = false;
    let wasBlocked = false;
    const hls = preferHls();
    const Player = hls ? HlsPlayer : MsePlayer;
    const report = (extra: Record<string, unknown> = {}) => {
      reported = true;
      void reportLiveDiagnostics(cameraId, { ...player.diagnostics(), playing, ...extra, userAgent: navigator.userAgent });
    };
    const player: LivePlayer = new Player(video, {
      onPlaying: () => {
        playing = true;
        cb.current.onStatus('playing');
        // A start the browser refused gets a second report once it's going, saying how.
        if (reported && wasBlocked) report({ event: 'recovered' });
      },
      onError: (m) => cb.current.onError(m),
      onEnded: () => cb.current.onEnded(),
      onBlocked: (b) => {
        wasBlocked ||= b;
        cb.current.onBlocked(b);
      },
    });
    cb.current.onStatus('connecting');
    startCameraLive(cameraId, hls ? 'hls' : 'mse')
      .then(({ url }) => {
        if (!cancelled) player.start(url);
      })
      .catch((err) => {
        if (!cancelled) cb.current.onError(errorMessage(err, "Couldn't start live view"));
      });
    // One report per live session, so a black tile on some phone shows up in the
    // backend log with the codec, bytes received and the video element's state.
    const timer = setTimeout(() => {
      if (!cancelled) report();
    }, 8_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      player.stop();
      cb.current.onBlocked(false);
    };
  }, [cameraId]);

  return <video ref={videoRef} muted playsInline autoPlay className="fp-media-feed" />;
}

interface CameraTileProps {
  camera: Camera;
  pageVisible: boolean;
  idle: boolean;
  /** Clears page-level idle (any tap on a tile counts as activity anyway). */
  onWake: () => void;
  charge: { state: ChargeState; inferred: boolean };
}

function CameraTile({ camera, pageVisible, idle, onWake, charge }: CameraTileProps) {
  const battery = camera.powerSource === 'battery';
  const [requested, setRequested] = useState(false);
  const [budgetHit, setBudgetHit] = useState(false);
  // Stop was tapped (B-022): auto-live alone would keep the picture going, so this holds it off
  // until Play, or the next visit.
  const [paused, setPaused] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  // The phone won't start the picture until someone taps (see Autoplay in msePlayer).
  const [blocked, setBlocked] = useState(false);
  // Bumping the session remounts LiveVideo (a fresh ticket + socket).
  const [session, setSession] = useState(0);
  const [reconnects, setReconnects] = useState(0);
  const supported = useMemo(liveSupported, []);

  const streaming =
    supported &&
    shouldStream({ camera, requested, pageVisible, idle, failed: liveError != null || budgetHit || paused });

  // Leaving the tab ends the visit: coming back starts live again rather than
  // on the "Still watching?" prompt a battery camera left behind, a Stop, or an
  // earlier "keeps dropping" (B-112: each visit gets one fresh attempt).
  useEffect(() => {
    if (!pageVisible || idle) setRequested(false);
    if (!pageVisible) {
      setBudgetHit(false);
      setPaused(false);
      setLiveError(null);
      setReconnects(0);
    }
  }, [pageVisible, idle]);

  useEffect(() => {
    if (!streaming) setStatus(null);
  }, [streaming]);

  // A stream that got going earns back its reconnect allowance.
  useEffect(() => {
    if (status === 'playing') setReconnects(0);
  }, [status]);

  // Battery cameras: stop at the budget and ask.
  useEffect(() => {
    if (!streaming || !battery) return;
    const t = window.setTimeout(() => {
      setBudgetHit(true);
      setRequested(false);
    }, BATTERY_LIVE_BUDGET_MS);
    return () => window.clearTimeout(t);
  }, [streaming, battery, session]);

  const { url: snapshotUrl, query: snapshotQuery } = useSnapshotUrl(camera);
  const pictureRef = useRef<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(pictureRef);

  const start = () => {
    onWake();
    setLiveError(null);
    setBudgetHit(false);
    setPaused(false);
    setReconnects(0);
    setRequested(true);
    setSession((s) => s + 1);
  };
  const stop = () => {
    setRequested(false);
    setBudgetHit(false);
    setPaused(true);
  };
  // A tap is the one thing Safari never refuses, so start the video right inside it.
  // (Any tap on the page does it too, for every tile: see Autoplay.)
  const playFromTap = () => {
    onWake();
    void pictureRef.current?.querySelector('video')?.play().catch(() => {});
  };

  // The stream ended under us. For a battery camera that's usually the bridge's own
  // budget recycling a stream the app primed before this tab opened (CameraPrimer),
  // so reconnect rather than ask. Our budget above still decides when to ask.
  const onEnded = () => {
    if (reconnects < 3) {
      // The picture is frozen from here on: drop LIVE and the live keys now (B-111),
      // not when the new session reports in two seconds later.
      setStatus('connecting');
      setReconnects((n) => n + 1);
      window.setTimeout(() => setSession((s) => s + 1), 2_000);
    } else {
      setLiveError('Live view keeps dropping');
    }
  };

  const event = latestEvent(camera);
  const recent = event != null && isRecent(event.at);
  const live = streaming && status === 'playing';
  // The still stays underneath until the first frame, so connecting never flashes black.
  const showSnapshot = !live;

  let overlay: ReactNode = null;
  if (!camera.available) {
    overlay = null; // the offline plate on the picture says it
  } else if (!camera.liveAvailable) {
    overlay = null;
  } else if (!supported) {
    overlay = <OverlayNote>Live view needs a newer browser (iOS 17.1+)</OverlayNote>;
  } else if (liveError) {
    overlay = (
      <OverlayAction label="Try again" onClick={start}>
        {liveError}
      </OverlayAction>
    );
  } else if (budgetHit) {
    overlay = (
      <OverlayAction label="Keep watching" onClick={start}>
        Still watching? Live view paused to save battery.
      </OverlayAction>
    );
  } else if (idle && autoLive(camera)) {
    overlay = (
      <OverlayAction label="Resume" onClick={start}>
        Paused — nobody was watching
      </OverlayAction>
    );
  } else if (!streaming && battery) {
    overlay = <PlayButton onClick={start} name={camera.name} />;
  } else if (streaming && status !== 'playing' && blocked) {
    overlay = (
      <OverlayAction label="Play" onClick={playFromTap}>
        Your phone wants a tap to start live view
      </OverlayAction>
    );
  } else if (streaming && status !== 'playing') {
    overlay = <OverlayNote>{battery ? 'Waking camera…' : 'Connecting…'}</OverlayNote>;
  }

  const fullKey = (
    <IconButton
      icon="maximize"
      variant="quiet"
      label={fullscreen.active ? `Exit full screen for ${camera.name}` : `Full screen ${camera.name}`}
      onClick={fullscreen.toggle}
    />
  );
  const stopKey = (
    <Button size="sm" variant="quiet" icon="stop" onClick={stop}>
      Stop
    </Button>
  );
  // With pan/tilt keys on the picture, the corner plates would sit under them.
  const plates = !(live && camera.canPanTilt);

  return (
    <figure className="fp-media">
      <div
        ref={pictureRef}
        className={cx(
          'fp-media-frame [&:fullscreen_img]:object-contain [&:fullscreen_video]:object-contain',
          !camera.available && 'fp-is-offline',
        )}
      >
        {snapshotUrl && showSnapshot && (
          <img src={snapshotUrl} alt={`Latest snapshot from ${camera.name}`} className="fp-media-feed" />
        )}
        {!snapshotUrl && snapshotQuery.isLoading && <span className="fp-skel absolute inset-0 -z-10 rounded-none" aria-hidden="true" />}
        {streaming && (
          <LiveVideo
            key={session}
            cameraId={camera.id}
            onStatus={setStatus}
            onError={(m) => setLiveError(m)}
            onEnded={onEnded}
            onBlocked={setBlocked}
          />
        )}
        <span className="fp-media-vf" aria-hidden="true" />
        {camera.available && plates && (live || snapshotUrl) && (
          <span className={cx('fp-media-tag', !live && 'fp-media-tag--off')}>
            <span className="fp-media-rec" aria-hidden="true" />
            {live ? 'Live' : paused ? 'Paused' : 'Still'}
          </span>
        )}
        {!camera.available && (
          <span className="fp-media-offline" role="status">
            <Icon name="zap-off" />
            <span>
              Camera offline
              {camera.lastSeenAt ? ` since ${formatStamp(camera.lastSeenAt)}` : ''}
            </span>
          </span>
        )}
        {!snapshotUrl && snapshotQuery.isError && !live && camera.available && (
          // Corner, not centre: the play key and the prompts own the middle.
          <span className="fp-media-time">No still yet</span>
        )}
        {plates && <span className="fp-media-name">{camera.name}</span>}
        {event && plates && (
          // Fresh activity (under 2 minutes) is the one inverted plate on the picture.
          <span className={cx('fp-media-note', recent && 'bg-appmedia-ink text-appmedia-bg')}>
            {event.kind === 'person' ? 'Person' : 'Motion'} · {agoText(event.at)}
          </span>
        )}
        {overlay && <div className="absolute inset-0 grid place-items-center p-4">{overlay}</div>}
        {live && camera.canPanTilt && <PanTiltPad cameraId={camera.id} name={camera.name} />}
        {/* Full screen takes only the picture, so its own keys come along on it. */}
        {fullscreen.active && (
          <div className="absolute bottom-3 right-3 flex gap-2 rounded-key bg-[var(--appmedia-scrim)] p-1 text-appmedia-ink">
            {live && battery && stopKey}
            {fullKey}
          </div>
        )}
      </div>
      <figcaption className="fp-media-cap">
        <span className="flex min-w-0 flex-col gap-0.5">
          <BatteryBadge camera={camera} state={charge.state} inferred={charge.inferred} />
          {plates || !event ? null : (
            <span className="text-small text-apptext-muted">
              {event.kind === 'person' ? 'Person' : 'Motion'} · {agoText(event.at)}
            </span>
          )}
          {!event && <span className="text-small text-apptext-muted">No recent activity</span>}
        </span>
        {live && (
          <span className="fp-cluster flex-nowrap gap-0.5">
            {battery && stopKey}
            {fullKey}
          </span>
        )}
      </figcaption>
      {camera.presets.length > 0 && (
        <PresetBar camera={camera} watching={live} onWatch={battery && !streaming ? start : undefined} />
      )}
    </figure>
  );
}

/** How long a "Moving to …" note stays under the camera (B-119). */
export const PRESET_NOTE_MS = 6_000;

/**
 * Stored positions (saved in the eufy app). Tapping one swings the camera there; a
 * battery camera wakes to do it, so offer to watch it move.
 */
function PresetBar({ camera, watching, onWatch }: { camera: Camera; watching: boolean; onWatch?: () => void }) {
  const [moving, setMoving] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  const go = async (index: number, name: string) => {
    setMoving(index);
    setNote(null);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    try {
      await goToCameraPreset(camera.id, index);
      setNote(watching ? `Moving to ${name}…` : `Moving to ${name}.`);
      // The move takes a few seconds; after that the note would read as if it were still going.
      noteTimer.current = setTimeout(() => setNote(null), PRESET_NOTE_MS);
    } catch (err) {
      setNote(errorMessage(err, "Couldn't move the camera"));
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="fp-label" aria-hidden="true">Turn to</span>
        <div className="fp-chips" role="group" aria-label={`${camera.name} positions`}>
          {camera.presets.map((p) => (
            <button
              key={p.index}
              type="button"
              className="fp-chip disabled:opacity-50"
              onClick={() => go(p.index, p.name)}
              disabled={moving !== null}
            >
              {moving === p.index ? 'Moving…' : p.name}
            </button>
          ))}
        </div>
      </div>
      {note && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-small text-apptext-muted">
          {note}
          {onWatch && !watching && (
            <Button size="sm" variant="quiet" icon="play" onClick={onWatch}>
              Watch live
            </Button>
          )}
        </p>
      )}
    </div>
  );
}

const PTZ_KEY =
  'absolute grid h-11 w-11 place-items-center rounded-full border border-[var(--appmedia-ink-soft)] bg-[var(--appmedia-scrim)] text-appmedia-ink disabled:opacity-60 active:translate-y-px';

/** Pan/tilt keys on each edge of the live picture — only while live, when the move is visible. */
function PanTiltPad({ cameraId, name }: { cameraId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const nudge = async (d: PanTiltDirection) => {
    if (busy) return;
    setBusy(true);
    try {
      await nudgeCamera(cameraId, d);
    } catch {
      /* the picture shows whether it moved */
    } finally {
      setBusy(false);
    }
  };
  const arrow = (d: PanTiltDirection, label: string, pos: string, icon: IconName) => (
    <button type="button" onClick={() => nudge(d)} disabled={busy} aria-label={`${label} ${name}`} className={cx(PTZ_KEY, pos)}>
      <Icon name={icon} />
    </button>
  );
  return (
    <>
      {arrow('up', 'Tilt up', 'left-[calc(50%-22px)] top-2', 'chevron-up')}
      {arrow('down', 'Tilt down', 'bottom-2 left-[calc(50%-22px)]', 'chevron-down')}
      {arrow('left', 'Pan left', 'left-2 top-[calc(50%-22px)]', 'chevron-left')}
      {arrow('right', 'Pan right', 'right-2 top-[calc(50%-22px)]', 'chevron-right')}
    </>
  );
}

function OverlayNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-well bg-[var(--appmedia-scrim)] px-3 py-1.5 text-small font-medium text-appmedia-ink">{children}</p>
  );
}

function OverlayAction({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex max-w-64 flex-col items-center gap-2 rounded-well bg-[var(--appmedia-scrim)] px-4 py-3 text-center text-appmedia-ink">
      <p className="text-small">{children}</p>
      <Button size="sm" onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}

function PlayButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button type="button" className="fp-media-play" onClick={onClick} aria-label={`Watch ${name} live`}>
      <Icon name="play" />
    </button>
  );
}

export default memo(CameraTile);
