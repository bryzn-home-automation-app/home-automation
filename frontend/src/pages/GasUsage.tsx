import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import DeferredRender from '../components/DeferredRender';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import { fetchUsageSummary } from '../api/energy';
import { buildUsagePeriods, createEmptyUsageSummary } from '../utils/usageSummary';

export default function GasUsage() {
  const { gasUsage, gasTotal, gasMeter, config } = useUsageData();

  const data = gasUsage.data ?? [];
  const loading = gasUsage.isLoading;
  const monthKwh = gasTotal.data?.totalKwh ?? 0;
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

  const summaryQueries = useQueries({
    queries: periodDefinitions.map((period) => ({
      queryKey: ['usage-summary', gasMeter?.id, period.key, period.start, period.end],
      queryFn: () =>
        gasMeter
          ? fetchUsageSummary(gasMeter.id, period.start, period.end)
          : Promise.resolve(createEmptyUsageSummary(0, period.start, period.end)),
      enabled: !!gasMeter,
      staleTime: 300_000,
    })),
  });

  const summaryCards = periodDefinitions.map((period, index) => ({
    label: period.label,
    rangeStart: period.displayStart,
    rangeEnd: period.displayEnd,
    summary:
      summaryQueries[index]?.data ??
      createEmptyUsageSummary(gasMeter?.id ?? 0, period.start, period.end),
  }));

  const summaryLoading = summaryQueries.some((query) => query.isLoading);

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-white/10 bg-slate-900/84 p-6 shadow-[0_12px_34px_rgba(2,8,23,0.24)] sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
              Gas Module
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
              Natural gas visibility, ready as more seasonal data arrives.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
              This view keeps gas usage in the same operating model as electric, even when the dataset is still sparse.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
            CoServ gas readings will become more useful once colder months build a longer history.
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile
          label="Gas Total (60d)"
          value={monthKwh.toFixed(0)}
          unit="kWh"
          loading={loading}
          icon={Icons.Calendar}
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

      {/* Charts */}
      {hasData ? (
        <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DeferredRender minHeight={360}>
            <UsageChart
              data={chartData}
              loading={loading}
              title="Gas usage trend"
              emptyText="No gas usage data is available yet."
              unitLabel="kWh"
              accentColor="#38bdf8"
            />
          </DeferredRender>
          <DeferredRender minHeight={360}>
            <MonthlyComparison
              data={realData}
              loading={loading}
              title="Monthly gas comparison"
              emptyText="More gas history is needed for month-over-month comparison."
              unitLabel="kWh"
              barColor="#0ea5e9"
            />
          </DeferredRender>
        </section>
      ) : (
        <section className="perf-section rounded-[28px] border border-white/10 bg-slate-900/82 p-8 text-center shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
          <div className="mb-3 text-4xl">🔥</div>
          <h3 className="mb-2 text-lg font-semibold text-white">
            No Gas Usage Yet
          </h3>
          <p className="mx-auto max-w-md text-sm leading-6 text-slate-400">
            Natural gas data will appear here once you start using gas
            appliances. CoServ tracks both electric and gas on the same meter.
            Data is pulled automatically during each sync.
          </p>
        </section>
      )}

      <UsageSummaryGrid
        title="Gas highs, lows, and rolling period totals"
        unitLabel="kWh"
        summaries={summaryCards}
        loading={summaryLoading}
      />
    </div>
  );
}
