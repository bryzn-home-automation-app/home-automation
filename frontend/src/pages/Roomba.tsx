import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import RoombaMap, { type LastClean, type LastSeenMark, type RoomSelection, type SplitLine } from '../components/RoombaMap';
import RoomRenameModal from '../components/RoomRenameModal';
import RoomSplitModal from '../components/RoomSplitModal';
import RoomMergeModal from '../components/RoomMergeModal';
import RoomCleanModal from '../components/RoomCleanModal';
import CleanModal, { type CleanRoomOption } from '../components/CleanModal';
import RoomRunDetailModal from '../components/RoomRunDetailModal';
import RoombaControls from '../components/RoombaControls';
import RoombaNativeSchedules from '../components/RoombaNativeSchedules';
import RoombaMaintenance from '../components/RoombaMaintenance';
import { usePageMeta } from '../components/shell/PageMeta';
import {
  Badge, Button, Disclosure, EmptyState, Icon, IconButton, InstrumentPanel, KeyValue, KV, Lamp, List, Notice,
  Num, Panel, QueryState, Readout, Readouts, Ring, Row, Screen, Seg, SegPanel, SkelPanel, SkelRows, Split, Stack,
  Verdict, useSearchParamState, type ChartTone,
} from '../components/ui';
import { fetchRoombaStatus, fetchRoombaRuns, fetchRoombaMap, fetchRoombaDevice, fetchRoombaParts, fetchRoombaLastPosition } from '../api/roomba';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { useRoombaNativeSchedules } from '../hooks/useRoombaNativeSchedules';
import { useAuth } from '../context/AuthContext';
import { cleaningMinutes, isRecharging, roomsSummary } from '../utils/roomba';
import {
  dockLamp, initiatorLabel, lastSeen, nextCleanDay, nextScheduledClean, padLabel, roombaState, roombaVerdict, runStatus,
} from '../utils/roombaStatus';
import { batteryStatus, humanize, onlineStatus, type Tone } from '../utils/status';
import { DASH, NBSP, formatDayName, formatDuration, formatNumber, formatStamp, formatTime, plural } from '../utils/format';
import type { RoombaRun, RoombaStatus } from '../types';

// The Time per clean chart pulls in Recharts; it sits below the fold, so it loads after the
// map and the keys instead of ahead of them.
const RoombaRunTimes = lazy(() => import('../components/RoombaRunTimes'));

// Overview is the everyday view (the map, recent cleans, schedules, rooms); Maintenance is the
// robot's parts and lifetime counters, checked now and then. The view lives in ?view= so it
// survives a reload, Back and the sleep screen.
const VIEWS = [
  { value: 'overview', label: 'Overview', icon: 'robot' },
  { value: 'maintenance', label: 'Maintenance', icon: 'tool' },
] as const;
const VIEW_VALUES = ['overview', 'maintenance'] as const;

// The run list shows this many, then a "Show more" disclosure (no scroll box inside the page; B-006).
const RUNS_SHOWN = 7;

const TONE_TO_CHART: Record<Tone, ChartTone> = { ok: 'ok', headsup: 'warn', problem: 'problem', info: 'info', neutral: 'ink' };

/** "Cleaned yesterday" / "Last cleaned Sun, Nov 1" for a room, from the newest confirmed run that named it. */
function lastCleanedLine(at: string | undefined, now: Date): string {
  if (!at) return 'No clean recorded yet';
  const day = formatDayName(at, now);
  return day === 'Today' || day === 'Yesterday' ? `Cleaned ${day.toLowerCase()}` : `Last cleaned ${day}`;
}

/** "9:00 AM" → ["9:00", "AM"], so a readout can set the AM/PM in mono like a unit. */
function splitTime(text: string): [string, string | undefined] {
  const i = text.lastIndexOf(NBSP);
  return i > 0 ? [text.slice(0, i), text.slice(i + 1)] : [text, undefined];
}

// ── Page ──────────────────────────────────────────────────

