import { memo, useMemo, useState } from 'react';
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
import { fetchForecast, fetchForecastAccuracy, fetchHourlyForecastAccuracy } from '../api/forecast';
import { localTodayIso } from '../utils/localDate';
import { useTheme, CHART_SERIES, hexToRgba } from '../context/ThemeContext';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import StatTile, { Icons } from './StatTile';

const chartTheme = {
  tooltipBg: 'var(--appchart-bg)',
  tooltipBorder: 'var(--appchart-border)',
  text: 'var(--apptext)',
  muted: 'var(--apptext-muted)',
  grid: 'var(--appchart-grid)',
  tick: 'var(--appchart-tick)',
};

const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: chartTheme.tooltipBg,
  border: `1px solid ${chartTheme.tooltipBorder}`,
  borderRadius: '16px',
  fontSize: '13px',
  color: chartTheme.text,
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Accuracy "day-by-day" ranges. Lifetime is a large trailing window the backend
// clamps against available graded snapshots — no special-casing needed server-side.
type AccRange = '7d' | '14d' | '30d' | 'all';
const ACC_RANGE_DAYS: Record<AccRange, number> = { '7d': 7, '14d': 14, '30d': 30, all: 3650 };
const ACC_RANGE_LABEL: Record<AccRange, string> = {
  '7d': '1 Week', '14d': '2 Weeks', '30d': '1 Month', all: 'Lifetime',
};

// Hourly is capped at 1 month (no lifetime): raw per-hour points don't window,
// so beyond ~30 days (~720 points) the line turns into an unreadable, laggy
// band. The daily tab covers the long-horizon trend.
type HourlyRange = '7d' | '14d' | '30d';
const HOURLY_RANGE_DAYS: Record<HourlyRange, number> = { '7d': 7, '14d': 14, '30d': 30 };
// Trailing window for the hourly moving average: 24 hours = one full day, so the
// trend line reads through the intra-day scatter.
const HOURLY_TRAILING_WINDOW = 24;
// Cap on labeled day-boundary ticks so a 30-day window doesn't crowd the axis.
const HOURLY_MAX_TICKS = 8;

type AccGranularity = 'daily' | 'hourly';

// Trailing window (points) for the daily accuracy moving average — smooths the
// day-to-day error scatter so the "is it actually improving" trend reads over
// the longer ranges where raw dots are noisy.
const DAILY_TRAILING_WINDOW = 7;

// Monday-first display order, independent of the java.time.DayOfWeek enum's
// own Monday-first .name() ordering (kept explicit here since this is a
// display concern, not something to couple to the backend's iteration order).
const DOW_DISPLAY_ORDER = [
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
] as const;
const DOW_SHORT_LABEL: Record<string, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
  FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

/**
 * Learned per-weekday multiplier on top of the weather-only prediction
 * (ForecastService's dowAdjustments) — e.g. THURSDAY: 1.08 means Thursdays
 * run ~8% above what weather alone would predict for that day. Diverges from
 * a 1.0 (average) center line so above/below reads at a glance.
 */
