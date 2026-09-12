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
import { fetchForecast, fetchForecastAccuracy } from '../api/forecast';
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
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
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

  const { data: accuracy } = useQuery({
    queryKey: ['forecast-accuracy'],
    queryFn: () => fetchForecastAccuracy(30),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

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

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
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
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
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
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
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
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-apptext-muted">
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
                x={formatDateLabel(new Date().toISOString().slice(0, 10))}
                stroke={chartTheme.muted}
                strokeDasharray="4 4"
                label={{ value: 'Today', fill: chartTheme.muted, fontSize: 10 }}
              />

              {/* Confidence band. stroke is set (not "none") so Recharts' hover
                  tooltip — which colors its swatch from stroke, falling back to
                  fill only when no stroke exists — shows the full-brightness
                  theme color instead of the translucent fill used for the area
                  wash on the chart itself. */}
              <Area
                dataKey="confidenceBand"
                fill={bandColor}
                fillOpacity={1}
                stroke={series.temp}
                strokeWidth={1.5}
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

      {/* Accuracy trend (if we have graded predictions) */}
      {accuracy && accuracy.points.length > 2 && (
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Self-Improvement
            </p>
            <h3 className="mt-2 text-xl font-semibold text-apptext">
              Forecast Accuracy Over Time
            </h3>
            <p className="mt-1 text-xs text-apptext-muted">
              Each point shows the absolute error for a past prediction. The model retrains nightly and should trend downward as data accumulates.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={200} debounce={80}>
            <ComposedChart
              data={accuracy.points.map((p) => ({
                ...p,
                label: formatDateLabel(p.date),
              }))}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="label"
                tick={{ fill: chartTheme.tick, fontSize: 10 }}
                axisLine={{ stroke: chartTheme.grid }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: chartTheme.tick, fontSize: 10 }}
                axisLine={{ stroke: chartTheme.grid }}
                tickLine={false}
                unit=" kWh"
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                formatter={(value: number) => [`${Math.round(value)} kWh`, 'Prediction Error']}
              />
              <Line
                type="monotone"
                dataKey="error"
                name="Prediction Error"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ fill: '#f59e0b', r: 3 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default memo(ForecastChart);
