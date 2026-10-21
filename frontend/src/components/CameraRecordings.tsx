import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCameraRecordings, fetchRecordingThumbnail, fetchRecordingVideo } from '../api/cameras';
import { errorMessage, errorStatus } from '../api/climate';
import { FOCUS_RING } from './ThermostatControls';
import {
  RECORDING_DAY_STEPS,
  canPlayHevc,
  formatClock,
  formatDuration,
  groupByDay,
  recordingFileName,
} from '../utils/recordings';
import type { CameraRecording } from '../types';

/** True once the element has scrolled into view (and stays true), so stills load as you scroll. */
function useSeen(ref: React.RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), {
      rootMargin: '200px',
    });
    io.observe(node);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

function Thumbnail({ rec }: { rec: CameraRecording }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useSeen(ref);
  const { data } = useQuery({
    queryKey: ['recording-thumb', rec.id],
    queryFn: () => fetchRecordingThumbnail(rec.id),
    enabled: seen && rec.hasThumbnail,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
  });
  const url = useMemo(() => (data ? URL.createObjectURL(data) : null), [data]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return (
    <div ref={ref} className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-appinset sm:w-36">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-lg text-apptext-muted" aria-hidden>
          ▶
        </div>
      )}
      {rec.durationMs != null && (
        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-2xs font-semibold tabular-nums text-white">
          {formatDuration(rec.durationMs)}
        </span>
      )}
    </div>
  );
}

