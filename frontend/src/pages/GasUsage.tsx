import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import DeferredRender from '../components/DeferredRender';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import { fetchBatchSummaries } from '../api/energy';
import { buildUsagePeriods, createEmptyUsageSummary } from '../utils/usageSummary';
import WeatherContextCard from '../components/WeatherContextCard';
import Weather24HourCard from '../components/Weather24HourCard';

export default memo(function GasUsage() {
  const { gasUsage, gasTotal, gasMeter, config } = useUsageData();

  const data = gasUsage.data ?? [];
  const loading = gasUsage.isLoading;
  const monthKwh = gasTotal.data?.totalKwh ?? 0;
  // Gas is metered in CCF-equivalent "units", not kWh — priced separately
  // from the electric $/kWh rate.
  const gasUnitRate = config.data?.gasUnitRate ?? 1.47;
  const sixtyDaySpend = monthKwh * gasUnitRate;
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
  const hasData = realData.length > 0;

  const periodDefinitions = useMemo(
    () => buildUsagePeriods(config.data?.dataStartDate),
    [config.data?.dataStartDate]
  );

  // One batched HTTP call for all periods instead of N parallel ones —
  // same data, same shape, fewer round-trips.
  const periodsKey = periodDefinitions.map((p) => `${p.start}:${p.end}`).join('|');
  const batchSummary = useQuery({
    queryKey: ['usage-summaries', gasMeter?.id, periodsKey],
    queryFn: () =>
      gasMeter
        ? fetchBatchSummaries(gasMeter.id, periodDefinitions.map((p) => ({ start: p.start, end: p.end })))
        : Promise.resolve(periodDefinitions.map((p) => createEmptyUsageSummary(0, p.start, p.end))),
    enabled: !!gasMeter && periodDefinitions.length > 0,
    staleTime: 30_000,
  });

  const summaryCards = periodDefinitions.map((period, index) => ({
    label: period.label,
    rangeStart: period.displayStart,
    rangeEnd: period.displayEnd,
    summary:
      batchSummary.data?.[index] ??
      createEmptyUsageSummary(gasMeter?.id ?? 0, period.start, period.end),
  }));

  const summaryLoading = batchSummary.isLoading;

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Gas Module
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Natural gas visibility, ready as more seasonal data arrives.
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              This view keeps gas usage in the same operating model as electric, even when the dataset is still sparse.
            </p>
          </div>

          <div className="rounded-2xl border border-appborder bg-appinset p-4 text-sm text-apptext-soft">
            CoServ gas readings will become more useful once colder months build a longer history.
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
        <StatTile
          label="Gas Total (60d)"
          value={monthKwh.toFixed(0)}
          unit="units"
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Rate"
          value={`$${gasUnitRate.toFixed(2)}`}
          unit="/unit"
          loading={loading}
          icon={Icons.Dollar}
        />
        <StatTile
          label="60-Day Spend"
          value={`$${sixtyDaySpend.toFixed(2)}`}
          unit=""
          loading={loading}
          icon={Icons.Dollar}
        />
        <StatTile
          label="Records"
          value={String(data.length)}
          unit=""
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Active Days"
          value={String(realData.length)}
          unit=""
          loading={loading}
          icon={Icons.Bolt}
        />
      </section>

      {/* Weather Context */}
      {periodDefinitions.length > 0 && (
        <WeatherContextCard
          startDate={periodDefinitions[0].start}
          endDate={periodDefinitions[0].end}
          showHDD
        />
      )}

      {/* Charts */}
      {hasData ? (
        <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DeferredRender minHeight={360}>
            <UsageChart
              data={chartData}
              loading={loading}
              title="Gas usage trend"
              emptyText="No gas usage data is available yet."
              unitLabel="units"
              accentColor="#38bdf8"
            />
          </DeferredRender>
          <DeferredRender minHeight={360}>
            <MonthlyComparison
              data={realData}
              loading={loading}
              title="Monthly gas comparison"
              emptyText="More gas history is needed for month-over-month comparison."
              unitLabel="units"
              barColor="#0ea5e9"
            />
          </DeferredRender>
        </section>
      ) : (
        <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-8 text-center shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-3 text-4xl">🔥</div>
          <h3 className="mb-2 text-lg font-semibold text-apptext">
            No Gas Usage Yet
          </h3>
          <p className="mx-auto max-w-md text-sm leading-6 text-apptext-muted">
            Natural gas data will appear here once you start using gas
            appliances. CoServ tracks both electric and gas on the same meter.
            Data is pulled automatically during each sync.
          </p>
        </section>
      )}

      {/* 24-Hour Weather Detail */}
      {periodDefinitions.length > 0 && (
        <Weather24HourCard
          startDate={periodDefinitions[0].start}
          endDate={periodDefinitions[0].end}
        />
      )}

      <UsageSummaryGrid
        title="Gas highs, lows, and rolling period totals"
        unitLabel="units"
        summaries={summaryCards}
        loading={summaryLoading}
      />
    </div>
  );
});
