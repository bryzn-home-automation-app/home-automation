import { memo, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import ThermostatCard from '../components/ThermostatCard';
import ThermostatHistoryChart, { type HistoryRange } from '../components/ThermostatHistoryChart';
import { discoverHomeDevices, errorMessage, errorStatus, fetchThermostatHistory, fetchThermostats } from '../api/climate';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { useAuth } from '../context/AuthContext';
import { FOCUS_RING } from '../components/ThermostatControls';
import { formatTemp, statusChip, unitSymbol } from '../utils/thermostat';
import type { ThermostatReading } from '../types';

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-dashed border-appborder bg-appsurface-raised p-8 text-center">
      <p className="text-3xl">🌡️</p>
      <h3 className="mt-3 text-lg font-semibold text-apptext">{title}</h3>
      <div className="mt-2 text-sm text-apptext-muted">{children}</div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-[24px] border border-appborder bg-appsurface-raised p-5">
      <div className="mb-6 h-5 w-32 rounded bg-appinset" />
      <div className="mb-6 h-12 w-40 rounded bg-appinset" />
      <div className="h-24 rounded-2xl bg-appinset" />
    </div>
  );
}

export default memo(function Climate() {
  const { user, isAdmin } = useAuth();
  const canControl = !!user && user.role !== 'GUEST';
  const queryClient = useQueryClient();
  const [range, setRange] = useState<HistoryRange>(24);

  const thermostatsInterval = useJitteredInterval(30_000, 5_000);
  const historyInterval = useJitteredInterval(300_000, 30_000);

  const thermostatsQuery = useQuery({
    queryKey: ['thermostats'],
    queryFn: fetchThermostats,
    staleTime: 20_000,
    refetchInterval: thermostatsInterval,
    refetchIntervalInBackground: false,
    // 503 = HA off/unreachable; retrying just delays the "not connected" notice.
    retry: (count, err) => errorStatus(err) !== 503 && count < 1,
  });
  const thermostats = useMemo(() => thermostatsQuery.data ?? [], [thermostatsQuery.data]);

  // combine keeps the merged result referentially stable between renders, so
  // the chart's memo only recomputes when a history query actually changes.
  const combineHistory = useCallback(
    (results: UseQueryResult<ThermostatReading[]>[]) => {
      const byId: Record<string, ThermostatReading[] | undefined> = {};
      thermostats.forEach((t, i) => {
        byId[t.id] = results[i]?.data;
      });
      return { history: byId, historyLoading: results.some((r) => r.isLoading) };
    },
    [thermostats],
  );
  const { history, historyLoading } = useQueries({
    queries: thermostats.map((t) => ({
      queryKey: ['thermostat-history', t.id, range],
      queryFn: () => fetchThermostatHistory(t.id, range),
      staleTime: 60_000,
      refetchInterval: historyInterval,
      refetchIntervalInBackground: false,
    })),
    combine: combineHistory,
  });

  const discover = useMutation({
    mutationFn: discoverHomeDevices,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['thermostats'] }),
  });

  if (thermostatsQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const retryButton = (
    <button
      type="button"
      onClick={() => thermostatsQuery.refetch()}
      disabled={thermostatsQuery.isFetching}
      className={`mt-4 h-11 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 text-sm font-semibold text-apptext transition-colors hover:bg-appaccent/20 disabled:opacity-50 ${FOCUS_RING}`}
    >
      {thermostatsQuery.isFetching ? 'Retrying…' : 'Retry'}
    </button>
  );

  // Only a failure with nothing to show replaces the page; a failed background
  // refresh keeps the last data and shows a slim banner instead.
  if (thermostatsQuery.isError && !thermostatsQuery.data) {
    const status = errorStatus(thermostatsQuery.error);
    return status === 503 ? (
      <Notice title="Home Assistant isn't connected">
        <p>
          The thermostats come through Home Assistant, which isn't reachable right now.
          {isAdmin && ' Check the homeassistant container and the HA_* settings in .env.'}
        </p>
        {retryButton}
      </Notice>
    ) : (
      <Notice title="Couldn't load thermostats">
        <p>{errorMessage(thermostatsQuery.error)}</p>
        {retryButton}
      </Notice>
    );
  }

  if (!thermostats.length) {
    return (
      <Notice title="No thermostats yet">
        <p>Home Assistant is connected, but no thermostats have been found.</p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => discover.mutate()}
            disabled={discover.isPending}
            className="mt-4 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 py-2 text-sm font-semibold text-apptext transition-colors hover:bg-appaccent/20 disabled:opacity-50"
          >
            {discover.isPending ? 'Discovering…' : 'Discover devices'}
          </button>
        )}
        {discover.isError && <p className="mt-2 text-rose-300">{errorMessage(discover.error)}</p>}
      </Notice>
    );
  }

  const lastGood = thermostatsQuery.dataUpdatedAt
    ? new Date(thermostatsQuery.dataUpdatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {thermostatsQuery.isError && (
        <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-400">
          Can't reach Home Assistant{lastGood ? ` — showing data from ${lastGood}` : ''}.
        </div>
      )}

      {/* Phone: each card is tall, so later floors sit below the fold — a
          compact strip shows all of them at a glance and jumps to each. */}
      {thermostats.length > 1 && (
        <nav aria-label="Thermostats" className="grid grid-cols-2 gap-2 lg:hidden">
          {thermostats.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                document.getElementById(`thermostat-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className={`min-h-11 rounded-2xl border border-appborder bg-appsurface-raised px-3 py-2 text-left transition-colors hover:border-appborder-hover ${FOCUS_RING}`}
            >
              <span className="block truncate text-xs font-semibold text-apptext">
                {t.name} {formatTemp(t.temperature)}°
              </span>
              <span className="block truncate text-3xs text-apptext-muted">{statusChip(t).text}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {thermostats.map((t) => (
          <ThermostatCard key={t.id} thermostat={t} canControl={canControl} currentUserId={user?.userId} />
        ))}
      </div>
      <ThermostatHistoryChart
        thermostats={thermostats}
        history={history}
        range={range}
        onRangeChange={setRange}
        loading={historyLoading}
        unit={unitSymbol(thermostats[0]?.temperatureUnit)}
      />
    </div>
  );
});
