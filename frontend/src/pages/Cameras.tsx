import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import CameraTile from '../components/CameraTile';
import CameraBatteryChart, { type BatteryRange } from '../components/CameraBatteryChart';
import { fetchCameraBattery, fetchCameras } from '../api/cameras';
import { discoverHomeDevices, errorMessage, errorStatus } from '../api/climate';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { useIdle, usePageVisible } from '../hooks/useViewerPresence';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../components/shell/PageMeta';
import {
  Button,
  Disclosure,
  EmptyState,
  ErrorState,
  InstrumentPanel,
  KV,
  KeyValue,
  List,
  Notice,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Row,
  Screen,
  Seg,
  SegPanel,
  SkelInstrumentPanel,
  SkelRows,
  Verdict,
  useSearchParamState,
} from '../components/ui';
import { BATTERY_LIVE_BUDGET_MS, IDLE_STOP_MS, batteryLampTone, chargeState, latestEvent, staleReason } from '../utils/cameras';
import { formatDuration, formatList, formatStamp, formatTime, toInstant } from '../utils/format';
import { worstTone, type Tone } from '../utils/status';
import type { Camera, CameraBatteryHistory } from '../types';

const CameraRecordings = lazy(() => import('../components/CameraRecordings'));

const VIEWS = [
  { value: 'live', label: 'Live', icon: 'video' },
  { value: 'recordings', label: 'Recordings', icon: 'history' },
] as const;
type CamerasView = (typeof VIEWS)[number]['value'];
const VIEW_KEY = 'cameras-view';

function storedView(): CamerasView | null {
  try {
    return localStorage.getItem(VIEW_KEY) === 'recordings' ? 'recordings' : null;
  } catch {
    return null;
  }
}

/** The newest motion or person event across the cameras, for the verdict. */
function newestEvent(cameras: Camera[]): { camera: Camera; kind: 'person' | 'motion'; at: string } | null {
  let best: { camera: Camera; kind: 'person' | 'motion'; at: string; ms: number } | null = null;
  for (const c of cameras) {
    const e = latestEvent(c);
    const ms = e ? toInstant(e.at) : null;
    if (e && ms != null && (!best || ms > best.ms)) best = { camera: c, ...e, ms };
  }
  return best;
}

interface Attention {
  key: string;
  tone: Tone;
  title: string;
  meta: string;
}

/** What needs a look: a battery on the alert thresholds (not while charging), a camera that's offline. */
function attentionFor(cameras: Camera[]): Attention[] {
  const out: Attention[] = [];
  for (const c of cameras) {
    if (!c.available) {
      out.push({
        key: `${c.id}-off`,
        tone: 'headsup',
        title: `${c.name} camera is offline`,
        meta: c.lastSeenAt ? `No picture since ${formatStamp(c.lastSeenAt)}` : 'Check that it has power and Wi-Fi',
      });
    }
    if (c.powerSource === 'battery' && c.batteryPercent != null) {
      const tone = batteryLampTone(c.batteryPercent, c.charging === true);
      if (tone === 'headsup' || tone === 'problem') {
        out.push({
          key: `${c.id}-bat`,
          tone,
          title: `${c.name} battery is at ${Math.round(c.batteryPercent)}%`,
          meta: tone === 'problem' ? 'Charge it today' : 'Charge it in the next few days',
        });
      }
    }
  }
  return out;
}

