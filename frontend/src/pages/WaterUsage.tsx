import { useMemo } from 'react';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import type { EnergyUsage } from '../types';

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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-cyan-800/50 bg-cyan-950/20 p-4 mb-2">
        <p className="text-xs text-cyan-400/80">
          🚰 Mock data — water utility integration coming in Phase 2
        </p>
      </div>

      {/* Stats */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UsageChart data={data} loading={false} />
        <MonthlyComparison data={data} loading={false} />
      </section>

      {/* Future integration note */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-2">
          Water Utility Integration
        </h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          Water usage tracking will use the same adapter pattern as CoServ.
          Once your water provider offers a customer portal (or CSV export),
          a new adapter can be built using the <code className="text-gray-400">IntegrationAdapter</code> interface.
          Data will flow into the same provider-agnostic data model with
          append-only storage and the same dashboard charts.
        </p>
      </section>
    </div>
  );
}