function DowAdjustmentCard({ dowAdjustments }: { dowAdjustments: Record<string, number> }) {
  const entries = DOW_DISPLAY_ORDER
    .filter((day) => dowAdjustments[day] != null)
    .map((day) => ({ day, factor: dowAdjustments[day] }));
  if (entries.length === 0) return null;

  const maxDeviation = Math.max(0.1, ...entries.map((e) => Math.abs(e.factor - 1)));

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4">
        <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Learned Pattern
        </p>
        <h3 className="mt-2 text-xl font-semibold text-apptext">
          Usage by Day of Week
        </h3>
        <p className="mt-1 text-xs text-apptext-muted">
          How much each weekday runs above or below what weather alone would
          predict, learned from your own history — not an assumption that
          every day is equal.
        </p>
      </div>
      <div className="space-y-2">
        {entries.map(({ day, factor }) => {
          const pct = (factor - 1) * 100;
          const above = pct >= 0;
          const widthPct = (Math.abs(pct) / (maxDeviation * 100)) * 50;
          return (
            <div key={day} className="flex items-center gap-3">
              <span className="w-9 shrink-0 text-xs font-medium text-apptext-soft">
                {DOW_SHORT_LABEL[day]}
              </span>
              <div className="relative h-5 flex-1 rounded-full bg-appinset">
                {/* Center line at 1.0 (average) */}
                <div className="absolute left-1/2 top-0 h-full w-px bg-appborder" />
                <div
                  className="absolute top-0 h-full rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    left: above ? '50%' : `${50 - widthPct}%`,
                    backgroundColor: above ? '#22c55e' : '#f59e0b',
                    opacity: 0.75,
                  }}
                />
              </div>
              <span
                className="w-12 shrink-0 text-right text-xs font-semibold"
                style={{ color: above ? '#22c55e' : '#f59e0b' }}
              >
                {above ? '+' : ''}{pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ForecastRange = '7d' | '14d';

function ForecastChart() {
  const [range, setRange] = useState<ForecastRange>('7d');
  const days = range === '14d' ? 14 : 7;
  // Self-improvement accuracy view: daily vs hourly granularity, and (for daily)
  // the trailing time range.
  const [accGranularity, setAccGranularity] = useState<AccGranularity>('daily');
  const [accRange, setAccRange] = useState<AccRange>('30d');
  const [hourlyRange, setHourlyRange] = useState<HourlyRange>('7d');
  const { theme, palette } = useTheme();
  const series = (CHART_SERIES[palette] ?? CHART_SERIES.default)[theme];
  const forecastInterval = useJitteredInterval(600_000);

  const { data: forecast, isLoading } = useQuery({
    queryKey: ['forecast', days],
    queryFn: () => fetchForecast(days),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // 30-day accuracy powers the KPI tiles (a stable headline number, independent
  // of whatever range the trend chart is showing below).
  const { data: accuracy } = useQuery({
    queryKey: ['forecast-accuracy', 30],
    queryFn: () => fetchForecastAccuracy(30),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // Daily accuracy for the selected trend range (dedupes with the KPI query when
  // the range is also 30 days).
  const rangeDays = ACC_RANGE_DAYS[accRange];
  const { data: rangeAccuracy } = useQuery({
    queryKey: ['forecast-accuracy', rangeDays],
    queryFn: () => fetchForecastAccuracy(rangeDays),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // Hourly accuracy — only fetched once the user toggles the hourly view on.
  const hourlyRangeDays = HOURLY_RANGE_DAYS[hourlyRange];
  const { data: hourlyAccuracy } = useQuery({
    queryKey: ['forecast-accuracy-hourly', hourlyRangeDays],
    queryFn: () => fetchHourlyForecastAccuracy(hourlyRangeDays),
    enabled: accGranularity === 'hourly',
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // Daily accuracy series + trailing moving average (improvement trend).
  const dailyAccData = useMemo(() => {
    const pts = rangeAccuracy?.points ?? [];
    return pts.map((p, i) => {
      const from = Math.max(0, i - DAILY_TRAILING_WINDOW + 1);
      const slice = pts.slice(from, i + 1);
      const avg = slice.reduce((s, x) => s + x.error, 0) / slice.length;
      return { label: formatDateLabel(p.date), error: p.error, trailing: Number(avg.toFixed(2)) };
    });
  }, [rangeAccuracy]);

  // Hourly accuracy series: one point per graded hour over the selected window,
  // X keyed by array index, with a 24h (one-day) moving average so the trend
  // reads through the intra-day scatter at the denser ranges.
  const hourlyAccData = useMemo(() => {
    const pts = hourlyAccuracy?.points ?? [];
    return pts.map((p, i) => {
      const from = Math.max(0, i - HOURLY_TRAILING_WINDOW + 1);
      const slice = pts.slice(from, i + 1);
      const avg = slice.reduce((s, x) => s + x.error, 0) / slice.length;
      return { idx: i, error: p.error, trailing: Number(avg.toFixed(2)), date: p.date, hour: p.hour };
    });
  }, [hourlyAccuracy]);
  // Labeled ticks at day boundaries, thinned so a 30-day window stays legible.
  const hourlyTicks = useMemo(() => {
    const seen = new Set<string>();
    const dayStarts: number[] = [];
    for (const d of hourlyAccData) {
      if (!seen.has(d.date)) { seen.add(d.date); dayStarts.push(d.idx); }
    }
    if (dayStarts.length <= HOURLY_MAX_TICKS) return dayStarts;
    const step = Math.ceil(dayStarts.length / HOURLY_MAX_TICKS);
    return dayStarts.filter((_, i) => i % step === 0);
  }, [hourlyAccData]);

  const chartData = useMemo(() => {
    if (!forecast || forecast.status !== 'ok') return [];

    const byDate = new Map<string, {
      date: string;
      label: string;
      actual: number | null;
      predicted: number | null;
      lower: number | null;
      upper: number | null;
      confidenceBand: [number, number] | null;
    }>();

    // Historical actuals from snapshots
    for (const s of forecast.snapshots ?? []) {
      byDate.set(s.targetDate, {
        date: s.targetDate,
        label: formatDateLabel(s.targetDate),
        actual: s.actualKwh,
        predicted: s.predictedKwh,
        lower: null,
        upper: null,
        confidenceBand: null,
      });
    }

    // Future forecasts (also covers yesterday — see ForecastController — so a day
    // that just rolled from "today" into "yesterday" still gets a band instead of
    // an empty gap while its actual hasn't been backfilled yet).
    for (const f of forecast.forecasts ?? []) {
      const existing = byDate.get(f.date);
      const actual = existing?.actual ?? null;
      byDate.set(f.date, {
        date: f.date,
        label: formatDateLabel(f.date),
        actual,
        predicted: f.predictedKwh,
        lower: f.lowerBound,
        upper: f.upperBound,
        // Once the real actual is known, let it stand on its own — don't keep
        // drawing a band over an already-graded day.
        confidenceBand: actual == null ? [f.lowerBound, f.upperBound] : null,
      });
    }

    const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Anchor the band to the last known actual: without this, the band's first
    // point jumps straight to its full width, leaving a visible seam between the
    // actual line and the start of the band instead of the two meeting. A
    // zero-width point at the last actual gives the Area a starting vertex to
    // flare out from, connecting the two with no gap.
    let lastActualIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].actual != null) lastActualIdx = i;
    }
    if (lastActualIdx >= 0 && sorted[lastActualIdx].confidenceBand == null) {
      const anchor = sorted[lastActualIdx].actual as number;
      sorted[lastActualIdx] = { ...sorted[lastActualIdx], confidenceBand: [anchor, anchor] };
    }

    return sorted;
  }, [forecast]);

  const predictedColor = series.usage;
  const actualColor = '#22c55e';
  // Confidence band: a tint of the theme's CONTRASTING color (series.temp —
  // e.g. yellow/amber against a purple usage line), not a tint of the
  // predicted-usage color itself. A low-alpha tint of the same hue as the solid
  // predicted line reads as a dark, muddy smudge in the tooltip's legend swatch
  // (which shows the fill color at face value, not blended into the chart) even
  // though the chart area itself looks fine. A contrasting hue stays legible in
  // both places. Dark surfaces swallow low-alpha fills, so the band needs a
  // touch more alpha there; the Area below pins fillOpacity={1} so this alpha is
  // authoritative rather than being multiplied down by Recharts' default 0.6.
  const bandColor = hexToRgba(series.temp, theme === 'dark' ? 0.22 : 0.16);

  if (isLoading) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="animate-pulse">
          <div className="mb-4 h-5 w-48 rounded bg-appinset" />
          <div className="h-72 rounded-2xl bg-appinset" />
        </div>
      </div>
    );
  }

  if (!forecast || forecast.status !== 'ok') {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">
            AI Forecast
          </p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">
            Electric Usage Forecast
          </h3>
        </div>
        <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          {forecast?.message ?? 'Not enough data to build a forecast model yet. The system needs at least 7 days of usage data paired with weather observations.'}
        </div>
      </div>
    );
  }

  const avgConfidence = forecast.forecasts && forecast.forecasts.length > 0
    ? forecast.forecasts.reduce((s, f) => s + f.confidencePct, 0) / forecast.forecasts.length
    : 0;

  const projectedMonthlyKwh = forecast.forecasts && forecast.forecasts.length > 0
    ? (forecast.forecasts.reduce((s, f) => s + f.predictedKwh, 0) / forecast.forecasts.length) * 30
    : null;

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Model Accuracy"
          value={accuracy && accuracy.dataPoints > 0 ? `${(100 - accuracy.mape).toFixed(0)}` : '—'}
          unit="%"
          loading={false}
          icon={Icons.Bolt}
          subtitle={accuracy && accuracy.dataPoints > 0 ? `${accuracy.dataPoints} predictions graded` : 'Building...'}
        />
        <StatTile
          label="MAE"
          value={accuracy && accuracy.dataPoints > 0 ? accuracy.mae.toFixed(1) : '—'}
          unit="kWh"
          loading={false}
          icon={Icons.Bolt}
          subtitle="Mean absolute error"
        />
        <StatTile
          label="Confidence"
          value={avgConfidence > 0 ? `${avgConfidence.toFixed(0)}` : '—'}
          unit="%"
          loading={false}
          icon={Icons.Calendar}
          subtitle="Avg forecast confidence"
        />
        <StatTile
          label="Proj. Monthly"
          value={projectedMonthlyKwh ? `${projectedMonthlyKwh.toFixed(0)}` : '—'}
          unit="kWh"
          loading={false}
          icon={Icons.Calendar}
          subtitle="Projected 30-day usage"
        />
      </section>

      {/* Chart */}
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">
              AI Forecast
            </p>
            <h3 className="mt-2 text-xl font-semibold text-apptext">
              Electric Usage Forecast
            </h3>
            <p className="mt-1 text-xs text-apptext-muted">
              Trained on {forecast.dataPointsUsed} days · R² = {forecast.rSquared?.toFixed(4) ?? '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(['7d', '14d'] as ForecastRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r
                    ? 'bg-appaccent-soft text-appaccent-text border border-appaccent-border'
                    : 'text-apptext-muted hover:text-apptext-soft border border-transparent hover:border-appborder'
                }`}
              >
                {r === '7d' ? '7 Days' : '14 Days'}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
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
            Waiting for forecast data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320} debounce={80}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="label"
                tick={{ fill: chartTheme.tick, fontSize: 11 }}
                axisLine={{ stroke: chartTheme.grid }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: chartTheme.tick, fontSize: 11 }}
                axisLine={{ stroke: chartTheme.grid }}
                tickLine={false}
                unit=" kWh"
              />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />

              <ReferenceLine
                x={formatDateLabel(localTodayIso())}
                stroke={chartTheme.muted}
                strokeDasharray="4 4"
                label={{ value: 'Today', fill: chartTheme.muted, fontSize: 10 }}
              />

              {/* Confidence band — no visible outline on the chart (strokeWidth 0),
                  but stroke is still set to the bright theme color (not "none")
                  so Recharts' hover tooltip swatch — which colors itself from
                  stroke, falling back to the translucent fill only when no
                  stroke exists — matches the bright legend swatch below the
                  chart title instead of reading as a faded, hard-to-see dot. */}
              <Area
                dataKey="confidenceBand"
                fill={bandColor}
                fillOpacity={1}
                stroke={series.temp}
                strokeWidth={0}
                isAnimationActive={false}
                connectNulls={false}
              />

              {/* Predicted line (dashed) */}
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

              {/* Actual line (solid) */}
              <Line
                type="monotone"
                dataKey="actual"
                stroke={actualColor}
                strokeWidth={2.5}
                dot={{ fill: actualColor, r: 3 }}
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Day-of-week learned pattern */}
      {forecast.dowAdjustments && <DowAdjustmentCard dowAdjustments={forecast.dowAdjustments} />}

      {/* Self-improvement accuracy trend — day-by-day with range toggle, plus an
          optional hourly (past week) view. */}
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Self-Improvement
            </p>
            <h3 className="mt-2 text-xl font-semibold text-apptext">
              Forecast Accuracy Over Time
            </h3>
            <p className="mt-1 max-w-prose text-xs text-apptext-muted">
              {accGranularity === 'daily'
                ? 'Absolute error of each past daily prediction, with a 7-day moving average. The model retrains nightly and should trend downward as data accumulates.'
                : "Absolute error of the model's learned hour-of-day shape vs. actual usage, hour by hour over the selected range (capped at 1 month), with a 24-hour moving average — shows which times of day it still gets wrong."}
            </p>
          </div>
          {/* Daily / Hourly granularity toggle */}
          <div className="flex items-center gap-2">
            {(['daily', 'hourly'] as AccGranularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setAccGranularity(g)}
                aria-pressed={accGranularity === g}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  accGranularity === g
                    ? 'bg-appaccent-soft text-appaccent-text border border-appaccent-border'
                    : 'text-apptext-muted hover:text-apptext-soft border border-transparent hover:border-appborder'
                }`}
              >
                {g === 'daily' ? 'Daily' : 'Hourly'}
              </button>
            ))}
          </div>
        </div>

        {/* Daily range selector (hidden in hourly mode — hourly is fixed to a week) */}
        {accGranularity === 'daily' ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(['7d', '14d', '30d', 'all'] as AccRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setAccRange(r)}
                aria-pressed={accRange === r}
                className={`rounded-full px-3 py-1 text-2xs font-medium transition-colors ${
                  accRange === r
                    ? 'bg-appaccent-soft text-appaccent-text border border-appaccent-border'
                    : 'text-apptext-muted hover:text-apptext-soft border border-transparent hover:border-appborder'
                }`}
              >
                {ACC_RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {(['7d', '14d', '30d'] as HourlyRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setHourlyRange(r)}
                  aria-pressed={hourlyRange === r}
                  className={`rounded-full px-3 py-1 text-2xs font-medium transition-colors ${
                    hourlyRange === r
                      ? 'bg-appaccent-soft text-appaccent-text border border-appaccent-border'
                      : 'text-apptext-muted hover:text-apptext-soft border border-transparent hover:border-appborder'
                  }`}
                >
                  {ACC_RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            {hourlyAccuracy && hourlyAccuracy.dataPoints > 0 && (
              <span className="text-2xs text-apptext-muted">
                Avg hourly error {hourlyAccuracy.mae.toFixed(2)} kWh over {hourlyAccuracy.dataPoints} hours
              </span>
            )}
          </div>
        )}

        {accGranularity === 'daily' ? (
          dailyAccData.length < 2 ? (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
              Not enough graded predictions in this range yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220} debounce={80}>
              <ComposedChart data={dailyAccData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: chartTheme.tick, fontSize: 10 }}
                  axisLine={{ stroke: chartTheme.grid }}
                  tickLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: chartTheme.tick, fontSize: 10 }}
                  axisLine={{ stroke: chartTheme.grid }}
                  tickLine={false}
                  unit=" kWh"
                />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  formatter={(value: number, name: string) => [
                    `${value.toFixed(1)} kWh`,
                    name === 'trailing' ? '7-day avg' : 'Daily error',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="error"
                  name="error"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={{ fill: '#f59e0b', r: 2.5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="trailing"
                  name="trailing"
                  stroke={series.usage}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        ) : hourlyAccData.length < 2 ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
            No hourly readings to grade in the past week yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220} debounce={80}>
            <ComposedChart data={hourlyAccData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="idx"
                type="number"
                domain={[0, hourlyAccData.length - 1]}
                ticks={hourlyTicks}
                tick={{ fill: chartTheme.tick, fontSize: 10 }}
                axisLine={{ stroke: chartTheme.grid }}
                tickLine={false}
                tickFormatter={(idx: number) => {
                  const d = hourlyAccData[idx];
                  return d ? formatDateLabel(d.date) : '';
                }}
              />
              <YAxis
                tick={{ fill: chartTheme.tick, fontSize: 10 }}
                axisLine={{ stroke: chartTheme.grid }}
                tickLine={false}
                unit=" kWh"
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelFormatter={(idx: number) => {
                  const d = hourlyAccData[idx];
                  return d ? `${formatDateLabel(d.date)} · ${String(d.hour).padStart(2, '0')}:00` : '';
                }}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(2)} kWh`,
                  name === 'trailing' ? '24h avg' : 'Hourly error',
                ]}
              />
              <Line
                type="monotone"
                dataKey="error"
                name="error"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="trailing"
                name="trailing"
                stroke={series.usage}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default memo(ForecastChart);
