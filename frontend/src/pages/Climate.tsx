import { memo, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import ThermostatCard from '../components/ThermostatCard';
import ThermostatHistoryChart, { type HistoryRange } from '../components/ThermostatHistoryChart';
import { discoverHomeDevices, errorMessage, errorStatus, fetchThermostatHistory, fetchThermostats } from '../api/climate';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../components/shell/PageMeta';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  QueryState,
  Screen,
  Seg,
  SegPanel,
  SkelInstrumentPanel,
  SkelPanel,
  useSearchParamState,
} from '../components/ui';
import { formatTime } from '../utils/format';
import { formatTemp, unitSymbol } from '../utils/thermostat';
import { staleReason } from '../utils/cameras';
import type { Thermostat, ThermostatReading } from '../types';

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

  usePageMeta({ subtitle: thermostatsQuery.dataUpdatedAt ? `Updated ${formatTime(thermostatsQuery.dataUpdatedAt)}` : undefined });

  // The thermostat on screen lives in the URL (?thermostat=…), so a reload or the sleep screen
  // comes back to it.
  const ids = useMemo(() => thermostats.map((t) => t.id), [thermostats]);
  const [selectedParam, setSelected] = useSearchParamState('thermostat', ids, ids[0] ?? '');
  const selectedId = selectedParam || ids[0] || '';

  // combine keeps the merged result referentially stable between renders, so
  // the chart's memo only recomputes when a history query actually changes.
  const combineHistory = useCallback(
    (results: UseQueryResult<ThermostatReading[]>[]) => {
      const byId: Record<string, ThermostatReading[] | undefined> = {};
      const failed: Record<string, boolean> = {};
      thermostats.forEach((t, i) => {
        byId[t.id] = results[i]?.data;
        failed[t.id] = !!results[i]?.isError;
      });
      return {
        history: byId,
        failed,
        fetching: results.some((r) => r.isFetching),
        refetch: () => results.forEach((r) => r.isError && void r.refetch()),
      };
    },
    [thermostats],
  );
  const history = useQueries({
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

  // QueryState draws loading, the first-load error and the empty state; a failed refresh is
  // said here instead, with the reason (B-103), so the generic notice is turned off.
  const held = { ...thermostatsQuery, isError: thermostatsQuery.isError && thermostatsQuery.data === undefined };
  const firstError = errorStatus(thermostatsQuery.error) === 503 ? (
    <ErrorState
      title="Home Assistant isn't connected"
      onRetry={() => void thermostatsQuery.refetch()}
      retrying={thermostatsQuery.isFetching}
    >
      The thermostats come through Home Assistant, which isn't reachable right now.
      {isAdmin && ' Check the homeassistant container and the HA_* settings in .env.'}
    </ErrorState>
  ) : (
    <ErrorState title="Couldn't load the thermostats" onRetry={() => void thermostatsQuery.refetch()} retrying={thermostatsQuery.isFetching}>
      {errorMessage(thermostatsQuery.error)}
    </ErrorState>
  );

  return (
    <Screen>
      <QueryState
        query={held}
        what="the thermostats"
        error={firstError}
        loading={
          <div className="fp-stack fp-stack--page">
            <SkelInstrumentPanel readouts={2} />
            <SkelPanel chart />
          </div>
        }
        empty={
          <EmptyState
            icon="thermometer"
            title="No thermostats yet"
            action={
              isAdmin ? (
                <Button icon="search" busy={discover.isPending} busyLabel="Looking…" onClick={() => discover.mutate()}>
                  Look for thermostats
                </Button>
              ) : undefined
            }
          >
            {/* B-100: a search that finds nothing says so, instead of quietly resetting the key. */}
            {discover.isError
              ? errorMessage(discover.error)
              : discover.isSuccess && !thermostatsQuery.isFetching
                ? 'The search found no thermostats. Check the ecobee integration in Home Assistant.'
                : 'Home Assistant is connected, but no thermostats have been found yet.'}
          </EmptyState>
        }
      >
        {(list: Thermostat[]) => {
          const t = list.find((x) => x.id === selectedId) ?? list[0];
          return (
            <>
              {thermostatsQuery.isError && (
                <Notice
                  tone="headsup"
                  live="polite"
                  title={staleReason(thermostatsQuery.error, thermostatsQuery.dataUpdatedAt)}
                  action={
                    <Button size="sm" icon="refresh" busy={thermostatsQuery.isFetching} busyLabel="Trying again…" onClick={() => void thermostatsQuery.refetch()}>
                      Try again
                    </Button>
                  }
                />
              )}
              {list.length > 1 && (
                <Seg
                  id="climate-thermostat"
                  label="Thermostat"
                  value={t.id}
                  onChange={setSelected}
                  options={list.map((x) => ({
                    value: x.id,
                    label: (
                      <>
                        {x.name}
                        <span className="ml-2 font-medium tabular-nums">{formatTemp(x.temperature)}°</span>
                      </>
                    ),
                  }))}
                />
              )}
              {list.length > 1 ? (
                <SegPanel id="climate-thermostat" value={t.id}>
                  <ThermostatCard key={t.id} thermostat={t} canControl={canControl} currentUserId={user?.userId} />
                </SegPanel>
              ) : (
                <ThermostatCard key={t.id} thermostat={t} canControl={canControl} currentUserId={user?.userId} />
              )}
              <ThermostatHistoryChart
                thermostats={list}
                selectedId={t.id}
                history={history.history}
                failed={history.failed}
                onRetry={history.refetch}
                retrying={history.fetching}
                range={range}
                onRangeChange={setRange}
                unit={unitSymbol(t.temperatureUnit)}
              />
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
});
