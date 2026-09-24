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
import { fetchForecast, fetchForecastSnapshots } from '../api/forecast';
import { pickPredicted } from '../utils/forecastSeries';
import { localTodayIso } from '../utils/localDate';
import { useTheme, CHART_SERIES } from '../context/ThemeContext';
import { useJitteredInterval } from '../hooks/useJitteredInterval';

/**
 * TrendOutlookChart — last 30 days of actual usage (solid green) against the
 * predicted line (dashed purple: the stored prediction for past days, the live
 * forecast from today on), so hovering any day shows both. Band-free; the
 * Forecast tab has the confidence band. Colors match that chart.
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

const TOOLTIP_LABEL_STYLE = { color: 'var(--apptext-muted)', marginBottom: 4 } as const;

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** ISO date + 1 calendar day, in local calendar terms (no UTC shifting). */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

interface Row {
  date: string;
  label: string;
  actual: number | null;
  predicted: number | null;
  /** Invisible-to-tooltip connector joining the green line to the first predicted point. */
  bridge: number | null;
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
  const today = localTodayIso();

  const actuals = useMemo(
    () => dailyPoints.filter((p) => p.date <= today).slice(-HIST_DAYS),
    [dailyPoints, today]
  );
  const startDate = actuals.length ? actuals[0].date : '';
  // Snapshot window follows the first plotted day (not a fixed day count), so
  // the oldest visible day keeps its stored prediction even across data gaps.
  const historyDays = startDate ? Math.min(90, daysBetween(startDate, today) + 1) : HIST_DAYS;

  // Same key as ForecastChart's 14-day view, so the two share one cached fetch.
  const { data: forecast } = useQuery({
    queryKey: ['forecast', OUTLOOK_DAYS],
    queryFn: () => fetchForecast(OUTLOOK_DAYS),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // Stored predictions live in their own query so a weather outage or failed
  // live-forecast request never erases the prediction history.
  const { data: snapshots } = useQuery({
    queryKey: ['forecast-snapshots', historyDays],
    queryFn: () => fetchForecastSnapshots(historyDays),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  const chartData = useMemo(() => {
    if (!actuals.length) return [];

    const actualByDate = new Map(actuals.map((p) => [p.date, p.kWh]));
    const snapByDate = new Map((snapshots ?? []).map((s) => [s.targetDate, s]));
    const liveByDate = new Map(
      (forecast?.status === 'ok' ? forecast.forecasts ?? [] : []).map((f) => [f.date, f.predictedKwh])
    );

    const lastActualDate = actuals[actuals.length - 1].date;
    const liveDates = [...liveByDate.keys()].sort();
    const endDate = liveDates.length && liveDates[liveDates.length - 1] > lastActualDate
      ? liveDates[liveDates.length - 1]
      : lastActualDate;

    // One row per calendar day so gaps in the actuals stay visible on the axis.
    const rows: Row[] = [];
    for (let d = startDate; d <= endDate; d = nextDay(d)) {
      rows.push({
        date: d,
        label: formatDateLabel(d),
        actual: actualByDate.get(d) ?? null,
        predicted: pickPredicted({
          date: d,
          today,
          snapshot: snapByDate.get(d),
          hasActual: actualByDate.has(d),
          live: liveByDate.get(d),
        }),
        bridge: null,
      });
    }

    // If the last actual day has no prediction of its own, join the green line
    // to the first predicted point with a tooltip-less connector.
    let lastActualIdx = -1;
    rows.forEach((r, i) => { if (r.actual != null) lastActualIdx = i; });
    if (lastActualIdx >= 0 && rows[lastActualIdx].predicted == null) {
      const nextIdx = rows.findIndex((r, i) => i > lastActualIdx && r.predicted != null);
      if (nextIdx >= 0) {
        rows[lastActualIdx].bridge = rows[lastActualIdx].actual;
        rows[nextIdx].bridge = rows[nextIdx].predicted;
      }
    }

    return rows;
  }, [actuals, startDate, snapshots, forecast, today]);

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
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              formatter={(value: number, name: string) => [
                `${value.toFixed(1)} kWh`,
                name === 'actual' ? 'Actual' : 'Predicted',
              ]}
            />

            <ReferenceLine
              x={formatDateLabel(today)}
              stroke={chartTheme.muted}
              strokeDasharray="4 4"
              label={{ value: 'Today', fill: chartTheme.muted, fontSize: 10 }}
            />

            <Line
              type="monotone"
              dataKey="bridge"
              stroke={predictedColor}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
              tooltipType="none"
            />

            <Line
              type="monotone"
              dataKey="predicted"
              stroke={predictedColor}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
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
