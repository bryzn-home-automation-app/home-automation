import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { fetchForecast } from '../api/forecast';
import { localTodayIso } from '../utils/localDate';
import { useTheme, CHART_SERIES } from '../context/ThemeContext';
import { useJitteredInterval } from '../hooks/useJitteredInterval';

/**
 * TrendOutlookChart — 30 days back, 14 days forward: solid green actuals (the
 * last month of daily totals) alongside a dashed purple predicted line. Over
 * the historical range the purple line is each day's real graded prediction
 * (the snapshot stored at the time — not a live re-hindcast from today's
 * model, which would silently drift every retrain), so hovering any past
 * point shows both what happened and what the model actually said it would
 * be, as far back as forecasting has been running. Past "Today" the purple
 * line continues as the live forward-looking forecast. Band-free to keep
 * this chart about the trend line (see ForecastChart for the confidence
 * band). Replaces the everything-since-day-one trend chart that had become
 * an unreadable wall of points on mobile. Colors intentionally match the AI
 * Forecast chart (green = actual, theme accent = predicted).
 */

const HIST_DAYS = 30;
const OUTLOOK_DAYS = 14;

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

interface TooltipPayloadEntry {
  dataKey: string;
  value: number | null | undefined;
  color?: string;
}

/**
 * Recharts' default Tooltip renders one row per <Line>, including a "—" row
 * for a series that's null at this point (e.g. Predicted on a day before
 * forecasting existed, or Actual on a future day). Filtering to only the
 * series that actually have a value here keeps the tooltip honest — a day
 * with no prediction on record simply doesn't claim to have one.
 */
function TrendTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  if (!rows.length) return null;
  return (
    <div style={TOOLTIP_CONTENT_STYLE} className="px-3 py-2">
      <p className="mb-1 text-apptext-muted">{label}</p>
      {rows.map((r) => (
        <p key={r.dataKey} style={{ color: r.color }}>
          {r.dataKey === 'actual' ? 'Actual' : 'Predicted'}: {r.value!.toFixed(1)} kWh
        </p>
      ))}
    </div>
  );
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
  title = 'Usage trend & outlook',
  emptyText = 'No electric usage data yet — readings sync automatically each evening.',
}: TrendOutlookChartProps) {
  const { theme, palette } = useTheme();
  const series = (CHART_SERIES[palette] ?? CHART_SERIES.default)[theme];
  const forecastInterval = useJitteredInterval(600_000);

  const { data: forecast } = useQuery({
    // historyDays=HIST_DAYS: pulls graded prediction snapshots across the
    // whole displayed history, not just the API's 14-day default — so the
    // predicted line covers the full trend window, back to whenever
    // forecasting first started if that's more recent than HIST_DAYS.
    queryKey: ['forecast', OUTLOOK_DAYS, HIST_DAYS],
    queryFn: () => fetchForecast(OUTLOOK_DAYS, HIST_DAYS),
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
    }>();

    for (const p of actuals) {
      rows.set(p.date, {
        date: p.date,
        label: formatDateLabel(p.date),
        actual: p.kWh,
        predicted: null,
      });
    }

    const lastActualDate = actuals.length ? actuals[actuals.length - 1].date : '';

    if (forecast?.status === 'ok') {
      // Historical predicted: each day's REAL graded prediction (the
      // snapshot stored at forecast time — see ForecastService.getForecastRange's
      // freshest-per-target-day dedup), not a live re-hindcast. Only applied
      // within the displayed window; a day with no snapshot (before
      // forecasting existed) simply keeps predicted=null.
      for (const s of forecast.snapshots ?? []) {
        const existing = rows.get(s.targetDate);
        if (!existing) continue;
        rows.set(s.targetDate, { ...existing, predicted: s.predictedKwh });
      }

      // Future predicted: no graded snapshot exists yet for days beyond
      // today, so these come from the live forecast instead.
      for (const f of forecast.forecasts ?? []) {
        if (f.date <= lastActualDate) continue;
        rows.set(f.date, {
          date: f.date,
          label: formatDateLabel(f.date),
          actual: rows.get(f.date)?.actual ?? null,
          predicted: f.predictedKwh,
        });
      }
    }

    return Array.from(rows.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyPoints, forecast, today]);

  const predictedColor = series.usage;
  const actualColor = '#22c55e';

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
            Last {HIST_DAYS} days of actual usage vs. what was predicted at the time, plus the next {OUTLOOK_DAYS} days of AI-projected usage.
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
            <Tooltip content={<TrendTooltip />} />

            <ReferenceLine
              x={formatDateLabel(today)}
              stroke={chartTheme.muted}
              strokeDasharray="4 4"
              label={{ value: 'Today', fill: chartTheme.muted, fontSize: 10 }}
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
