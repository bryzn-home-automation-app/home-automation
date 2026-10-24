import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchCameraSnapshot, goToCameraPreset, nudgeCamera, reportLiveDiagnostics, startCameraLive, type PanTiltDirection } from '../api/cameras';
import { errorMessage } from '../api/climate';
import { HlsPlayer, MsePlayer, liveSupported, preferHls, type LivePlayer } from '../utils/msePlayer';
import {
  BATTERY_LIVE_BUDGET_MS,
  ago,
  autoLive,
  batteryTone,
  chargeLabel,
  isRecent,
  latestEvent,
  shouldStream,
  type ChargeState,
} from '../utils/cameras';
import { FOCUS_RING } from './ThermostatControls';
import type { Camera } from '../types';

const TONE_CLASS = {
  ok: 'text-emerald-300',
  low: 'text-amber-300',
  critical: 'text-rose-300',
  unknown: 'text-apptext-muted',
} as const;

/** Battery badge: "🔋 87% · ☀️ Solar charging". Wired cameras say so. */
export function BatteryBadge({ camera, state, inferred }: { camera: Camera; state: ChargeState; inferred: boolean }) {
  if (camera.powerSource === 'wired') {
    return <span className="text-2xs text-apptext-muted">🔌 Wired power</span>;
  }
  if (camera.batteryPercent == null) return null;
  const tone = batteryTone(camera.batteryPercent);
  const label = chargeLabel(camera, state, inferred);
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs">
      <span className={`font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
        {tone === 'critical' ? '🪫' : '🔋'} {Math.round(camera.batteryPercent)}%
      </span>
      {label && (
        <span className={state === 'charging' ? 'text-emerald-300' : 'text-apptext-muted'}>
          · {state === 'charging' ? '☀️ ' : ''}
          {label}
        </span>
      )}
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

type LiveStatus = 'connecting' | 'playing';

/** Mounted only while the tile should stream; unmounting stops the camera. */
function LiveVideo({
  cameraId,
  onStatus,
  onError,
  onEnded,
}: {
  cameraId: string;
  onStatus: (s: LiveStatus) => void;
  onError: (message: string) => void;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Latest callbacks without restarting the stream when the parent re-renders.
  const cb = useRef({ onStatus, onError, onEnded });
  cb.current = { onStatus, onError, onEnded };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let playing = false;
    const hls = preferHls();
    const Player = hls ? HlsPlayer : MsePlayer;
    const player: LivePlayer = new Player(video, {
      onPlaying: () => {
        playing = true;
        cb.current.onStatus('playing');
      },
      onError: (m) => cb.current.onError(m),
      onEnded: () => cb.current.onEnded(),
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
    const report = setTimeout(() => {
      if (!cancelled) {
        void reportLiveDiagnostics(cameraId, { ...player.diagnostics(), playing, userAgent: navigator.userAgent });
      }
    }, 8_000);
    return () => {
      cancelled = true;
      clearTimeout(report);
      player.stop();
    };
  }, [cameraId]);

  return <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 h-full w-full object-cover" />;
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
  const [liveError, setLiveError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  // Bumping the session remounts LiveVideo (a fresh ticket + socket).
  const [session, setSession] = useState(0);
  const [reconnects, setReconnects] = useState(0);
  const supported = useMemo(liveSupported, []);

  const streaming =
    supported &&
    shouldStream({ camera, requested, pageVisible, idle, failed: liveError != null || budgetHit });

  // Leaving the tab ends the visit: coming back starts live again rather than
  // on the "Still watching?" prompt a battery camera left behind.
  useEffect(() => {
    if (!pageVisible || idle) setRequested(false);
    if (!pageVisible) setBudgetHit(false);
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

  const start = () => {
    onWake();
    setLiveError(null);
    setBudgetHit(false);
    setReconnects(0);
    setRequested(true);
    setSession((s) => s + 1);
  };
  const stop = () => {
    setRequested(false);
    setBudgetHit(false);
  };

  // The stream ended under us. For a battery camera that's usually the bridge's own
  // budget recycling a stream the app primed before this tab opened (CameraPrimer),
  // so reconnect rather than ask. Our budget above still decides when to ask.
  const onEnded = () => {
    if (reconnects < 3) {
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

  let overlay: React.ReactNode = null;
  if (!camera.available) {
    overlay = <OverlayNote>Camera offline</OverlayNote>;
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
  } else if (streaming && status !== 'playing') {
    overlay = <OverlayNote>{battery ? 'Waking camera…' : 'Connecting…'}</OverlayNote>;
  }

  return (
    <div
      className={`overflow-hidden rounded-[24px] border bg-appsurface-raised shadow-[0_10px_28px_var(--appshadow)] transition-colors ${
        recent ? 'border-rose-400/70 ring-2 ring-rose-400/40' : 'border-appborder'
      }`}
    >
      <div className="relative aspect-video bg-black">
        {snapshotUrl && showSnapshot && (
          <img src={snapshotUrl} alt={`Latest snapshot from ${camera.name}`} className="absolute inset-0 h-full w-full object-cover" />
        )}
        {!snapshotUrl && snapshotQuery.isLoading && <div className="absolute inset-0 animate-pulse bg-appinset" />}
        {!snapshotUrl && snapshotQuery.isError && !live && (
          // Corner, not centre — the play button / overlays own the middle.
          <p className="absolute bottom-3 left-3 text-2xs text-white/60">No snapshot yet</p>
        )}
        {streaming && (
          <LiveVideo
            key={session}
            cameraId={camera.id}
            onStatus={setStatus}
            onError={(m) => setLiveError(m)}
            onEnded={onEnded}
          />
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex gap-2">
          {live ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-3xs font-semibold uppercase tracking-[0.14em] text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Live
            </span>
          ) : (
            snapshotUrl && (
              <span className="rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white/80">Snapshot</span>
            )
          )}
        </div>
        {overlay && <div className="absolute inset-0 flex items-center justify-center bg-black/35 p-4">{overlay}</div>}
        {live && camera.canPanTilt && <PanTiltPad cameraId={camera.id} name={camera.name} />}
        {live && battery && (
          <button
            type="button"
            onClick={stop}
            className={`absolute bottom-3 right-3 h-9 rounded-full bg-black/60 px-3 text-xs font-semibold text-white hover:bg-black/75 ${FOCUS_RING}`}
          >
            Stop
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-apptext">{camera.name}</p>
          {event ? (
            <p className={`text-2xs ${recent ? 'font-semibold text-rose-300' : 'text-apptext-muted'}`}>
              {event.kind === 'person' ? '🚶 Person' : '👀 Motion'} · {ago(event.at)}
            </p>
          ) : (
            <p className="text-2xs text-apptext-muted">No recent activity</p>
          )}
        </div>
        <BatteryBadge camera={camera} state={charge.state} inferred={charge.inferred} />
      </div>
      {camera.presets.length > 0 && (
        <PresetBar camera={camera} watching={live} onWatch={battery && !streaming ? start : undefined} />
      )}
    </div>
  );
}

/**
 * Stored positions (saved in the eufy app). Tapping one swings the camera there; a
 * battery camera wakes to do it, so offer to watch it move.
 */
function PresetBar({ camera, watching, onWatch }: { camera: Camera; watching: boolean; onWatch?: () => void }) {
  const [moving, setMoving] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const go = async (index: number, name: string) => {
    setMoving(index);
    setNote(null);
    try {
      await goToCameraPreset(camera.id, index);
      setNote(watching ? `Moving to ${name}…` : `Moving to ${name}.`);
    } catch (err) {
      setNote(errorMessage(err, "Couldn't move the camera"));
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="border-t border-appborder px-4 py-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${camera.name} positions`}>
        {camera.presets.map((p) => (
          <button
            key={p.index}
            type="button"
            onClick={() => go(p.index, p.name)}
            disabled={moving !== null}
            className={`h-9 rounded-full border border-appborder bg-appinset px-3 text-xs font-semibold text-apptext-soft transition-colors hover:border-appborder-hover hover:text-apptext disabled:opacity-50 ${FOCUS_RING}`}
          >
            {moving === p.index ? 'Moving…' : p.index === 0 && p.name === 'Home' ? '⌂ Home' : p.name}
          </button>
        ))}
      </div>
      {note && (
        <p role="status" className="mt-2 text-2xs text-apptext-muted">
          {note}
          {onWatch && !watching && (
            <>
              {' '}
              <button type="button" onClick={onWatch} className="font-semibold text-appaccent-text underline">
                Watch live
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Pan/tilt arrows over the live picture — only while live, when the move is visible. */
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
  const arrow = (d: PanTiltDirection, label: string, pos: string, glyph: string) => (
    <button
      type="button"
      onClick={() => nudge(d)}
      disabled={busy}
      aria-label={`${label} ${name}`}
      className={`absolute ${pos} flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-lg text-white transition-colors hover:bg-black/70 disabled:opacity-60 ${FOCUS_RING}`}
    >
      {glyph}
    </button>
  );
  return (
    <>
      {arrow('up', 'Tilt up', 'left-1/2 top-3 -translate-x-1/2', '▲')}
      {arrow('down', 'Tilt down', 'bottom-3 left-1/2 -translate-x-1/2', '▼')}
      {arrow('left', 'Pan left', 'left-3 top-1/2 -translate-y-1/2', '◀')}
      {arrow('right', 'Pan right', 'right-3 top-1/2 -translate-y-1/2', '▶')}
    </>
  );
}

function OverlayNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">{children}</p>;
}

function OverlayAction({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex max-w-[16rem] flex-col items-center gap-2 rounded-2xl bg-black/65 px-4 py-3 text-center">
      <p className="text-xs text-white">{children}</p>
      <button
        type="button"
        onClick={onClick}
        className={`h-11 rounded-xl bg-white/90 px-4 text-sm font-semibold text-slate-900 hover:bg-white ${FOCUS_RING}`}
      >
        {label}
      </button>
    </div>
  );
}

function PlayButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Watch ${name} live`}
      className={`flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white transition-transform hover:scale-105 hover:bg-black/75 ${FOCUS_RING}`}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z" fill="currentColor" />
      </svg>
    </button>
  );
}

export default memo(CameraTile);
