import { memo, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import CameraTile from '../components/CameraTile';
import CameraBatteryChart, { type BatteryRange } from '../components/CameraBatteryChart';
import { fetchCameraBattery, fetchCameras } from '../api/cameras';
import { discoverHomeDevices, errorMessage, errorStatus } from '../api/climate';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { useIdle, usePageVisible } from '../hooks/useViewerPresence';
import { useAuth } from '../context/AuthContext';
import { FOCUS_RING } from '../components/ThermostatControls';
import { IDLE_STOP_MS, chargeState } from '../utils/cameras';
import type { CameraBatteryHistory } from '../types';

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-dashed border-appborder bg-appsurface-raised p-8 text-center">
      <p className="text-3xl">📷</p>
      <h3 className="mt-3 text-lg font-semibold text-apptext">{title}</h3>
      <div className="mt-2 text-sm text-apptext-muted">{children}</div>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-appborder bg-appsurface-raised">
      <div className="aspect-video animate-pulse bg-appinset" />
      <div className="px-4 py-3">
        <div className="h-4 w-32 rounded bg-appinset" />
      </div>
    </div>
  );
}

export default memo(function Cameras() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const pageVisible = usePageVisible();
  const { idle, wake } = useIdle(IDLE_STOP_MS);
  const [ranges, setRanges] = useState<Record<string, BatteryRange>>({});

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

  const combineBattery = useCallback(
    (results: UseQueryResult<CameraBatteryHistory>[]) => {
      const byId: Record<string, { data?: CameraBatteryHistory; loading: boolean }> = {};
      batteryCameras.forEach((c, i) => {
        byId[c.id] = { data: results[i]?.data, loading: !!results[i]?.isLoading };
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

  if (camerasQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TileSkeleton />
        <TileSkeleton />
      </div>
    );
  }

  const retryButton = (
    <button
      type="button"
      onClick={() => camerasQuery.refetch()}
      disabled={camerasQuery.isFetching}
      className={`mt-4 h-11 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 text-sm font-semibold text-apptext transition-colors hover:bg-appaccent/20 disabled:opacity-50 ${FOCUS_RING}`}
    >
      {camerasQuery.isFetching ? 'Retrying…' : 'Retry'}
    </button>
  );

  if (camerasQuery.isError && !camerasQuery.data) {
    return errorStatus(camerasQuery.error) === 503 ? (
      <Notice title="Home Assistant isn't connected">
        <p>
          The cameras come through Home Assistant, which isn't reachable right now.
          {isAdmin && ' Check the homeassistant container and the HA_* settings in .env.'}
        </p>
        {retryButton}
      </Notice>
    ) : (
      <Notice title="Couldn't load cameras">
        <p>{errorMessage(camerasQuery.error)}</p>
        {retryButton}
      </Notice>
    );
  }

  if (!cameras.length) {
    return (
      <Notice title="No cameras yet">
        <p>
          Home Assistant is connected, but no cameras have been found.
          {isAdmin && ' Add the eufy-sdk integration in Home Assistant (host eufy-bridge, port 3000), then discover.'}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => discover.mutate()}
            disabled={discover.isPending}
            className={`mt-4 h-11 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 text-sm font-semibold text-apptext transition-colors hover:bg-appaccent/20 disabled:opacity-50 ${FOCUS_RING}`}
          >
            {discover.isPending ? 'Discovering…' : 'Discover devices'}
          </button>
        )}
        {discover.isError && <p className="mt-2 text-rose-300">{errorMessage(discover.error)}</p>}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {camerasQuery.isError && (
        <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-400">
          Can't reach Home Assistant — showing the last known state.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {cameras.map((c) => (
          <CameraTile
            key={c.id}
            camera={c}
            pageVisible={pageVisible}
            idle={idle}
            onWake={wake}
            charge={chargeState(c, battery[c.id]?.data?.readings)}
          />
        ))}
      </div>

      {batteryCameras.map((c) => (
        <CameraBatteryChart
          key={c.id}
          camera={c}
          history={battery[c.id]?.data}
          loading={!!battery[c.id]?.loading}
          range={ranges[c.id] ?? 24}
          onRangeChange={(r) => setRanges((prev) => ({ ...prev, [c.id]: r }))}
          charge={chargeState(c, battery[c.id]?.data?.readings)}
        />
      ))}
    </div>
  );
});
