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

// ── Module-scope constants ────────────────────────────────────
// These are passed to Recharts as props on every render. Hoisting them
// out of JSX keeps the references stable so memoized chart children
// don't re-render on unrelated parent updates (e.g. theme toggle).
const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 } as const;
const TICK_PROPS = { fontSize: 11 } as const;
const AXIS_LINE_PROPS = { stroke: 'var(--appchart-grid)' } as const;
const TICK_LINE_FALSE = false as const;
const CARTESIAN_GRID_DASH = '3 3' as const;
const TOOLTIP_CONTENT_STYLE_BASE = {
  borderRadius: '16px',
  fontSize: '13px',
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;
const TOOLTIP_LABEL_STYLE_BASE = { marginBottom: 4 } as const;

function MonthlyComparison({
  data,
  loading,
  title = 'Monthly Comparison',
  emptyText = 'Not enough data for monthly comparison yet',
  unitLabel = 'kWh',
  barColor = '#10b981',
}: MonthlyComparisonProps) {
  const t = useRechartsTheme();

  if (loading) {
    return (
      <div className="animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-5">
        <div className="mb-4 h-5 w-48 rounded bg-appinset" />
        <div className="h-72 rounded-2xl bg-appinset" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Comparison</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          {emptyText}
        </div>
      </div>
    );
  }

  // Group usage by month — use only hourly records to avoid granularity mixing
  const chartData = useMemo(() => {
    const byMonth = new Map<string, number>();
    data.forEach((d) => {
      if (d.source !== 'CoServ Average Usage') return;
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
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Comparison</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
        </div>
        <span className="rounded-full border border-appborder bg-appinset px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-apptext-soft">
          {unitLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280} debounce={80}>
        <BarChart data={chartData} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray={CARTESIAN_GRID_DASH} stroke={t.grid} />
          <XAxis
            dataKey="month"
            tick={{ fill: t.tick, ...TICK_PROPS }}
            axisLine={{ ...AXIS_LINE_PROPS, stroke: t.grid }}
            tickLine={TICK_LINE_FALSE}
          />
          <YAxis
            tick={{ fill: t.tick, ...TICK_PROPS }}
            axisLine={{ ...AXIS_LINE_PROPS, stroke: t.grid }}
            tickLine={TICK_LINE_FALSE}
            unit={` ${unitLabel}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: t.tooltipBg,
              border: `1px solid ${t.tooltipBorder}`,
              color: t.text,
              ...TOOLTIP_CONTENT_STYLE_BASE,
            }}
            formatter={(value: number) => [`${value.toFixed(2)} ${unitLabel}`, 'Total']}
            labelStyle={{ color: t.muted, ...TOOLTIP_LABEL_STYLE_BASE }}
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
