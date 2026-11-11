import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCameraRecordings, fetchRecordingThumbnail, fetchRecordingVideo } from '../api/cameras';
import { errorMessage, errorStatus } from '../api/climate';
import {
  RECORDING_DAY_STEPS,
  canPlayHevc,
  formatClock,
  formatDuration,
  groupByDay,
  recordingFileName,
  type RecordingDay,
} from '../utils/recordings';
import { formatDate, formatDateTime } from '../utils/format';
import {
  Button,
  Chips,
  Dialog,
  Disclosure,
  EmptyState,
  ErrorState,
  Icon,
  List,
  Panel,
  QueryState,
  Row,
  SkelRows,
  buttonClass,
} from './ui';
import type { CameraRecording } from '../types';

/**
 * The element whose scrolling brings a node into view: below lg the page scrolls inside the
 * shell's [data-page-scroller] box, not the window (B-116: observed against the window, every
 * thumbnail on a phone only started loading once it was already on screen).
 */
export function scrollRoot(node: Element): Element | null {
  const box = node.closest('[data-page-scroller]');
  if (box instanceof HTMLElement && typeof getComputedStyle === 'function') {
    const y = getComputedStyle(box).overflowY;
    if (y === 'auto' || y === 'scroll') return box;
  }
  return null;
}

/** True once the element has scrolled near the view (and stays true), so stills load just ahead of the scroll. */
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
      root: scrollRoot(node),
      rootMargin: '200px',
    });
    io.observe(node);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

function Thumbnail({ rec }: { rec: CameraRecording }) {
  const ref = useRef<HTMLSpanElement | null>(null);
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
    <span
      ref={ref}
      className="relative grid aspect-video w-[104px] flex-none place-items-center overflow-hidden rounded-tag bg-appmedia-bg text-appmedia-ink lg:w-32"
    >
      {url ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Icon name="play" />}
      {rec.durationMs != null && (
        <span className="absolute bottom-1 right-1 rounded-[4px] bg-[var(--appmedia-scrim)] px-1.5 font-mono text-[11px] leading-[1.4] tabular-nums">
          {formatDuration(rec.durationMs)}
        </span>
      )}
    </span>
  );
}

