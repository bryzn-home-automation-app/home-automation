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
import { isHourlySource } from '../utils/usageSource';

// ── Module-level constants (stable refs, no re-mount on parent renders) ──
const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 } as const;
const TICK_PROPS = { fontSize: 11 } as const;
const TICK_LINE_FALSE = false;
const CARTESIAN_GRID_DASH = '3 3';
// Room for "1800 kWh" on one line (the default 60px wraps monthly totals).
const Y_AXIS_WIDTH = 72;

// Static CSS-var theme + tooltip styles hoisted to module scope (stable identity;
// a per-render literal would defeat Recharts' prop-identity checks).
const CHART_THEME = {
  grid: 'var(--appchart-grid)',
  tick: 'var(--appchart-tick)',
} as const;
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--appchart-bg)',
  border: '1px solid var(--appchart-border)',
  borderRadius: '16px',
  fontSize: '13px',
  color: 'var(--apptext)',
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;
const TOOLTIP_LABEL_STYLE = { color: 'var(--apptext-muted)', marginBottom: 4 } as const;

interface MonthlyComparisonProps {
  data: EnergyUsage[];
  /**
   * Pre-aggregated monthly totals ({ month: 'Sep 2026', kWh }). When provided,
   * the chart plots these directly instead of deriving from `data` — the
   * correct input for sources with no hourly rows (e.g. gas, which CoServ
   * only reports monthly), since the default path only sums records whose
   * `source` is a recognized hourly label and silently renders empty
   * otherwise. `data` is still used for the loading/empty checks so the
   * existing (electric) callers behave identically.
   */
  monthlyPoints?: Array<{ month: string; kWh: number }>;
  loading?: boolean;
  title?: string;
  /** Optional one-line explanation under the title. */
  description?: string;
  emptyText?: string;
  unitLabel?: string;
  barColor?: string;
}

/**
 * Month-over-month bars. The card fills its grid cell (`h-full`) and the plot
 * grows into any spare height, so it matches the chart beside it (the trend &
 * outlook card, with its taller header + legend) instead of ending short. The
 * plot sits in an absolutely-positioned layer so the chart itself never feeds
 * back into the row's height — the card's own minimum is header + 280px.
 */
function MonthlyComparison({
  data,
  monthlyPoints,
  loading,
  title = 'Monthly Comparison',
  description,
  emptyText = 'Not enough data for monthly comparison yet',
  unitLabel = 'kWh',
  barColor = '#10b981',
}: MonthlyComparisonProps) {
  const t = CHART_THEME;

  // All hooks run before any early return (Rules of Hooks).
  // Group usage by month — use only hourly records to avoid granularity mixing
  const chartData = useMemo(() => {
    if (monthlyPoints) return monthlyPoints;
    const byMonth = new Map<string, number>();
    data.forEach((d) => {
      if (!isHourlySource(d.source)) return;
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
  }, [data, monthlyPoints]);

  const tooltipFormatter = useMemo(
    () => (value: number) => [`${value.toFixed(2)} ${unitLabel}`, 'Total'],
    [unitLabel]
  );

  if (loading) {
    return (
      <div className="flex h-full animate-pulse flex-col rounded-[28px] border border-appborder bg-appsurface-raised p-5">
        <div className="mb-4 h-5 w-48 rounded bg-appinset" />
        <div className="min-h-72 flex-1 rounded-2xl bg-appinset" />
      </div>
    );
  }

  if (monthlyPoints ? !monthlyPoints.length : !data.length) {
    return (
      <div className="flex h-full flex-col rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Month-over-month</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">{title}</h3>
        </div>
        <div className="flex min-h-72 flex-1 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Month-over-month</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">{title}</h3>
          {description && <p className="mt-1 text-xs text-apptext-muted">{description}</p>}
        </div>
        <span className="shrink-0 rounded-full border border-appborder bg-appinset px-2.5 py-1 text-3xs font-semibold uppercase tracking-[0.16em] text-apptext-soft">
          {unitLabel}
        </span>
      </div>
      <div className="relative min-h-[280px] flex-1">
        <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%" debounce={80}>
            <BarChart data={chartData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray={CARTESIAN_GRID_DASH} stroke={t.grid} />
              <XAxis
                dataKey="month"
                tick={{ fill: t.tick, ...TICK_PROPS }}
                axisLine={{ stroke: t.grid }}
                tickLine={TICK_LINE_FALSE}
              />
              <YAxis
                tick={{ fill: t.tick, ...TICK_PROPS }}
                axisLine={{ stroke: t.grid }}
                tickLine={TICK_LINE_FALSE}
                unit={` ${unitLabel}`}
                width={Y_AXIS_WIDTH}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                formatter={tooltipFormatter}
                labelStyle={TOOLTIP_LABEL_STYLE}
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
      </div>
    </div>
  );
}

export default memo(MonthlyComparison);
