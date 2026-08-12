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

function buildDynamicAxis(
  values: Array<number | null | undefined>,
  options?: { points?: number; padRatio?: number; minPad?: number; floorZero?: boolean; integerTicks?: boolean }
) {
  const points = options?.points ?? 8;
  const padRatio = options?.padRatio ?? 0.12;
  const minPad = options?.minPad ?? 1;
  const floorZero = options?.floorZero ?? false;
  const integerTicks = options?.integerTicks ?? false;

  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length || points < 2) return { domain: undefined, ticks: undefined };

  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    const pad = Math.max(minPad, Math.abs(min) * padRatio, 1);
    min -= pad; max += pad;
  } else {
    const pad = Math.max(minPad, (max - min) * padRatio);
    min -= pad; max += pad;
  }
  if (floorZero) min = Math.max(0, min);

  if (integerTicks) {
    const step = Math.max(1, Math.ceil((max - min) / (points - 1)));
    let lo = Math.floor(min);
    let hi = Math.ceil(max);
    while (hi - lo < step * (points - 1)) { if (!floorZero || lo > 0) lo -= 1; hi += 1; }
    const ticks = Array.from({ length: points }, (_, i) => lo + step * i);
    return { domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], ticks };
  }

  const step = (max - min) / (points - 1);
  const decimals = step >= 10 ? 0 : step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
  const ticks = Array.from({ length: points }, (_, i) => Number((min + step * i).toFixed(decimals)));
  return { domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], ticks };
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
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Daily trend</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          {emptyText}
        </div>
      </div>
    );
  }

  const chartData = useMemo(() => {
    // Sum hourly records per date to get daily totals.
    const byDate = new Map<string, number>();
    for (const d of data) {
      if (d.source !== 'CoServ Average Usage') continue;
      const date = d.timestamp.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + Number(d.usageKwh));
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({
        date: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        kWh: Math.round(total * 100) / 100,
      }));
  }, [data]);

  const yAxis = useMemo(() => {
    return buildDynamicAxis(chartData.map((d) => d.kWh), { points: 8, padRatio: 0.12, minPad: 1, floorZero: true, integerTicks: true });
  }, [chartData]);

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Daily trend</p>
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
            interval={0}
            angle={-35}
            textAnchor="end"
            height={50}
          />
          <YAxis
            tick={{ fill: t.tick, fontSize: 11 }}
            axisLine={{ stroke: t.grid }}
            tickLine={false}
            unit={` ${unitLabel}`}
            domain={yAxis.domain as [number, number]}
            ticks={yAxis.ticks}
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