/** The player: fetches the MP4 (with the session) and plays it from a local blob, in the kit Dialog (full screen on a phone). */
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

  // ← / → step between clips, except while the video (or another control) has the keys:
  // there an arrow seeks inside the clip (B-118). Escape is the Dialog's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('video, input, textarea, select, [role="slider"]')) return;
      if (e.key === 'ArrowLeft' && hasOlder) onStep('older');
      else if (e.key === 'ArrowRight' && hasNewer) onStep('newer');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStep, hasNewer, hasOlder]);

  const onVideoError = () => {
    setError(
      canPlayHevc() === false
        ? "This browser can't play the camera's H.265 video. Safari plays it; on other browsers, download the clip instead."
        : "The recording couldn't be played.",
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Recording"
      title={rec.cameraName}
      subtitle={formatDateTime(rec.startedAt)}
      size="wide"
      fullOnPhone
      wellBody
      bodyClassName="max-sm:flex max-sm:flex-col max-sm:justify-center"
      footerSplit
      footer={
        <>
          <Button variant="quiet" icon="chevron-left" onClick={() => onStep('older')} disabled={!hasOlder} aria-label="Older recording">
            Older
          </Button>
          {url ? (
            <a href={url} download={recordingFileName(rec)} className={buttonClass({ variant: 'quiet', size: 'sm' })}>
              <Icon name="download" />
              Download
            </a>
          ) : (
            <span />
          )}
          <Button variant="quiet" iconEnd="chevron-right" onClick={() => onStep('newer')} disabled={!hasNewer} aria-label="Newer recording">
            Newer
          </Button>
        </>
      }
    >
      <div className="fp-media-frame grid place-items-center">
        {error ? (
          <div className="flex max-w-sm flex-col items-center gap-3 p-6 text-center text-small" role="alert">
            <p>{error}</p>
            <Button size="sm" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : url ? (
          <video key={url} src={url} controls autoPlay playsInline onError={onVideoError} className="absolute inset-0 h-full w-full" />
        ) : (
          <p className="p-6 text-small" role="status">
            Getting the recording from the HomeBase…
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** One day: its head (the day, its date, how many clips) and its clips in two columns from lg. */
function Day({ day, onOpen }: { day: RecordingDay; onOpen: (id: string) => void }) {
  const first = day.items[0];
  const date = first ? formatDate(first.startedAt) : '';
  return (
    <section className="flex flex-col gap-1" aria-label={day.label}>
      <h3 className="fp-tl-day">
        <span className="fp-label">{day.label}</span>
        {date !== day.label && <span className="fp-mono">{date}</span>}
        <span className="fp-mono ml-auto">{day.items.length === 1 ? '1 clip' : `${day.items.length} clips`}</span>
      </h3>
      <List cols>
        {day.items.map((r) => (
          <Row
            key={r.id}
            onClick={() => onOpen(r.id)}
            lead={<Thumbnail rec={r} />}
            title={<span className="tabular-nums">{formatClock(r.startedAt)}</span>}
            meta={r.cameraName}
          />
        ))}
      </List>
    </section>
  );
}

/** Days shown before "Show more days" (the rest sit behind a disclosure, not a scroll box). */
const DAYS_SHOWN = 2;

export default function CameraRecordings() {
  const [step, setStep] = useState(0);
  const [cameraFilter, setCameraFilter] = useState<string>('all');
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
  // The reach the list actually covers (B-115): while "Show older" loads, the last list stays
  // up and still means 7 days, not 14.
  const loadedDays = useRef<number>(days);
  if (query.data !== undefined && !query.isPlaceholderData) loadedDays.current = days;
  const coveredDays = loadedDays.current;
  // Only a "Show older" load counts, not the minute's background refresh (B-113).
  const loadingOlder = query.isFetching && query.isPlaceholderData;

  const all = useMemo(() => query.data ?? [], [query.data]);
  const cameras = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    for (const r of all) {
      const c = seen.get(r.cameraId);
      if (c) c.count++;
      else seen.set(r.cameraId, { name: r.cameraName, count: 1 });
    }
    return [...seen.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [all]);
  // B-114: a camera whose last clip aged out takes its filter with it.
  useEffect(() => {
    if (cameraFilter !== 'all' && query.data !== undefined && !cameras.some(([id]) => id === cameraFilter)) setCameraFilter('all');
  }, [cameras, cameraFilter, query.data]);
  const shown = useMemo(() => (cameraFilter !== 'all' ? all.filter((r) => r.cameraId === cameraFilter) : all), [all, cameraFilter]);
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

  const filterName = cameras.find(([id]) => id === cameraFilter)?.[1].name;
  const more = groups.slice(DAYS_SHOWN);
  const moreClips = more.reduce((n, g) => n + g.items.length, 0);

  const olderKey =
    step < RECORDING_DAY_STEPS.length - 1 ? (
      <Button size="sm" icon="history" onClick={() => setStep((s) => s + 1)} busy={loadingOlder} busyLabel="Loading…">
        Show {RECORDING_DAY_STEPS[step + 1]} days
      </Button>
    ) : null;

  return (
    <Panel
      title="Recordings"
      subtitle={
        query.data === undefined
          ? 'Newest first'
          : `${shown.length === 1 ? '1 clip' : `${shown.length} clips`} in the last ${coveredDays} days, newest first`
      }
    >
      <QueryState
        query={query}
        what="the recordings"
        loading={<SkelRows count={4} />}
        isEmpty={() => false}
        error={
          <ErrorState title="Couldn't load the recordings" onRetry={() => void query.refetch()} retrying={query.isFetching}>
            {errorMessage(query.error)}
          </ErrorState>
        }
      >
        {() => (
          <div className="fp-stack fp-stack--l">
            {cameras.length > 0 && (
              <Chips
                label="Camera"
                value={cameraFilter}
                onChange={setCameraFilter}
                options={[
                  { value: 'all', label: 'All cameras', count: all.length },
                  ...cameras.map(([id, c]) => ({ value: id, label: c.name, count: c.count })),
                ]}
              />
            )}
            {groups.length === 0 ? (
              <EmptyState compact icon="video" title={`No recordings in the last ${coveredDays} days.`} action={olderKey}>
                Clips appear here a minute after a camera records motion or a person.
              </EmptyState>
            ) : (
              <>
                {groups.slice(0, DAYS_SHOWN).map((g) => (
                  <Day key={g.key} day={g} onOpen={setOpenId} />
                ))}
                {more.length > 0 && (
                  <Disclosure
                    variant="row"
                    summary={`Show ${more.length === 1 ? '1 more day' : `${more.length} more days`} (${moreClips === 1 ? '1 clip' : `${moreClips} clips`})`}
                    openSummary="Show fewer days"
                  >
                    <div className="fp-stack fp-stack--l pt-4">
                      {more.map((g) => (
                        <Day key={g.key} day={g} onOpen={setOpenId} />
                      ))}
                    </div>
                  </Disclosure>
                )}
                {olderKey && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="fp-mono text-apptext-muted">
                      That’s the last {coveredDays} days{filterName ? ` for ${filterName}` : ''}
                    </span>
                    {olderKey}
                  </div>
                )}
              </>
            )}
            {open && (
              <Player rec={open} onClose={close} onStep={stepTo} hasNewer={openIndex > 0} hasOlder={openIndex < shown.length - 1} />
            )}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
