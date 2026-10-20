import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchCameraSnapshot, startCameraLive } from '../api/cameras';
import { errorMessage } from '../api/climate';
import { MsePlayer, liveSupported } from '../utils/msePlayer';
import { useOnScreen } from '../hooks/useViewerPresence';
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
    const player = new MsePlayer(video, {
      onPlaying: () => cb.current.onStatus('playing'),
      onError: (m) => cb.current.onError(m),
      onEnded: () => cb.current.onEnded(),
    });
    cb.current.onStatus('connecting');
    startCameraLive(cameraId)
      .then(({ url }) => {
        if (!cancelled) player.start(url);
      })
      .catch((err) => {
        if (!cancelled) cb.current.onError(errorMessage(err, "Couldn't start live view"));
      });
    return () => {
      cancelled = true;
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
  const tileRef = useRef<HTMLDivElement | null>(null);
  const onScreen = useOnScreen(tileRef);
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
    shouldStream({ camera, requested, pageVisible, onScreen, idle, failed: liveError != null || budgetHit });

  // Leaving (tab hidden, scrolled away, idle) cancels a battery camera's tap —
  // coming back shouldn't silently wake it again.
  useEffect(() => {
    if (!pageVisible || !onScreen || idle) setRequested(false);
  }, [pageVisible, onScreen, idle]);

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

  const onEnded = () => {
    if (battery) {
      // The bridge ended a battery stream (its own budget) — same prompt as ours.
      setBudgetHit(true);
      setRequested(false);
    } else if (reconnects < 3) {
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
      ref={tileRef}
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
    </div>
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
