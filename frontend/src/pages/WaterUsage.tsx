import { useMemo } from 'react';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import type { EnergyUsage } from '../types';
import DeferredRender from '../components/DeferredRender';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import { buildUsagePeriods, summarizeUsageRange } from '../utils/usageSummary';

/** Generate mock water usage data for the past 30 days. */
function generateMockWaterData(): EnergyUsage[] {
  const records: EnergyUsage[] = [];
  const now = new Date();
  let id = 1;

  for (let i = 60; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);

    // Simulate realistic water usage: 80-250 gallons/day, higher on weekends
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const base = isWeekend ? 180 : 120;
    const variance = Math.random() * 70;

    records.push({
      id: id++,
      meterId: 99,
      timestamp: d.toISOString(),
      usageKwh: Math.round((base + variance) * 10) / 10, // gallons, reused field
      cost: 0,
      source: 'Mock Water Data',
      sourceProvider: 'water',
      ingestionBatchId: 'mock',
      processingVersion: 'mock',
      createdAt: d.toISOString(),
    });
  }

  return records;
}

export default function WaterUsage() {
  const data = useMemo(() => generateMockWaterData(), []);

  const totalGal = data.reduce((s, d) => s + d.usageKwh, 0);
  const avgDaily = totalGal / data.length;
  const today = new Date().toISOString().split('T')[0];
  const todayGal =
    data
      .filter((d) => d.timestamp.startsWith(today))
      .reduce((s, d) => s + d.usageKwh, 0) ?? 0;

  const periodDefinitions = useMemo(
    () => buildUsagePeriods(data[0]?.timestamp),
    [data]
  );

  const summaryCards = useMemo(
    () =>
      periodDefinitions.map((period) => ({
        label: period.label,
        rangeStart: period.displayStart,
        rangeEnd: period.displayEnd,
        summary: summarizeUsageRange(99, data, period.start, period.end),
      })),
    [data, periodDefinitions]
  );

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/8 p-4">
        <p className="text-xs text-cyan-100/80">
          🚰 Mock data — water utility integration coming in Phase 2
        </p>
      </div>

      <section className="rounded-[30px] border border-white/10 bg-slate-900/84 p-6 shadow-[0_12px_34px_rgba(2,8,23,0.24)] sm:p-7">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
          Water Module Preview
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          Prototype the future water dashboard before the live integration lands.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
          This mock view keeps the same component language as the live energy modules, so the eventual rollout stays consistent and low-friction.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile
          label="Today"
          value={todayGal.toFixed(0)}
          unit="gal"
          loading={false}
          icon={Icons.Calendar}
        />
        <StatTile
          label="60-Day Total"
          value={totalGal.toFixed(0)}
          unit="gal"
          loading={false}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Daily Average"
          value={avgDaily.toFixed(0)}
          unit="gal/day"
          loading={false}
          icon={Icons.Bolt}
        />
      </section>

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
          <UsageChart
            data={data}
            loading={false}
            title="Water usage trend"
            emptyText="Water usage data will appear here once the integration is connected."
            unitLabel="gal"
            accentColor="#22d3ee"
          />
        </DeferredRender>
        <DeferredRender minHeight={360}>
          <MonthlyComparison
            data={data}
            loading={false}
            title="Monthly water comparison"
            emptyText="Monthly water comparisons need more historical data."
            unitLabel="gal"
            barColor="#06b6d4"
          />
        </DeferredRender>
      </section>

      <UsageSummaryGrid
        title="Water highs, lows, and rolling period totals"
        unitLabel="gal"
        summaries={summaryCards}
      />

      <section className="perf-section rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
        <h3 className="mb-2 text-lg font-semibold text-white">
          Water Utility Integration
        </h3>
        <p className="text-sm leading-6 text-slate-400">
          Water usage tracking will use the same adapter pattern as CoServ.
          Once your water provider offers a customer portal (or CSV export),
          a new adapter can be built using the <code className="text-slate-200">IntegrationAdapter</code> interface.
          Data will flow into the same provider-agnostic data model with
          append-only storage and the same dashboard charts.
        </p>
      </section>
    </div>
  );
}