export default memo(function Cameras() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const { idle, wake } = useIdle(IDLE_STOP_MS);
  const [ranges, setRanges] = useState<Record<string, BatteryRange>>({});

  // Live / Recordings lives in the URL (?view=recordings: a reload, Back or the sleep screen
  // come back to it). A visit without one still opens on the view used last.
  const [view, setViewParam] = useSearchParamState('view', ['live', 'recordings'] as const, 'live');
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (view === 'live' && storedView() === 'recordings') setViewParam('recordings');
  }, [view, setViewParam]);
  const setView = useCallback(
    (v: CamerasView) => {
      setViewParam(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {
        /* private mode — just don't remember */
      }
    },
    [setViewParam],
  );

  const camerasInterval = useJitteredInterval(30_000, 5_000);
  const batteryInterval = useJitteredInterval(300_000, 30_000);

  const camerasQuery = useQuery({
    queryKey: ['cameras'],
    queryFn: fetchCameras,
    staleTime: 20_000,
    refetchInterval: camerasInterval,
    refetchIntervalInBackground: false,
    retry: (count, err) => errorStatus(err) !== 503 && count < 1,
  });
  const cameras = useMemo(() => camerasQuery.data ?? [], [camerasQuery.data]);
  const batteryCameras = useMemo(() => cameras.filter((c) => c.powerSource === 'battery'), [cameras]);

  usePageMeta({ subtitle: camerasQuery.dataUpdatedAt ? `Updated ${formatTime(camerasQuery.dataUpdatedAt)}` : undefined });

  const combineBattery = useCallback(
    (results: UseQueryResult<CameraBatteryHistory>[]) => {
      const byId: Record<string, { data?: CameraBatteryHistory; loading: boolean; failed: boolean; refetch: () => void }> = {};
      batteryCameras.forEach((c, i) => {
        const r = results[i];
        byId[c.id] = { data: r?.data, loading: !!r?.isLoading, failed: !!r?.isError, refetch: () => void r?.refetch() };
      });
      return byId;
    },
    [batteryCameras],
  );
  const battery = useQueries({
    queries: batteryCameras.map((c) => {
      const range = ranges[c.id] ?? 24;
      return {
        queryKey: ['camera-battery', c.id, range],
        queryFn: () => fetchCameraBattery(c.id, range),
        staleTime: 60_000,
        refetchInterval: batteryInterval,
        refetchIntervalInBackground: false,
      };
    }),
    combine: combineBattery,
  });

  const discover = useMutation({
    mutationFn: discoverHomeDevices,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });

  // The camera in the answer: the one that saw something last when the page opened. Chosen
  // once per visit, so a new event elsewhere never moves a live picture (moving it would
  // remount its tile and restart its stream).
  const featuredId = useRef<string | null>(null);
  if (cameras.length && !cameras.some((c) => c.id === featuredId.current)) {
    featuredId.current = (newestEvent(cameras)?.camera ?? cameras[0]).id;
  }
  const featured = cameras.find((c) => c.id === featuredId.current) ?? null;
  const others = cameras.filter((c) => c !== featured);

  const tile = (c: Camera) => (
    <CameraTile
      key={c.id}
      camera={c}
      pageVisible={pageVisible}
      idle={idle}
      onWake={wake}
      charge={chargeState(c, battery[c.id]?.data?.readings)}
    />
  );

  // QueryState draws loading, the first-load error and the empty state; a failed refresh is
  // said in the live view with its reason (B-103), so the generic notice is turned off.
  const held = { ...camerasQuery, isError: camerasQuery.isError && camerasQuery.data === undefined };
  const firstError = errorStatus(camerasQuery.error) === 503 ? (
    <ErrorState title="Home Assistant isn't connected" onRetry={() => void camerasQuery.refetch()} retrying={camerasQuery.isFetching}>
      The cameras come through Home Assistant, which isn't reachable right now.
      {isAdmin && ' Check the homeassistant container and the HA_* settings in .env.'}
    </ErrorState>
  ) : (
    <ErrorState title="Couldn't load the cameras" onRetry={() => void camerasQuery.refetch()} retrying={camerasQuery.isFetching}>
      {errorMessage(camerasQuery.error)}
    </ErrorState>
  );

  const discoverKey = isAdmin ? (
    <Button size="sm" icon="search" busy={discover.isPending} busyLabel="Looking…" onClick={() => discover.mutate()}>
      Look for new cameras
    </Button>
  ) : undefined;

  const event = newestEvent(cameras);
  const attention = attentionFor(cameras);
  const online = cameras.filter((c) => c.available).length;
  const verdictTone: Tone = attention.length ? worstTone(attention.map((a) => a.tone)) : 'ok';
  // "at 4:58 PM" today; "Yesterday, 3:44 PM" or "Sat, 10:10 PM" before that.
  const when = (at: string) => (/^\d/.test(formatStamp(at)) ? `at ${formatStamp(at)}` : formatStamp(at));
  const verdictText = event
    ? `${event.kind === 'person' ? 'Someone was seen by' : 'Motion on'} the ${event.camera.name} camera ${when(event.at)}.`
    : 'Nothing has moved in front of the cameras lately.';
  const otherEvents = cameras
    .filter((c) => c !== event?.camera)
    .map((c) => ({ c, e: latestEvent(c) }))
    .filter((x): x is { c: Camera; e: NonNullable<ReturnType<typeof latestEvent>> } => x.e != null)
    .map((x) => `${x.c.name} at ${formatStamp(x.e.at)}`);
  const verdictNote = attention.length
    ? `${attention.length === 1 ? 'One thing needs' : `${attention.length} things need`} a look below.`
    : otherEvents.length
      ? `Also: ${formatList(otherEvents.slice(0, 2))}.`
      : 'Every camera is online.';

  return (
    <Screen>
      <QueryState
        query={held}
        what="the cameras"
        error={firstError}
        loading={<SkelInstrumentPanel readouts={2} />}
        empty={
          <EmptyState icon="camera" title="No cameras yet" action={discoverKey}>
            {/* B-100: a search that finds nothing says so, instead of quietly resetting the key. */}
            {discover.isError
              ? errorMessage(discover.error)
              : discover.isSuccess && !camerasQuery.isFetching
                ? 'The search found no cameras. Check the eufy-sdk integration in Home Assistant.'
                : `Home Assistant is connected, but no cameras have been found yet.${isAdmin ? ' Add the eufy-sdk integration in Home Assistant (host eufy-bridge, port 3000), then look again.' : ''}`}
          </EmptyState>
        }
      >
        {() => (
          <>
            <Seg id="cameras-view" label="Cameras view" value={view} onChange={setView} options={VIEWS} />
            <SegPanel id="cameras-view" value={view}>
              {view === 'recordings' ? (
                // Recordings replace the live tiles rather than sit under them: switching away
                // unmounts every tile, which stops its stream.
                <Suspense fallback={<SkelRows count={4} />}>
                  <CameraRecordings />
                </Suspense>
              ) : (
                <>
                  {camerasQuery.isError && (
                    <Notice
                      tone="headsup"
                      live="polite"
                      title={staleReason(camerasQuery.error, camerasQuery.dataUpdatedAt)}
                      action={
                        <Button size="sm" icon="refresh" busy={camerasQuery.isFetching} busyLabel="Trying again…" onClick={() => void camerasQuery.refetch()}>
                          Try again
                        </Button>
                      }
                    />
                  )}
                  <InstrumentPanel
                    className="lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] min-[45rem]:items-start"
                    instrument={featured ? <div className="w-full self-stretch">{tile(featured)}</div> : null}
                    verdict={<Verdict tone={verdictTone} note={verdictNote}>{verdictText}</Verdict>}
                    readouts={
                      <Readouts count={2}>
                        <Readout
                          label="Online"
                          value={`${online}`}
                          unit={`of ${cameras.length}`}
                          tone={online === cameras.length ? 'ok' : 'headsup'}
                          note={online === cameras.length ? 'Every camera' : `${cameras.length - online} offline`}
                        />
                        <Readout
                          label="Last activity"
                          value={event ? formatStamp(event.at) : '—'}
                          note={event ? `${event.kind === 'person' ? 'Person' : 'Motion'}, ${event.camera.name}` : 'Nothing recent'}
                        />
                      </Readouts>
                    }
                    foot={
                      <>
                        <span className="fp-mono">Live when you open this page</span>
                        <span className="fp-mono">Battery cameras pause after {formatDuration(BATTERY_LIVE_BUDGET_MS / 60_000)}</span>
                      </>
                    }
                  >
                    {attention.length > 0 && (
                      <List inset aria-label="Needs a look">
                        {attention.map((a) => (
                          <Row key={a.key} compact lamp={a.tone} title={a.title} meta={a.meta} />
                        ))}
                      </List>
                    )}
                  </InstrumentPanel>

                  {others.length > 0 && (
                    <Panel
                      title={featured ? 'Other cameras' : 'Cameras'}
                      subtitle="Battery cameras pause after 5 minutes to save power. Tap play to wake one"
                    >
                      <div className="fp-grid-3 gap-y-7">{others.map(tile)}</div>
                    </Panel>
                  )}

                  {batteryCameras.length > 0 && (
                    <Panel title="Battery and solar" subtitle="How each battery camera is holding up">
                      <div className="fp-stack fp-stack--l">
                        {batteryCameras.map((c, i) => (
                          <div key={c.id} className={i > 0 ? 'border-t border-appborder pt-6' : undefined}>
                            <CameraBatteryChart
                              camera={c}
                              history={battery[c.id]?.data}
                              loading={!!battery[c.id]?.loading}
                              failed={!!battery[c.id]?.failed}
                              onRetry={() => battery[c.id]?.refetch()}
                              range={ranges[c.id] ?? 24}
                              onRangeChange={(r) => setRanges((prev) => ({ ...prev, [c.id]: r }))}
                              charge={chargeState(c, battery[c.id]?.data?.readings)}
                            />
                          </div>
                        ))}
                      </div>
                    </Panel>
                  )}

                  <Panel flush>
                    <Disclosure variant="row" summary="For the curious: how live view works" openSummary="How live view works">
                      <div className="fp-stack">
                        <KeyValue>
                          <KV label="Live pictures" value="Stop when you leave the page" />
                          <KV label="Battery cameras" value={`Pause after ${formatDuration(BATTERY_LIVE_BUDGET_MS / 60_000)} live`} />
                          <KV label="Nobody watching" value={`Everything stops after ${formatDuration(IDLE_STOP_MS / 60_000)}`} />
                          <KV label="Recordings" value="Stored on the eufy HomeBase, at home" />
                        </KeyValue>
                      </div>
                    </Disclosure>
                  </Panel>
                </>
              )}
            </SegPanel>
          </>
        )}
      </QueryState>
    </Screen>
  );
});