export default memo(function Roomba() {
  // Memoized once per query lifecycle so the RQ poll timers aren't reset on
  // every re-render (this page re-renders on each status poll).
  const statusInterval = useJitteredInterval(30_000, 5_000);
  const runsInterval = useJitteredInterval(60_000);
  const mapInterval = useJitteredInterval(300_000, 30_000);
  const deviceInterval = useJitteredInterval(600_000, 30_000);
  const partsInterval = useJitteredInterval(300_000, 30_000);

  const statusQuery = useQuery({
    queryKey: ['roomba-status'],
    queryFn: fetchRoombaStatus,
    staleTime: 20_000,
    refetchInterval: statusInterval,
    refetchIntervalInBackground: false,
  });

  const runsQuery = useQuery({
    queryKey: ['roomba-runs'],
    queryFn: () => fetchRoombaRuns(50),
    staleTime: 60_000,
    refetchInterval: runsInterval,
    refetchIntervalInBackground: false,
  });

  const mapQuery = useQuery({
    queryKey: ['roomba-map'],
    queryFn: fetchRoombaMap,
    staleTime: 300_000,
    refetchInterval: mapInterval,
    refetchIntervalInBackground: false,
  });

  const deviceQuery = useQuery({
    queryKey: ['roomba-device'],
    queryFn: fetchRoombaDevice,
    staleTime: 600_000,
    refetchInterval: deviceInterval,
    refetchIntervalInBackground: false,
  });

  // Maintenance counters change only when a mission ends (the poller re-reads them
  // ~40s after a run), so a slow poll plus the end-of-run refetch below is plenty.
  const partsQuery = useQuery({
    queryKey: ['roomba-parts'],
    queryFn: fetchRoombaParts,
    staleTime: 300_000,
    refetchInterval: partsInterval,
    refetchIntervalInBackground: false,
  });

  // The last position the robot reported, however old: the map's "last seen" marker when it
  // has stopped away from its dock. Read with the status, which decides whether it shows.
  const lastPositionQuery = useQuery({
    queryKey: ['roomba-last-position'],
    queryFn: fetchRoombaLastPosition,
    staleTime: 20_000,
    refetchInterval: statusInterval,
    refetchIntervalInBackground: false,
  });

  // The same query the Schedules panel reads (one request): the "Next clean" readout.
  const { query: schedulesQuery } = useRoombaNativeSchedules(true);

  const status = statusQuery.data ?? null;
  const device = deviceQuery.data ?? null;
  const runs = useMemo<RoombaRun[]>(() => runsQuery.data ?? [], [runsQuery.data]);
  const running = status?.running ?? false;
  const state = roombaState(status);
  const { isAdmin } = useAuth();
  const [view, setView] = useSearchParamState('view', VIEW_VALUES, 'overview');

  usePageMeta({ subtitle: statusQuery.dataUpdatedAt ? `Updated ${formatTime(statusQuery.dataUpdatedAt)}` : undefined });

  // When a clean finishes (running → idle), the robot regenerates its floor plan, so
  // pull the fresh map and the newly-recorded run instead of waiting on the ~5-min map
  // poll. The poller re-fetches the bundle ~25s after completion (MAP_REFRESH_AFTER_RUN),
  // so refetch in a short burst to converge once the new bundle lands server-side.
  const queryClient = useQueryClient();
  const prevRunningRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevRunningRef.current;
    prevRunningRef.current = running;
    if (prev !== true || running !== false) return; // only the cleaning → idle edge
    const refetchMap = () => queryClient.invalidateQueries({ queryKey: ['roomba-map'] });
    const refetchParts = () => queryClient.invalidateQueries({ queryKey: ['roomba-parts'] });
    queryClient.invalidateQueries({ queryKey: ['roomba-runs'] });
    // Where it stopped, if that wasn't the dock: the newest position, not the last poll's.
    queryClient.invalidateQueries({ queryKey: ['roomba-last-position'] });
    refetchMap();
    // Part counters land ~40s after the run (PARTS_REFRESH_AFTER_RUN in the poller).
    const timers = [
      setTimeout(refetchMap, 20_000),
      setTimeout(refetchMap, 45_000),
      setTimeout(refetchParts, 60_000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [running, queryClient]);

  const [selectedRoom, setSelectedRoom] = useState<RoomSelection | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [pendingSplit, setPendingSplit] = useState<SplitLine | null>(null);
  // In-progress divide polyline (parent-owned): the room + its corners in meters.
  const [splitDraft, setSplitDraft] = useState<{
    roomId: string;
    roomName: string | null;
    pts: [number, number][];
  } | null>(null);

  // Merge mode: multi-select rooms to combine into one.
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<RoomSelection[]>([]);
  const [pendingMerge, setPendingMerge] = useState<RoomSelection[] | null>(null);

  // Clean mode: tap a room to open its clean-config dialog.
  const [cleanMode, setCleanMode] = useState(false);
  const [cleanRoom, setCleanRoom] = useState<RoomSelection | null>(null);
  // "Start a clean" dialog (whole-house or a room selection, with options).
  const [showClean, setShowClean] = useState(false);
  // Run history: the run whose detail dialog is open.
  const [selectedRun, setSelectedRun] = useState<RoombaRun | null>(null);

  // The map is the instrument at the top; the map tools sit with the Rooms list further
  // down, so entering a mode brings the map back into view.
  const mapRef = useRef<HTMLDivElement | null>(null);
  const showMap = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    mapRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };

  const exitSplitMode = () => {
    setSplitMode(false);
    setSplitDraft(null);
  };

  const exitMergeMode = () => {
    setMergeMode(false);
    setMergeSelection([]);
  };

  const exitCleanMode = () => setCleanMode(false);

  // The three room-edit modes are mutually exclusive — entering one exits the others.
  const enterSplitMode = () => {
    exitMergeMode();
    exitCleanMode();
    setSplitMode(true);
    showMap();
  };
  const enterMergeMode = () => {
    exitSplitMode();
    exitCleanMode();
    setMergeMode(true);
    showMap();
  };
  const enterCleanMode = () => {
    exitSplitMode();
    exitMergeMode();
    setCleanMode(true);
    showMap();
  };

  const toggleMergeRoom = useCallback((room: RoomSelection) =>
    setMergeSelection((prev) =>
      prev.some((r) => r.id === room.id)
        ? prev.filter((r) => r.id !== room.id)
        : [...prev, room],
    ), []);

  const finishMerge = () => {
    if (mergeSelection.length < 2) return;
    setPendingMerge(mergeSelection);
    exitMergeMode();
  };

  // Add a corner. The first corner must land inside a room (that sets the target);
  // later corners just extend the path.
  const addSplitPoint = useCallback((point: [number, number], room: RoomSelection | null) => {
    setSplitDraft((prev) => {
      if (!prev) {
        if (!room) return prev; // ignore clicks outside any room until one is picked
        return { roomId: room.id, roomName: room.name, pts: [point] };
      }
      return { ...prev, pts: [...prev.pts, point] };
    });
  }, []);

  const undoSplitPoint = useCallback(() =>
    setSplitDraft((prev) => {
      if (!prev) return prev;
      if (prev.pts.length <= 1) return null; // removing the first corner clears the room too
      return { ...prev, pts: prev.pts.slice(0, -1) };
    }), []);

  const finishSplit = useCallback(() => {
    if (!splitDraft || splitDraft.pts.length < 2) return;
    setPendingSplit({
      roomId: splitDraft.roomId,
      roomName: splitDraft.roomName,
      points: splitDraft.pts,
    });
    setSplitMode(false);
    setSplitDraft(null);
  }, [splitDraft]);

  // Stable clean-room handler + memoized merge-id array so RoombaMap's props
  // keep referential identity between position polls (memo(RoombaMap) holds).
  const handleSelectCleanRoom = useCallback((room: RoomSelection) => {
    setCleanRoom(room);
    setCleanMode(false);
  }, []);

  const mergeSelectionIds = useMemo(
    () => mergeSelection.map((r) => r.id),
    [mergeSelection],
  );

  // Mapped rooms (id + name) for the "Start a clean" dialog and the Rooms list.
  const cleanRooms = useMemo<CleanRoomOption[]>(() => {
    const feats = mapQuery.data?.geojson?.rooms?.features ?? [];
    return feats
      .filter((f) => f.id != null)
      .map((f) => {
        const raw = (f.properties?.name ?? f.properties?.room_name) as unknown;
        const name = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
        return { id: String(f.id), name };
      });
  }, [mapQuery.data]);

  // Newest confirmed clean of each named room (runs come newest first).
  const lastCleaned = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of runs) {
      if (!r.verified) continue;
      for (const name of r.rooms) if (!m.has(name)) m.set(name, r.startedAt);
    }
    return m;
  }, [runs]);

  const now = new Date();
  const recharging = isRecharging(status);
  const mapLive = running && !state.offline;

  // The rooms of the newest confirmed clean, drawn as faint lanes on the map while the robot
  // is docked (live coverage takes over during a run). A week-old clean isn't news: none then.
  const lastConfirmed = useMemo(() => runs.find((r) => r.verified && r.rooms.length > 0) ?? null, [runs]);
  const lastConfirmedFresh = !!lastConfirmed && now.getTime() - new Date(lastConfirmed.startedAt).getTime() < 7 * 86_400_000;
  const lastCleanLabel = lastConfirmed && lastConfirmedFresh && !mapLive ? lastCleanedLine(lastConfirmed.startedAt, now) : null;
  // Keyed on the run and its words, so the map's props stay stable between polls.
  const lastClean = useMemo<LastClean | null>(
    () => (lastConfirmed && lastCleanLabel ? { rooms: lastConfirmed.rooms, label: lastCleanLabel } : null),
    [lastConfirmed, lastCleanLabel],
  );

  // Away from the dock and not moving: where it was last seen, on the map and in the verdict.
  const seen = lastSeen({ status, position: lastPositionQuery.data, geojson: mapQuery.data?.geojson, now });
  const seenX = seen?.x;
  const seenY = seen?.y;
  const seenLabel = seen?.short;
  const lastSeenMark = useMemo<LastSeenMark | null>(
    () => (seenX != null && seenY != null && seenLabel ? { x: seenX, y: seenY, label: seenLabel } : null),
    [seenX, seenY, seenLabel],
  );

  // ── The answer ─────────────────────────────────────────
  const statusPending = statusQuery.data === undefined && !statusQuery.isError;
  const statusFailed = statusQuery.data === undefined && statusQuery.isError;
  let verdict: ReactNode;
  if (statusPending) {
    // A neutral "checking" while the first answer is on its way, never "No data" (B-139).
    verdict = <Verdict tone="neutral" note="This takes a moment.">Checking on the robot…</Verdict>;
  } else if (statusFailed) {
    verdict = (
      <Verdict
        tone="problem"
        note={
          <>
            The home server didn't answer.{' '}
            <button type="button" className="fp-link" onClick={() => void statusQuery.refetch()}>Try again</button>
          </>
        }
      >
        Couldn't reach the robot's status.
      </Verdict>
    );
  } else {
    const v = roombaVerdict({ status, parts: partsQuery.data, lastSeen: seen });
    verdict = (
      <Verdict
        tone={v.tone}
        note={
          v.note || v.aboutParts ? (
            <>
              {v.note}
              {v.code && (
                <>
                  {' '}
                  <span className="fp-mono fp-small fp-muted whitespace-nowrap">{v.code}</span>
                </>
              )}
              {v.aboutParts && (
                <>
                  {' '}
                  <button type="button" className="fp-link" onClick={() => setView('maintenance')}>See parts</button>
                </>
              )}
            </>
          ) : undefined
        }
      >
        {v.sentence}
      </Verdict>
    );
  }

  // First readout: this clean while one is under way (a mid-clean recharge included, B-130),
  // otherwise the last finished one.
  const lastRun = runs[0] ?? null;
  let firstReadout: ReactNode;
  if (status && state.inMission) {
    const so = recharging
      ? 'Recharging to finish'
      : status.runtimeMinutes != null ? `${formatDuration(status.runtimeMinutes)} so far` : 'Under way';
    const by = initiatorLabel(status.initiator);
    firstReadout = (
      <Readout
        label="This clean"
        value={status.sqft != null ? formatNumber(status.sqft) : DASH}
        unit={status.sqft != null ? 'sq ft' : undefined}
        // The verdict already says how far along it is; this says who started it (the old
        // "Started by" detail), else the time so far.
        note={!recharging && by ? `Started by ${by.charAt(0).toLowerCase()}${by.slice(1)}` : so}
      />
    );
  } else if (lastRun) {
    const mins = cleaningMinutes(lastRun);
    const rooms = lastRun.verified && lastRun.rooms.length ? plural(lastRun.rooms.length, 'room') : null;
    firstReadout = (
      <Readout
        label={formatDayName(lastRun.startedAt, now)}
        value={lastRun.squareFeet != null ? formatNumber(lastRun.squareFeet) : DASH}
        unit={lastRun.squareFeet != null ? 'sq ft' : undefined}
        note={[rooms, mins != null ? `${rooms ? 'in ' : ''}${formatDuration(mins)}` : null].filter(Boolean).join(' ') || runStatus(lastRun.status).label}
      />
    );
  } else {
    firstReadout = (
      <Readout
        label="Last clean"
        value={status?.sqft != null ? formatNumber(status.sqft) : DASH}
        unit={status?.sqft != null ? 'sq ft' : undefined}
        note={runsQuery.isError && !runsQuery.data ? "Couldn't load the cleans" : 'No cleans recorded yet'}
      />
    );
  }

  const next = nextScheduledClean(schedulesQuery.data, now);
  const [nextValue, nextUnit] = next ? splitTime(formatTime(next.at)) : [DASH, undefined];
  const nextNote = next
    ? [nextCleanDay(next, now), next.name].filter(Boolean).join(', ')
    : schedulesQuery.data === undefined
      ? schedulesQuery.isError ? "Couldn't load the schedules" : 'Checking the schedules'
      : 'No schedule turned on';

  // The battery ring sits under the map, beside its legend.
  const battery = status?.batteryPct ?? null;
  const bStatus = batteryStatus(battery, status?.phase === 'charge');
  const batteryRing = status ? (
    <div className="flex items-center gap-2">
      <Ring
        value={(battery ?? 0) / 100}
        tone={state.offline ? 'graphite' : TONE_TO_CHART[bStatus.tone]}
        width={22}
        size={48}
        label={`Battery ${bStatus.label}${state.offline ? ' when last seen' : ''}`}
      >
        <Icon name={status.phase === 'charge' ? 'battery-charging' : battery != null && battery < 30 ? 'battery-low' : 'battery'} className="fp-icon--s" />
      </Ring>
      <Num value={battery != null ? String(Math.round(battery)) : DASH} unit={battery != null ? '%' : undefined} size="m" />
    </div>
  ) : null;

  const presence = (label: string, present: boolean | null | undefined) =>
    present == null ? null : (
      <span className="inline-flex items-center gap-1.5">
        <Lamp tone={present ? 'ok' : 'headsup'} size="s" />
        <span className="fp-small">{`${label} ${present ? 'in' : 'out'}`}</span>
      </span>
    );
  const online = onlineStatus(status ? status.online : null);
  const dock = dockLamp(status);

  // ── Map editing (admin) ────────────────────────────────
  const modeBanner = isAdmin && (cleanMode || splitMode || mergeMode) ? (
    cleanMode ? (
      <Notice tone="info" title="Clean a room" action={<Button size="sm" onClick={exitCleanMode}>Cancel</Button>}>
        Tap a room on the map to clean just that room. You can pick suction and passes before it starts.
      </Notice>
    ) : splitMode ? (
      <Notice
        tone="headsup"
        title="Divide a room"
        action={
          <>
            <Button size="sm" variant="primary" disabled={!splitDraft || splitDraft.pts.length < 2} onClick={finishSplit}>Finish line</Button>
            <Button size="sm" disabled={!splitDraft} onClick={undoSplitPoint}>Undo corner</Button>
            <Button size="sm" variant="quiet" onClick={exitSplitMode}>Cancel divide</Button>
          </>
        }
      >
        Click across a room to drop corners: the first picks the room, and you can add as many bends as you like.
        Double-click or press Enter to finish; Backspace removes the last corner. Experimental, and not cleanly reversible.{' '}
        <span className="fp-strong">
          {splitDraft ? `${plural(splitDraft.pts.length, 'corner')} placed.` : 'No corners yet.'}
        </span>
      </Notice>
    ) : (
      <Notice
        tone="headsup"
        title="Merge rooms"
        action={
          <>
            <Button size="sm" variant="primary" disabled={mergeSelection.length < 2} onClick={finishMerge}>Merge selected</Button>
            <Button size="sm" disabled={mergeSelection.length === 0} onClick={() => setMergeSelection([])}>Clear</Button>
            <Button size="sm" variant="quiet" onClick={exitMergeMode}>Cancel merge</Button>
          </>
        }
      >
        Tap two or more rooms on the map to select them, then combine them into one. Experimental, and not cleanly
        reversible. <span className="fp-strong">{plural(mergeSelection.length, 'room')} selected.</span>
      </Notice>
    )
  ) : null;

  const instrument = (
    <div ref={mapRef} className="flex w-full flex-col gap-3">
      <RoombaMap
        map={mapQuery.data ?? null}
        loading={mapQuery.data === undefined && mapQuery.isLoading}
        error={mapQuery.isError && mapQuery.data === undefined}
        onRetry={() => void mapQuery.refetch()}
        retrying={mapQuery.isFetching}
        robotName={status?.name}
        aside={batteryRing}
        running={mapLive}
        editable={isAdmin}
        onSelectRoom={setSelectedRoom}
        splitMode={splitMode}
        splitDraft={splitDraft?.pts ?? null}
        splitRoomId={splitDraft?.roomId ?? null}
        onSplitAddPoint={addSplitPoint}
        onSplitFinish={finishSplit}
        onSplitUndo={undoSplitPoint}
        mergeMode={mergeMode}
        mergeSelection={mergeSelectionIds}
        onToggleMergeRoom={toggleMergeRoom}
        cleanMode={cleanMode}
        onSelectCleanRoom={handleSelectCleanRoom}
        lastClean={lastClean}
        lastSeen={lastSeenMark}
      />
      {modeBanner}
      {isAdmin && !modeBanner && mapQuery.data && cleanRooms.length > 0 && (
        <p className="fp-small fp-muted">Tap a room on the map to rename it.</p>
      )}
    </div>
  );

  return (
    <Screen>
      <InstrumentPanel
        className="min-[45rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[45rem]:items-start lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]"
        instrument={instrument}
        verdict={verdict}
        readouts={
          <Readouts count={2}>
            {firstReadout}
            <Readout label="Next clean" value={nextValue} unit={nextUnit} note={nextNote} />
          </Readouts>
        }
        foot={
          status ? (
            <>
              <span className="inline-flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                {presence('Bin', status.binPresent)}
                {presence('Tank', status.tankPresent)}
                {dock && (
                  <span className="inline-flex items-center gap-1.5">
                    <Lamp tone={dock.tone} size="s" />
                    <span className="fp-small">{dock.label}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Lamp tone={online.tone} size="s" />
                  <span className="fp-small">{online.label}</span>
                </span>
              </span>
              <span className="fp-mono">Checked in {formatStamp(status.updatedAt)}</span>
            </>
          ) : undefined
        }
      >
        {/* A refresh that failed while a reading is held: the reading stays, with a heads-up. */}
        {statusQuery.isError && statusQuery.data !== undefined && (
          <Notice
            tone="headsup"
            live="polite"
            title="Couldn't refresh the robot's status."
            action={<Button size="sm" icon="refresh" busy={statusQuery.isFetching} busyLabel="Trying again…" onClick={() => void statusQuery.refetch()}>Try again</Button>}
          >
            {`Showing what came in at ${formatTime(statusQuery.dataUpdatedAt)}.`}
          </Notice>
        )}
        {/* The robot's keys are for an admin only, exactly as before; everyone else sees why. */}
        {isAdmin ? (
          <RoombaControls state={state} onClean={() => setShowClean(true)} />
        ) : (
          <p className="fp-small fp-muted">Only an admin can start or stop the robot from here.</p>
        )}
      </InstrumentPanel>

      <Seg id="roomba-view" label="Roomba view" value={view} onChange={setView} options={VIEWS} />
      <SegPanel id="roomba-view" value={view}>
        {view === 'overview' ? (
          <Split>
            <Stack gap="page">
              <RecentCleans query={runsQuery} onOpen={setSelectedRun} now={now} />
              <Suspense fallback={<SkelPanel chart />}>
                <RoombaRunTimes query={runsQuery} cleaningNow={!!status && state.inMission} now={now} />
              </Suspense>
            </Stack>
            <Stack gap="page">
              <RoombaNativeSchedules isAdmin={isAdmin} />
              {cleanRooms.length > 0 && (
                <Panel
                  title="Rooms"
                  subtitle={`The ${plural(cleanRooms.length, 'room')} on the map`}
                  footer={
                    isAdmin ? (
                      <>
                        <span className="fp-small fp-muted">Change the map</span>
                        <span className="fp-cluster">
                          <Button size="sm" variant="quiet" onClick={() => (cleanMode ? exitCleanMode() : enterCleanMode())}>
                            {cleanMode ? 'Cancel clean' : 'Pick on the map'}
                          </Button>
                          <Button size="sm" variant="quiet" onClick={() => (splitMode ? exitSplitMode() : enterSplitMode())}>
                            {splitMode ? 'Cancel divide' : 'Divide a room'}
                          </Button>
                          <Button size="sm" variant="quiet" onClick={() => (mergeMode ? exitMergeMode() : enterMergeMode())}>
                            {mergeMode ? 'Cancel merge' : 'Merge rooms'}
                          </Button>
                        </span>
                      </>
                    ) : undefined
                  }
                >
                  <List>
                    {cleanRooms.map((r) => (
                      <Row
                        key={r.id}
                        compact
                        title={r.name ?? <span className="fp-muted italic">Unnamed room</span>}
                        meta={lastCleanedLine(r.name ? lastCleaned.get(r.name) : undefined, now)}
                        trail={
                          isAdmin ? (
                            <>
                              <IconButton icon="edit" variant="quiet" small label={r.name ? `Rename ${r.name}` : 'Name this room'} onClick={() => setSelectedRoom(r)} />
                              <Button size="sm" disabled={state.offline} onClick={() => setCleanRoom(r)}>
                                Clean<span className="fp-sr-only"> {r.name ?? 'this room'}</span>
                              </Button>
                            </>
                          ) : undefined
                        }
                      />
                    ))}
                  </List>
                </Panel>
              )}
            </Stack>
          </Split>
        ) : (
          <>
            <RoombaMaintenance
              parts={partsQuery.data ?? []}
              loading={partsQuery.isLoading}
              error={partsQuery.isError}
              onRetry={() => void partsQuery.refetch()}
              retrying={partsQuery.isFetching}
            />
            <RobotHealth status={status} device={device} />
          </>
        )}
      </SegPanel>

      {/* Admin room-rename dialog */}
      {isAdmin && selectedRoom && (
        <RoomRenameModal room={selectedRoom} onClose={() => setSelectedRoom(null)} />
      )}

      {/* Admin divide-a-room confirmation */}
      {isAdmin && pendingSplit && (
        <RoomSplitModal split={pendingSplit} onClose={() => setPendingSplit(null)} />
      )}

      {/* Admin merge-rooms confirmation */}
      {isAdmin && pendingMerge && (
        <RoomMergeModal rooms={pendingMerge} onClose={() => setPendingMerge(null)} />
      )}

      {/* Admin clean dialogs */}
      {isAdmin && showClean && (
        <CleanModal rooms={cleanRooms} onClose={() => setShowClean(false)} />
      )}
      {isAdmin && cleanRoom && (
        <RoomCleanModal room={cleanRoom} onClose={() => setCleanRoom(null)} />
      )}

      {/* Run detail */}
      {selectedRun && (
        <RoomRunDetailModal run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </Screen>
  );
});

// ── Recent cleans ─────────────────────────────────────────

function RunRow({ run, onOpen, now }: { run: RoombaRun; onOpen: (r: RoombaRun) => void; now: Date }) {
  const st = runStatus(run.status);
  // Cleaning time: the recharge stops and pauses are taken out (a whole-house run is ~3 h of
  // cleaning across ~6½ h); the detail dialog and the Time per clean chart have each part.
  const mins = cleaningMinutes(run);
  const rooms = run.verified ? roomsSummary(run.rooms) : null;
  return (
    <Row
      onClick={() => onOpen(run)}
      chevron
      // The row's name is its visible text (day, time, rooms, length, outcome), so two runs on
      // one day sound different (B-132).
      title={
        <>
          {formatDayName(run.startedAt, now)} <span className="fp-mono fp-muted ml-1 font-normal">{formatTime(run.startedAt)}</span>
        </>
      }
      meta={[rooms, formatDuration(mins)].filter(Boolean).join(' · ')}
      value={run.squareFeet != null ? formatNumber(run.squareFeet) : undefined}
      unit={run.squareFeet != null ? 'sq ft' : undefined}
      trail={run.status !== 'COMPLETED' ? <Badge status={st} /> : <span className="fp-sr-only">{st.label}</span>}
    />
  );
}

function RecentCleans({ query, onOpen, now }: {
  query: { data: RoombaRun[] | undefined; isError: boolean; isFetching: boolean; dataUpdatedAt: number; refetch: () => unknown };
  onOpen: (r: RoombaRun) => void;
  now: Date;
}) {
  const runs = query.data ?? [];
  const finished = runs.filter((r) => r.status === 'COMPLETED').length;
  return (
    <Panel
      title="Recent cleans"
      subtitle={runs.length ? `${finished} of the last ${runs.length} finished. Tap one for the details` : undefined}
    >
      <QueryState
        query={query}
        what="the recent cleans"
        loading={<SkelRows count={4} />}
        empty={
          <EmptyState icon="history" title="No cleans yet">
            Each clean shows here once it ends, with how long it took, the area and how it went.
          </EmptyState>
        }
      >
        {(list) => (
          <>
            <List>
              {list.slice(0, RUNS_SHOWN).map((r) => <RunRow key={r.id} run={r} onOpen={onOpen} now={now} />)}
            </List>
            {list.length > RUNS_SHOWN && (
              <Disclosure
                variant="row"
                summary={`Show ${plural(list.length - RUNS_SHOWN, 'more clean')}`}
                openSummary="Show fewer cleans"
              >
                <List>
                  {list.slice(RUNS_SHOWN).map((r) => <RunRow key={r.id} run={r} onOpen={onOpen} now={now} />)}
                </List>
              </Disclosure>
            )}
          </>
        )}
      </QueryState>
    </Panel>
  );
}

// ── Robot health (Maintenance view) ───────────────────────

const WEAR_SHOWN = new Set(['nStuck', 'nCliffsF', 'nPicks', 'nCliffsR', 'nMBStll', 'nWStll']);

function RobotHealth({ status, device }: { status: RoombaStatus | null; device: { family: string | null; sku: string | null; series: string | null; firmware: string | null; serialNumber: string | null } | null }) {
  if (!status) {
    return (
      <Panel title="Robot health">
        <EmptyState compact icon="robot" title="No readings yet">The robot's counters show here once it has checked in.</EmptyState>
      </Panel>
    );
  }
  const w = status.wear ?? {};
  const times = (n: number | undefined) => (n == null ? null : n === 0 ? 'Never' : plural(n, 'time'));
  const model = device ? [device.family || device.sku, device.series && `series ${device.series}`].filter(Boolean).join(', ') : '';
  const otherWear = Object.entries(w).filter(([k]) => !WEAR_SHOWN.has(k));
  const stalls = w.nMBStll != null || w.nWStll != null ? `${w.nMBStll ?? 0} main, ${w.nWStll ?? 0} wheel` : null;
  return (
    <Panel title="Robot health" subtitle="The robot's own lifetime counters">
      <KeyValue cols>
        {/* Lifetime figures straight from the robot; a missing counter is a dash, never the
            length of the history list (B-128). Powered-on time is named the same everywhere (B-129). */}
        <KV label="Cleans" value={status.lifetimeMissions != null ? formatNumber(status.lifetimeMissions) : DASH} />
        <KV label="Powered on" value={status.lifetimeRunMinutes != null ? formatNumber(Math.round(status.lifetimeRunMinutes / 60), { unit: 'hr' }) : DASH} />
        {status.chargeCycles != null && <KV label="Battery charge cycles" value={formatNumber(status.chargeCycles)} />}
        {status.chargeErrors != null && (
          <KV label="Charging faults" value={status.chargeErrors > 0 ? formatNumber(status.chargeErrors) : 'None'} tone={status.chargeErrors > 0 ? 'headsup' : undefined} />
        )}
        {times(w.nStuck) && <KV label="Got stuck" value={times(w.nStuck)} />}
        {times(w.nCliffsF) && <KV label="Stopped at a ledge" value={times(w.nCliffsF)} />}
        {times(w.nPicks) && <KV label="Picked up mid-clean" value={times(w.nPicks)} />}
        {status.detectedPad && <KV label="Mop mount" value={padLabel(status.detectedPad)} />}
      </KeyValue>
      <Disclosure variant="row" summary="For the curious" openSummary="Hide the details">
        <KeyValue cols>
          {model && <KV label="Model" value={model} />}
          {device?.firmware && <KV label="Firmware" value={device.firmware} mono />}
          {device?.serialNumber && <KV label="Serial number" value={<span className="fp-code whitespace-normal break-all">{device.serialNumber}</span>} />}
          {status.mapVersion && <KV label="Map version" value={status.mapVersion} mono />}
          {times(w.nCliffsR) && <KV label="Rear ledge stops" value={times(w.nCliffsR)} />}
          {stalls && <KV label="Brush stalls" value={stalls} />}
          {otherWear.map(([k, n]) => <KV key={k} label={humanize(k.replace(/^n(?=[A-Z])/, ''))} value={formatNumber(n)} />)}
        </KeyValue>
      </Disclosure>
    </Panel>
  );
}
