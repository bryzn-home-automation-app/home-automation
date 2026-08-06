import { memo, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EnergyUsage } from '../types';

interface UsageChartProps {
  data: EnergyUsage[];
  loading?: boolean;
  title?: string;
  emptyText?: string;
  unitLabel?: string;
  accentColor?: string;
}

function useRechartsTheme() {
  return {
    tooltipBg: 'var(--appchart-bg)',
    tooltipBorder: 'var(--appchart-border)',
    text: 'var(--apptext)',
    muted: 'var(--apptext-muted)',
    grid: 'var(--appchart-grid)',
    tick: 'var(--appchart-tick)',
  };
}

function UsageChart({
  data,
  loading,
  title = 'Daily Usage',
  emptyText = 'No usage data yet — sync to pull data from CoServ',
  unitLabel = 'kWh',
  accentColor = '#34d399',
}: UsageChartProps) {
  const t = useRechartsTheme();

  if (loading) {
    return (
      <div className="animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-5">
        <div className="mb-4 h-5 w-40 rounded bg-appinset" />
        <div className="h-72 rounded-2xl bg-appinset" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Trend</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          {emptyText}
        </div>
      </div>
    );
  }

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        date: new Date(d.timestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        kWh: Number(d.usageKwh),
      })),
    [data]
  );

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Trend</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
        </div>
        <span className="rounded-full border border-appborder bg-appinset px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-apptext-soft">
          {unitLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280} debounce={80}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
          <XAxis
            dataKey="date"
            tick={{ fill: t.tick, fontSize: 11 }}
            axisLine={{ stroke: t.grid }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: t.tick, fontSize: 11 }}
            axisLine={{ stroke: t.grid }}
            tickLine={false}
            unit={` ${unitLabel}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: t.tooltipBg,
              border: `1px solid ${t.tooltipBorder}`,
              borderRadius: '16px',
              fontSize: '13px',
              color: t.text,
              boxShadow: '0 20px 50px var(--appshadow-lg)',
            }}
            formatter={(value: number) => [`${value.toFixed(2)} ${unitLabel}`, 'Usage']}
            labelStyle={{ color: t.muted, marginBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey="kWh"
            isAnimationActive={false}
            stroke={accentColor}
            strokeWidth={2.5}
            dot={{ fill: accentColor, r: 3, strokeWidth: 0 }}
            activeDot={{ fill: accentColor, r: 5, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(UsageChart);
