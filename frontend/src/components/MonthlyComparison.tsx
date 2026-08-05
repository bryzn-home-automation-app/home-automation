import { memo, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EnergyUsage } from '../types';

interface MonthlyComparisonProps {
  data: EnergyUsage[];
  loading?: boolean;
  title?: string;
  emptyText?: string;
  unitLabel?: string;
  barColor?: string;
}

function MonthlyComparison({
  data,
  loading,
  title = 'Monthly Comparison',
  emptyText = 'Not enough data for monthly comparison yet',
  unitLabel = 'kWh',
  barColor = '#10b981',
}: MonthlyComparisonProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-[28px] border border-white/10 bg-slate-900/82 p-5">
        <div className="mb-4 h-5 w-48 rounded bg-white/8" />
        <div className="h-72 rounded-2xl bg-white/8" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Comparison</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-950/20 text-sm text-slate-400">
          {emptyText}
        </div>
      </div>
    );
  }

  // Group usage by month
  const chartData = useMemo(() => {
    const byMonth = new Map<string, number>();
    data.forEach((d) => {
      const key = new Date(d.timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
      });
      byMonth.set(key, (byMonth.get(key) || 0) + Number(d.usageKwh));
    });

    return Array.from(byMonth.entries()).map(([month, kWh]) => ({
      month,
      kWh: Math.round(kWh * 100) / 100,
    }));
  }, [data]);

  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Comparison</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-slate-950/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
          {unitLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280} debounce={80}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.12)" />
          <XAxis
            dataKey="month"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.12)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(148, 163, 184, 0.12)' }}
            tickLine={false}
            unit={` ${unitLabel}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#08101c',
              border: '1px solid rgba(148, 163, 184, 0.14)',
              borderRadius: '16px',
              fontSize: '13px',
              color: '#f8fafc',
              boxShadow: '0 20px 50px rgba(2, 8, 23, 0.42)',
            }}
            formatter={(value: number) => [`${value.toFixed(2)} ${unitLabel}`, 'Total']}
            labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
          />
          <Bar
            dataKey="kWh"
            isAnimationActive={false}
            fill={barColor}
            radius={[10, 10, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(MonthlyComparison);