/** Full-screen player. Fetches the MP4 (with the session) and plays it from a local blob. */
function Player({
  rec,
  onClose,
  onStep,
  hasNewer,
  hasOlder,
}: {
  rec: CameraRecording;
  onClose: () => void;
  onStep: (dir: 'newer' | 'older') => void;
  hasNewer: boolean;
  hasOlder: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUrl(null);
    setError(null);
    const ctl = new AbortController();
    let objectUrl: string | null = null;
    fetchRecordingVideo(rec.id, ctl.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (!ctl.signal.aborted) setError(errorMessage(err, "Couldn't get the recording"));
      });
    return () => {
      ctl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rec.id, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasOlder) onStep('older');
      else if (e.key === 'ArrowRight' && hasNewer) onStep('newer');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onStep, hasNewer, hasOlder]);

  const onVideoError = () => {
    setError(
      canPlayHevc() === false
        ? "This browser can't play the camera's H.265 video. Safari plays it; on other browsers, download the clip instead."
        : "The recording couldn't be played.",
    );
  };

  const when = new Date(rec.startedAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const stepButton = (dir: 'newer' | 'older', enabled: boolean, label: string, glyph: string) => (
    <button
      type="button"
      onClick={() => onStep(dir)}
      disabled={!enabled}
      aria-label={label}
      className={`h-10 w-10 rounded-full text-lg text-apptext-soft transition-colors hover:bg-appinset disabled:opacity-30 ${FOCUS_RING}`}
    >
      {glyph}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${rec.cameraName} recording`}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden border border-appborder bg-appsurface-raised sm:h-auto sm:max-w-5xl sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-appborder px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-apptext">{rec.cameraName}</h3>
            <p className="text-xs text-apptext-muted">{when}</p>
          </div>
          <div className="flex items-center gap-1">
            {stepButton('older', hasOlder, 'Older recording', '‹')}
            {stepButton('newer', hasNewer, 'Newer recording', '›')}
            {url && (
              <a
                href={url}
                download={recordingFileName(rec)}
                className={`rounded-lg px-2 py-1.5 text-xs font-medium text-appaccent-text transition-colors hover:bg-appinset ${FOCUS_RING}`}
              >
                Download
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`h-10 w-10 rounded-full text-xl text-apptext-soft transition-colors hover:bg-appinset ${FOCUS_RING}`}
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center bg-black sm:aspect-video sm:flex-none">
          {error ? (
            <div className="max-w-sm p-6 text-center text-sm text-white/80" role="alert">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className={`mt-4 h-10 rounded-xl border border-white/30 px-4 text-sm font-semibold text-white hover:bg-white/10 ${FOCUS_RING}`}
              >
                Try again
              </button>
            </div>
          ) : url ? (
            <video
              key={url}
              src={url}
              controls
              autoPlay
              playsInline
              onError={onVideoError}
              className="max-h-full w-full"
            />
          ) : (
            <p className="p-6 text-sm text-white/70" role="status">
              Getting the recording from the HomeBase…
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function CameraRecordings() {
  const [step, setStep] = useState(0);
  const [cameraFilter, setCameraFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const days = RECORDING_DAY_STEPS[step];

  const query = useQuery({
    queryKey: ['camera-recordings', days],
    queryFn: () => fetchCameraRecordings(days),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: (count, err) => errorStatus(err) !== 503 && count < 1,
  });
  const all = useMemo(() => query.data ?? [], [query.data]);
  const cameras = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of all) if (!seen.has(r.cameraId)) seen.set(r.cameraId, r.cameraName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const shown = useMemo(() => (cameraFilter ? all.filter((r) => r.cameraId === cameraFilter) : all), [all, cameraFilter]);
  const groups = useMemo(() => groupByDay(shown), [shown]);

  const openIndex = openId ? shown.findIndex((r) => r.id === openId) : -1;
  const open = openIndex >= 0 ? shown[openIndex] : null;
  const close = useCallback(() => setOpenId(null), []);
  const stepTo = useCallback(
    (dir: 'newer' | 'older') => {
      const next = shown[openIndex + (dir === 'older' ? 1 : -1)];
      if (next) setOpenId(next.id);
    },
    [shown, openIndex],
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-appinset" />
        ))}
      </div>
    );
  }

  if (query.isError && !query.data) {
    return (
      <div className="rounded-[24px] border border-dashed border-appborder bg-appsurface-raised p-8 text-center">
        <h3 className="text-lg font-semibold text-apptext">Couldn't load recordings</h3>
        <p className="mt-2 text-sm text-apptext-muted">{errorMessage(query.error)}</p>
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className={`mt-4 h-11 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 text-sm font-semibold text-apptext transition-colors hover:bg-appaccent/20 disabled:opacity-50 ${FOCUS_RING}`}
        >
          {query.isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }

  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? 'all'}
      type="button"
      onClick={() => setCameraFilter(id)}
      aria-pressed={cameraFilter === id}
      className={`h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${FOCUS_RING} ${
        cameraFilter === id
          ? 'border-appaccent-border bg-appaccent-soft text-apptext'
          : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover hover:text-apptext'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Camera">
        {chip(null, 'All cameras')}
        {cameras.map(([id, name]) => chip(id, name))}
        <span className="ml-auto text-2xs text-apptext-muted">
          {shown.length} in the last {days} days
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-appborder p-8 text-center text-sm text-apptext-muted">
          No recordings in the last {days} days.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-apptext-muted">
              {g.label} <span className="font-normal normal-case">· {g.items.length}</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {g.items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border border-appborder bg-appsurface-raised p-2 text-left transition-colors hover:border-appborder-hover ${FOCUS_RING}`}
                  >
                    <Thumbnail rec={r} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums text-apptext">{formatClock(r.startedAt)}</p>
                      <p className="truncate text-xs text-apptext-muted">
                        {r.cameraName}
                        {r.durationMs != null && ` · ${formatDuration(r.durationMs)}`}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {step < RECORDING_DAY_STEPS.length - 1 && (
        <button
          type="button"
          onClick={() => setStep((s) => s + 1)}
          disabled={query.isFetching}
          className={`h-11 self-center rounded-xl border border-appborder px-4 text-sm font-semibold text-apptext-soft transition-colors hover:text-apptext disabled:opacity-50 ${FOCUS_RING}`}
        >
          {query.isFetching ? 'Loading…' : `Show older (last ${RECORDING_DAY_STEPS[step + 1]} days)`}
        </button>
      )}

      {open && (
        <Player
          rec={open}
          onClose={close}
          onStep={stepTo}
          hasNewer={openIndex > 0}
          hasOlder={openIndex < shown.length - 1}
        />
      )}
    </div>
  );
}
