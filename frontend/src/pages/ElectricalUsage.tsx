import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import { getUsageLevel } from '../utils/usageColor';
import DeferredRender from '../components/DeferredRender';
import VirtualizedList from '../components/VirtualizedList';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import { fetchUsageSummary } from '../api/energy';
import { buildUsagePeriods, createEmptyUsageSummary } from '../utils/usageSummary';

export default function ElectricalUsage() {
  const { electricUsage, electricTotal, electricMeter, config } = useUsageData();

  const data = electricUsage.data ?? [];
  const loading = electricUsage.isLoading;
  const monthKwh = electricTotal.data?.totalKwh ?? 0;
  const kwhRate = config.data?.kwhRate ?? 0.1171;

  const today = new Date().toISOString().split('T')[0];
  const realData = useMemo(
    () => data.filter((d) => d.usageKwh > 0),
    [data]
  );

  const chartData = useMemo(
    () =>
      [...realData].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() -
          new Date(b.timestamp).getTime()
      ),
    [realData]
  );

  const tableData = useMemo(
    () =>
      [...realData]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() -
            new Date(a.timestamp).getTime()
        )
        .slice(0, 30),
    [realData]
  );

  const todayKwh = useMemo(
    () =>
      realData
        .filter((d) => d.timestamp.startsWith(today))
        .reduce((sum, d) => sum + d.usageKwh, 0),
    [realData, today]
  );

  const avg7 = useMemo(() => {
    const last7 = realData.filter(
      (d) =>
        new Date(d.timestamp) >
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    return last7.length > 0
      ? last7.reduce((sum, d) => sum + d.usageKwh, 0) / last7.length
      : 0;
  }, [realData]);

  const avg30 = useMemo(() => {
    const last30 = realData.filter(
      (d) =>
        new Date(d.timestamp) >
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    );
    return last30.length > 0
      ? last30.reduce((sum, d) => sum + d.usageKwh, 0) / last30.length
      : 0;
  }, [realData]);

  const periodDefinitions = useMemo(
    () => buildUsagePeriods(config.data?.dataStartDate),
    [config.data?.dataStartDate]
  );

  const summaryQueries = useQueries({
    queries: periodDefinitions.map((period) => ({
      queryKey: ['usage-summary', electricMeter?.id, period.key, period.start, period.end],
      queryFn: () =>
        electricMeter
          ? fetchUsageSummary(electricMeter.id, period.start, period.end)
          : Promise.resolve(createEmptyUsageSummary(0, period.start, period.end)),
      enabled: !!electricMeter,
      staleTime: 300_000,
    })),
  });

  const summaryCards = periodDefinitions.map((period, index) => ({
    label: period.label,
    rangeStart: period.displayStart,
    rangeEnd: period.displayEnd,
    summary:
      summaryQueries[index]?.data ??
      createEmptyUsageSummary(electricMeter?.id ?? 0, period.start, period.end),
  }));

  const summaryLoading = summaryQueries.some((query) => query.isLoading);

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Electric Module
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Daily electricity usage with quick cost context.
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Compare recent consumption patterns, track short-term averages, and scan the latest readings without leaving the dashboard workflow.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Estimated 60-Day Cost</p>
              <p className="mt-2 text-lg font-semibold text-apptext">
                ${(monthKwh * kwhRate).toFixed(2)}
              </p>
            </div>
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Active Readings</p>
              <p className="mt-2 text-lg font-semibold text-apptext">{realData.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <StatTile
          label="Today"
          value={todayKwh.toFixed(1)}
          unit="kWh"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="60-Day Total"
          value={monthKwh.toFixed(0)}
          unit="kWh"
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="7-Day Avg"
          value={avg7.toFixed(1)}
          unit="kWh/day"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="30-Day Avg"
          value={avg30.toFixed(1)}
          unit="kWh/day"
          loading={loading}
          icon={Icons.Bolt}
        />
      </section>

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
          <UsageChart
            data={chartData}
            loading={loading}
            title="Electric usage trend"
            emptyText="No electric usage data yet. Run a sync to populate this view."
            unitLabel="kWh"
            accentColor="#34d399"
          />
        </DeferredRender>
        <DeferredRender minHeight={360}>
          <MonthlyComparison
            data={realData}
            loading={loading}
            title="Monthly electric comparison"
            emptyText="Not enough electric history for a monthly comparison yet."
            unitLabel="kWh"
            barColor="#10b981"
          />
        </DeferredRender>
      </section>

      <UsageSummaryGrid
        title="Electric highs, lows, and rolling period totals"
        unitLabel="kWh"
        summaries={summaryCards}
        loading={summaryLoading}
      />

      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Usage Log
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
              Recent electric readings
            </h3>
          </div>
          <p className="text-sm text-apptext-muted">
            Based on the latest 30 non-zero entries.
          </p>
        </div>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-2xl bg-appinset" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[42rem] text-sm">
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-appborder pb-2 text-left text-apptext-dim">
                <div className="font-medium">Date</div>
                <div className="text-right font-medium">kWh</div>
                <div className="text-right font-medium">Est. Cost</div>
                <div className="text-right font-medium">Source</div>
              </div>
              <VirtualizedList
                items={tableData}
                height={432}
                itemHeight={58}
                overscan={6}
                className="mt-1"
                renderItem={(d) => {
                  const usageLevel = getUsageLevel(Number(d.usageKwh));

                  return (
                    <div
                      key={d.id}
                      className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center border-b border-appborder-light pr-1 transition-colors hover:bg-appinset"
                    >
                      <div className="py-3 text-apptext-soft">
                        {new Date(d.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                      <div className="py-3 text-right tabular-nums">
                        <span
                          className={`inline-flex min-w-[5.5rem] items-center justify-end rounded-full border px-2.5 py-1 text-sm font-semibold ${usageLevel.badgeClass}`}
                        >
                          {Number(d.usageKwh).toFixed(2)}
                        </span>
                      </div>
                      <div className="py-3 text-right tabular-nums text-apptext-soft">
                        ${(Number(d.usageKwh) * kwhRate).toFixed(2)}
                      </div>
                      <div className="py-3 text-right text-apptext-dim">
                        {d.sourceProvider}
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
