import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { fetchForecast } from '../api/forecast';
import { localTodayIso } from '../utils/localDate';
import { useTheme, CHART_SERIES, hexToRgba } from '../context/ThemeContext';
import { useJitteredInterval } from '../hooks/useJitteredInterval';

/**
 * TrendOutlookChart — 30 days back, 30 days forward on one line: solid green
 * actuals (the last month of daily totals) flowing into a dashed purple AI
 * projection (the next month), with the forecast confidence band behind it.
 * Replaces the everything-since-day-one trend chart that had become an
 * unreadable wall of points on mobile. Colors intentionally match the AI
 * Forecast chart (green = actual, theme accent = predicted).
 */

const HIST_DAYS = 30;
const OUTLOOK_DAYS = 30;

const chartTheme = {
  grid: 'var(--appchart-grid)',
  tick: 'var(--appchart-tick)',
  muted: 'var(--apptext-muted)',
};

const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--appchart-bg)',
  border: '1px solid var(--appchart-border)',
  borderRadius: '16px',
  fontSize: '13px',
  color: 'var(--apptext)',
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TrendOutlookChartProps {
  /** Server-aggregated daily totals, ascending by date. */
  dailyPoints: Array<{ date: string; kWh: number }>;
  loading?: boolean;
  title?: string;
  emptyText?: string;
}

function TrendOutlookChart({
  dailyPoints,
  loading,
  title = 'Usage trend & 30-day outlook',
  emptyText = 'No electric usage data yet — readings sync automatically each evening.',
}: TrendOutlookChartProps) {
  const { theme, palette } = useTheme();
  const series = (CHART_SERIES[palette] ?? CHART_SERIES.default)[theme];
  const forecastInterval = useJitteredInterval(600_000);

  const { data: forecast } = useQuery({
    queryKey: ['forecast', OUTLOOK_DAYS],
    queryFn: () => fetchForecast(OUTLOOK_DAYS),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  const today = localTodayIso();

  const chartData = useMemo(() => {
    const actuals = dailyPoints.filter((p) => p.date <= today).slice(-HIST_DAYS);

    const rows = new Map<string, {
      date: string;
      label: string;
      actual: number | null;
      predicted: number | null;
      confidenceBand: [number, number] | null;
    }>();

    for (const p of actuals) {
      rows.set(p.date, {
        date: p.date,
        label: formatDateLabel(p.date),
        actual: p.kWh,
        predicted: null,
        confidenceBand: null,
      });
    }

    const lastActualDate = actuals.length ? actuals[actuals.length - 1].date : '';

    if (forecast?.status === 'ok') {
      for (const f of forecast.forecasts ?? []) {
        // Future only — history is the real usage line, not stale predictions.
        if (f.date <= lastActualDate) continue;
        rows.set(f.date, {
          date: f.date,
          label: formatDateLabel(f.date),
          actual: rows.get(f.date)?.actual ?? null,
          predicted: f.predictedKwh,
          confidenceBand: [f.lowerBound, f.upperBound],
        });
      }
    }

    const sorted = Array.from(rows.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Anchor the projection to the last actual so the dashed line and its band
    // emerge from the green line instead of starting after a visible gap.
    const lastIdx = sorted.findIndex((r) => r.date === lastActualDate);
    if (lastIdx >= 0) {
      const anchor = sorted[lastIdx].actual as number;
      sorted[lastIdx] = {
        ...sorted[lastIdx],
        predicted: anchor,
        confidenceBand: [anchor, anchor],
      };
    }

    return sorted;
  }, [dailyPoints, forecast, today]);

  const predictedColor = series.usage;
  const actualColor = '#22c55e';
  const bandColor = hexToRgba(series.temp, theme === 'dark' ? 0.22 : 0.16);

  if (loading) {
    return (
      <div className="animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-5">
        <div className="mb-4 h-5 w-48 rounded bg-appinset" />
        <div className="h-72 rounded-2xl bg-appinset" />
      </div>
    );
  }

  if (!dailyPoints.length) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Trend &amp; outlook</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">{title}</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Trend &amp; outlook</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">{title}</h3>
          <p className="mt-1 text-xs text-apptext-muted">
            Last {HIST_DAYS} days of real usage, next {OUTLOOK_DAYS} days of AI-projected usage.
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-apptext-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="18" y2="3" stroke={actualColor} strokeWidth="2.5" />
          </svg>
          Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="18" y2="3" stroke={predictedColor} strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Predicted
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded border" style={{ backgroundColor: series.temp, borderColor: series.temp }} />
          Confidence band
        </span>
      </div>

      {chartData.length < 2 ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          Waiting for usage data...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300} debounce={80}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis
              dataKey="label"
              tick={{ fill: chartTheme.tick, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.grid }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
              angle={-35}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fill: chartTheme.tick, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.grid }}
              tickLine={false}
              unit=" kWh"
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              formatter={(value: number | [number, number], name: string) => {
                if (name === 'confidenceBand' && Array.isArray(value)) {
                  return [`${value[0].toFixed(1)} – ${value[1].toFixed(1)} kWh`, 'Range'];
                }
                return [`${(value as number).toFixed(1)} kWh`, name === 'actual' ? 'Actual' : 'Predicted'];
              }}
            />

            <ReferenceLine
              x={formatDateLabel(today)}
              stroke={chartTheme.muted}
              strokeDasharray="4 4"
              label={{ value: 'Today', fill: chartTheme.muted, fontSize: 10 }}
            />

            {/* stroke set (width 0) so the tooltip swatch matches the legend —
                same rationale as ForecastChart's band. */}
            <Area
              dataKey="confidenceBand"
              fill={bandColor}
              fillOpacity={1}
              stroke={series.temp}
              strokeWidth={0}
              isAnimationActive={false}
              connectNulls={false}
            />

            <Line
              type="monotone"
              dataKey="predicted"
              stroke={predictedColor}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />

            <Line
              type="monotone"
              dataKey="actual"
              stroke={actualColor}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default memo(TrendOutlookChart);
