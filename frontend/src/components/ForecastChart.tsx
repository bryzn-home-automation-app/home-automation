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

type ForecastRange = '7d' | '14d';

function ForecastChart() {
  const [range, setRange] = useState<ForecastRange>('7d');
  const days = range === '14d' ? 14 : 7;
  const { theme, palette } = useTheme();
  const series = (CHART_SERIES[palette] ?? CHART_SERIES.default)[theme];

  const { data: forecast, isLoading } = useQuery({
    queryKey: ['forecast', days],
    queryFn: () => fetchForecast(days),
    staleTime: 600_000,
  });

  const { data: accuracy } = useQuery({
    queryKey: ['forecast-accuracy'],
    queryFn: () => fetchForecastAccuracy(30),
    staleTime: 600_000,
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

    // Future forecasts
    for (const f of forecast.forecasts ?? []) {
      const existing = byDate.get(f.date);
      byDate.set(f.date, {
        date: f.date,
        label: formatDateLabel(f.date),
        actual: existing?.actual ?? null,
        predicted: f.predictedKwh,
        lower: f.lowerBound,
        upper: f.upperBound,
        confidenceBand: [f.lowerBound, f.upperBound],
      });
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [forecast]);

  const predictedColor = series.usage;
  const actualColor = '#22c55e';
  const bandColor = hexToRgba(predictedColor, 0.12);

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
          <h3 className="mt-2 text-lg font-semibold text-apptext">
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
            <h3 className="mt-2 text-lg font-semibold text-apptext">
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
            <span className="inline-block h-3 w-5 rounded" style={{ backgroundColor: bandColor }} />
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

              {/* Confidence band */}
              <Area
                dataKey="confidenceBand"
                fill={bandColor}
                stroke="none"
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

      {/* Accuracy trend (if we have graded predictions) */}
      {accuracy && accuracy.points.length > 2 && (
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Self-Improvement
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
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
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
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
