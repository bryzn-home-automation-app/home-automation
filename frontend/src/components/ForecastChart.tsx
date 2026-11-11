import { memo, useMemo, useState, type ReactNode } from 'react';
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
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { DASH, formatDate, formatHour, formatNumber, formatPercent, formatShortDate, homeToday, plural } from '../utils/format';
import { ChartLegend, Chips, Disclosure, EmptyState, KeyValue, KV, Panel, Readout, Readouts, SkelBlock, Split, toneColor, useChartTheme } from './ui';

/*
 * The electric forecast, in plain words: how good it has been, the days ahead with their
 * likely range, how each weekday runs, and how far off each forecast was. The model's own
 * numbers (R², MAE, RMSE) are in ForecastModelFacts, behind "For the curious".
 */

const MARGIN = { top: 18, right: 16, left: 0, bottom: 0 } as const;

// Accuracy ranges. Lifetime is a large trailing window the backend clamps against
// available graded snapshots — no special-casing needed server-side.
type AccRange = '7d' | '14d' | '30d' | 'all';
const ACC_RANGE_DAYS: Record<AccRange, number> = { '7d': 7, '14d': 14, '30d': 30, all: 3650 };
const ACC_RANGES = [
  { value: '7d', label: '1 week' },
  { value: '14d', label: '2 weeks' },
  { value: '30d', label: '1 month' },
  { value: 'all', label: 'All' },
] as const;

// Hourly is capped at 1 month (no lifetime): raw per-hour points don't window,
// so beyond ~30 days (~720 points) the line turns into an unreadable, laggy
// band. The daily view covers the long-horizon trend.
type HourlyRange = '7d' | '14d' | '30d';
const HOURLY_RANGE_DAYS: Record<HourlyRange, number> = { '7d': 7, '14d': 14, '30d': 30 };
const HOURLY_RANGES = ACC_RANGES.filter((r) => r.value !== 'all') as unknown as ReadonlyArray<{ value: HourlyRange; label: string }>;
const RANGE_WORDS: Record<AccRange, string> = { '7d': 'week', '14d': 'two weeks', '30d': 'month', all: 'history' };
// Trailing window for the hourly moving average: 24 hours = one full day.
const HOURLY_TRAILING_WINDOW = 24;
// Cap on labelled day ticks so a 30-day window doesn't crowd the axis.
const HOURLY_MAX_TICKS = 8;
// Trailing window (days) for the daily moving average.
const DAILY_TRAILING_WINDOW = 7;

type AccGranularity = 'daily' | 'hourly';
const GRANULARITIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'hourly', label: 'Hourly' },
] as const;

type ForecastRange = '7d' | '14d';
const FORECAST_RANGES = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
] as const;

// Monday-first display order; the keys are java.time.DayOfWeek names.
const DOW_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const DOW_SHORT: Record<string, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};
const DOW_PLURAL: Record<string, string> = {
  MONDAY: 'Mondays', TUESDAY: 'Tuesdays', WEDNESDAY: 'Wednesdays', THURSDAY: 'Thursdays', FRIDAY: 'Fridays',
  SATURDAY: 'Saturdays', SUNDAY: 'Sundays',
};

const kwh = (v: number, decimals = 1) => formatNumber(v, { decimals, fixed: true, unit: 'kWh' });

/** The trailing mean of `error` over `window` points, for each point. */
function withTrailing<T extends { error: number }>(pts: readonly T[], window: number) {
  return pts.map((p, i) => {
    const slice = pts.slice(Math.max(0, i - window + 1), i + 1);
    return { ...p, trailing: Number((slice.reduce((s, x) => s + x.error, 0) / slice.length).toFixed(2)) };
  });
}

/**
 * Learned per-weekday ratio to the weather-only prediction (ForecastService's dowAdjustments):
 * SATURDAY 1.12 means Saturdays run about 12% above what the weather alone would predict.
 * Descriptive only (the forecast adds a weekend amount rather than multiplying by these).
 * Bars diverge from the centre line, so above and below read at a glance.
 */
function DowAdjustments({ dowAdjustments }: { dowAdjustments: Record<string, number> }) {
  const entries = DOW_ORDER.filter((day) => dowAdjustments[day] != null).map((day) => ({ day, factor: dowAdjustments[day] }));
  if (entries.length === 0) {
    return <EmptyState icon="calendar" title="No weekday pattern yet" compact>It appears once the model has a few weeks of history.</EmptyState>;
  }
  const maxDeviation = Math.max(0.1, ...entries.map((e) => Math.abs(e.factor - 1)));
  const top = entries.reduce((a, b) => (b.factor > a.factor ? b : a));
  return (
    <div className="fp-stack fp-stack--m">
      <ul className="fp-stack fp-stack--s" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map(({ day, factor }) => {
          const pct = (factor - 1) * 100;
          const above = pct >= 0;
          const width = (Math.abs(pct) / (maxDeviation * 100)) * 50;
          return (
            <li key={day} className="flex items-center gap-3">
              <span className="w-9 shrink-0 fp-small">{DOW_SHORT[day]}</span>
              <span className="relative h-4 flex-1 overflow-hidden rounded-well bg-appinset" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px bg-appborder-strong" />
                <span
                  className="absolute inset-y-0.5 rounded-tag"
                  style={{ width: `${width}%`, left: above ? '50%' : `${50 - width}%`, background: toneColor(above ? 'ink' : 'graphite') }}
                />
              </span>
              <span className="w-12 shrink-0 text-right fp-mono">{formatNumber(pct, { signed: true, unit: '%' })}</span>
            </li>
          );
        })}
      </ul>
      {top.factor > 1 && (
        <p className="fp-small fp-muted">
          {DOW_PLURAL[top.day]} use the most: they run {formatPercent((top.factor - 1) * 100)} above what the weather alone would suggest.
        </p>
      )}
    </div>
  );
}

function ForecastChart() {
  const t = useChartTheme();
  const [range, setRange] = useState<ForecastRange>('7d');
  const days = range === '14d' ? 14 : 7;
  const [accGranularity, setAccGranularity] = useState<AccGranularity>('daily');
  const [accRange, setAccRange] = useState<AccRange>('30d');
  const [hourlyRange, setHourlyRange] = useState<HourlyRange>('7d');
  const forecastInterval = useJitteredInterval(600_000);
  const today = homeToday();

  const { data: forecast, isLoading } = useQuery({
    queryKey: ['forecast', days],
    queryFn: () => fetchForecast(days),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // 30-day accuracy powers the headline readouts (independent of the chart's range below).
  const { data: accuracy } = useQuery({
    queryKey: ['forecast-accuracy', 30],
    queryFn: () => fetchForecastAccuracy(30),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  const rangeDays = ACC_RANGE_DAYS[accRange];
  const { data: rangeAccuracy, isPending: rangePending } = useQuery({
    queryKey: ['forecast-accuracy', rangeDays],
    queryFn: () => fetchForecastAccuracy(rangeDays),
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  // Hourly accuracy — only fetched once the hourly view is chosen.
  const hourlyRangeDays = HOURLY_RANGE_DAYS[hourlyRange];
  const { data: hourlyAccuracy, isPending: hourlyPending } = useQuery({
    queryKey: ['forecast-accuracy-hourly', hourlyRangeDays],
    queryFn: () => fetchHourlyForecastAccuracy(hourlyRangeDays),
    enabled: accGranularity === 'hourly',
    staleTime: 600_000,
    refetchInterval: forecastInterval,
    refetchIntervalInBackground: false,
  });

  const dailyAccData = useMemo(() => withTrailing(rangeAccuracy?.points ?? [], DAILY_TRAILING_WINDOW), [rangeAccuracy]);
  const hourlyAccData = useMemo(
    () => withTrailing((hourlyAccuracy?.points ?? []).map((p, idx) => ({ idx, error: p.error, date: p.date, hour: p.hour })), HOURLY_TRAILING_WINDOW),
    [hourlyAccuracy]
  );
  // Labelled ticks at day boundaries, thinned so a 30-day window stays legible.
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
  const dailyTicks = useMemo(() => {
    const every = Math.max(1, Math.ceil(dailyAccData.length / 6));
    return dailyAccData.filter((_, i) => i % every === 0).map((p) => p.date);
  }, [dailyAccData]);

  const chartData = useMemo(() => {
    if (!forecast || forecast.status !== 'ok') return [];
    const byDate = new Map<string, { date: string; actual: number | null; predicted: number | null; band: [number, number] | null }>();

    // Historical actuals from snapshots
    for (const s of forecast.snapshots ?? []) {
      byDate.set(s.targetDate, { date: s.targetDate, actual: s.actualKwh, predicted: s.predictedKwh, band: null });
    }
    // Future forecasts (also covers yesterday — see ForecastController — so a day
    // that just rolled from "today" into "yesterday" still gets a band instead of
    // an empty gap while its actual hasn't been backfilled yet).
    for (const f of forecast.forecasts ?? []) {
      const existing = byDate.get(f.date);
      const actual = existing?.actual ?? null;
      byDate.set(f.date, {
        date: f.date,
        actual,
        // Once a day is graded, `existing.predicted` is the TRUE historical
        // prediction (the stored snapshot from whichever model was active then).
        // f.predictedKwh is a live re-hindcast from today's model; using it would
        // silently rewrite history every time the model retrains.
        predicted: actual != null && existing ? existing.predicted : f.predictedKwh,
        // Once the real actual is known it stands on its own, without a band.
        band: actual == null ? [f.lowerBound, f.upperBound] : null,
      });
    }
    const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Anchor the band to the last known actual (a zero-width point), so the band
    // flares out of the actual line instead of starting at full width with a seam.
    let lastActualIdx = -1;
    sorted.forEach((r, i) => { if (r.actual != null) lastActualIdx = i; });
    if (lastActualIdx >= 0 && sorted[lastActualIdx].band == null) {
      const anchor = sorted[lastActualIdx].actual as number;
      sorted[lastActualIdx] = { ...sorted[lastActualIdx], band: [anchor, anchor] };
    }
    return sorted;
  }, [forecast]);

  // About six dates, from the first, so the last label never runs off the right edge.
  const forecastTicks = useMemo(() => {
    const every = Math.max(1, Math.ceil(chartData.length / 6));
    return chartData.filter((_, i) => i % every === 0 && i < chartData.length - 1).map((r) => r.date);
  }, [chartData]);

  const ok = forecast?.status === 'ok';
  const upcoming = ok ? forecast.forecasts ?? [] : [];
  const avgConfidence = upcoming.length ? upcoming.reduce((s, f) => s + f.confidencePct, 0) / upcoming.length : null;
  const projected30 = upcoming.length ? (upcoming.reduce((s, f) => s + f.predictedKwh, 0) / upcoming.length) * 30 : null;
  const graded = accuracy && accuracy.dataPoints > 0 ? accuracy : null;

  // Recharts hands a band as [low, high]; everything else is a number (B-079).
  const forecastTooltip = (value: number | [number, number], name: string): [string, string] => {
    if (Array.isArray(value)) return [`${formatNumber(value[0], { decimals: 1, fixed: true })} – ${kwh(value[1])}`, name];
    return [kwh(value), name];
  };

  const accSeries = accGranularity === 'daily' ? dailyAccData : hourlyAccData;
  const accPending = accGranularity === 'daily' ? rangePending : hourlyPending;
  const accLegend = (
    <ChartLegend
      items={[
        { label: accGranularity === 'daily' ? 'Daily miss' : 'Hourly miss', tone: 'heat', key: 'line' },
        { label: accGranularity === 'daily' ? '7-day average' : '24-hour average', tone: 'ink', key: 'line' },
      ]}
    />
  );

  return (
    <>
      <Panel title="How good is the forecast" subtitle="Checked against the meter every night">
        <Readouts>
          <Readout
            label="Accuracy"
            value={graded ? formatNumber(100 - graded.mape) : DASH}
            unit="%"
            note={graded ? `Over the last 30 days, ${plural(graded.dataPoints, 'day')} checked` : 'Still learning'}
          />
          <Readout label="Typical miss" value={graded ? formatNumber(graded.mae, { decimals: 1, fixed: true }) : DASH} unit="kWh" note="A day, high or low" />
          <Readout
            label="Confidence"
            value={avgConfidence != null ? formatNumber(avgConfidence) : DASH}
            unit="%"
            note={`Average for the next ${plural(days, 'day')}`}
          />
          <Readout label="Next 30 days" value={projected30 != null ? formatNumber(projected30) : DASH} unit="kWh" note="Projected use" />
        </Readouts>
      </Panel>

      <Panel
        title="Forecast"
        subtitle="Recent use, then the days ahead with their likely range"
        action={<Chips label="Days ahead" value={range} onChange={setRange} options={FORECAST_RANGES} />}
      >
        {isLoading ? (
          <SkelBlock height={240} />
        ) : !ok ? (
          <EmptyState icon="bar-chart" title="No forecast yet" compact>
            {forecast?.message ?? 'The forecast needs at least 7 days of use alongside the weather. It builds itself once they are in.'}
          </EmptyState>
        ) : chartData.length < 2 ? (
          <EmptyState icon="bar-chart" title="Waiting for forecast days" compact>The chart fills in after the next nightly update.</EmptyState>
        ) : (
          <div className="fp-stack fp-stack--s">
            <ChartLegend
              items={[
                { label: 'Actual', tone: 'ink', key: 'line' },
                { label: 'Forecast', tone: 'graphite', key: 'dash' },
                { label: 'Likely range', key: 'band' },
                { label: 'Today', key: 'today' },
              ]}
            />
            <ResponsiveContainer width="100%" height={240} debounce={80}>
              <ComposedChart data={chartData} margin={MARGIN}>
                <CartesianGrid {...t.grid} />
                <XAxis dataKey="date" {...t.axis} ticks={forecastTicks} interval="preserveStartEnd" minTickGap={12} tickFormatter={(d: string) => formatShortDate(d)} />
                <YAxis {...t.axis} width={36} />
                <Tooltip {...t.tooltip} labelFormatter={(d: string) => formatDate(d)} formatter={forecastTooltip} />
                <ReferenceLine
                  x={today}
                  {...t.today}
                  label={{ value: 'Today', position: 'top', fill: t.axis.tick.fill, fontSize: 11, fontFamily: t.axis.tick.fontFamily }}
                />
                <Area dataKey="band" name="Likely range" fill={t.series.band} fillOpacity={1} stroke="none" isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="predicted" name="Forecast" stroke={t.series.graphite} strokeWidth={2} strokeDasharray={t.dash} dot={false} isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="actual" name="Actual" stroke={t.series.ink} strokeWidth={2.5} dot={{ fill: t.series.ink, r: 2.5 }} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Split ratio="even">
        <Panel title="By day of week" subtitle="How each day runs above or below what the weather alone predicts, learned from your own history">
          {isLoading ? <SkelBlock height={180} /> : <DowAdjustments dowAdjustments={(ok && forecast.dowAdjustments) || {}} />}
        </Panel>

        <Panel
          title="Forecast misses"
          subtitle="How far off each forecast was. It retrains every night, so this should drift down"
          action={<Chips label="Detail" value={accGranularity} onChange={setAccGranularity} options={GRANULARITIES} />}
        >
          <div className="fp-stack fp-stack--m">
            {accGranularity === 'daily' ? (
              <Chips label="Misses over" value={accRange} onChange={setAccRange} options={ACC_RANGES} />
            ) : (
              <Chips label="Misses over" value={hourlyRange} onChange={setHourlyRange} options={HOURLY_RANGES} />
            )}
            {accPending ? (
              // Still loading: a placeholder, not "nothing to grade" (B-078).
              <SkelBlock height={200} />
            ) : accSeries.length < 2 ? (
              <EmptyState icon="bar-chart" title="Not enough checked forecasts yet" compact>
                {accGranularity === 'daily'
                  ? `Fewer than two days in the last ${RANGE_WORDS[accRange]} have been checked against the meter.`
                  : `No hourly readings to check in the last ${RANGE_WORDS[hourlyRange]} yet.`}
              </EmptyState>
            ) : (
              <div className="fp-stack fp-stack--s">
                {accLegend}
                <ResponsiveContainer width="100%" height={200} debounce={80}>
                  {accGranularity === 'daily' ? (
                    <ComposedChart data={dailyAccData} margin={MARGIN}>
                      <CartesianGrid {...t.grid} />
                      <XAxis dataKey="date" {...t.axis} ticks={dailyTicks} interval="preserveStartEnd" minTickGap={12} tickFormatter={(d: string) => formatShortDate(d)} />
                      <YAxis {...t.axis} width={36} />
                      <Tooltip
                        {...t.tooltip}
                        labelFormatter={(d: string) => formatDate(d)}
                        formatter={(v: number, name: string) => [kwh(v), name === 'trailing' ? '7-day average' : 'Daily miss']}
                      />
                      <Line type="monotone" dataKey="error" stroke={t.series.heat} strokeWidth={1.5} dot={{ fill: t.series.heat, r: 2.5 }} isAnimationActive={false} />
                      <Line type="monotone" dataKey="trailing" stroke={t.series.ink} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  ) : (
                    <ComposedChart data={hourlyAccData} margin={MARGIN}>
                      <CartesianGrid {...t.grid} />
                      <XAxis
                        dataKey="idx"
                        type="number"
                        domain={[0, Math.max(0, hourlyAccData.length - 1)]}
                        ticks={hourlyTicks}
                        {...t.axis}
                        tickFormatter={(idx: number) => {
                          const d = hourlyAccData[idx];
                          return d ? formatShortDate(d.date) : '';
                        }}
                      />
                      <YAxis {...t.axis} width={36} />
                      <Tooltip
                        {...t.tooltip}
                        labelFormatter={(idx: number) => {
                          const d = hourlyAccData[idx];
                          return d ? `${formatDate(d.date)}, ${formatHour(d.hour)}` : '';
                        }}
                        formatter={(v: number, name: string) => [kwh(v, 2), name === 'trailing' ? '24-hour average' : 'Hourly miss']}
                      />
                      <Line type="monotone" dataKey="error" stroke={t.series.heat} strokeWidth={1.25} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="trailing" stroke={t.series.ink} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  )}
                </ResponsiveContainer>
                {accGranularity === 'hourly' && hourlyAccuracy && hourlyAccuracy.dataPoints > 0 && (
                  <p className="fp-small fp-muted">
                    Average miss {kwh(hourlyAccuracy.mae, 2)} an hour over the last {plural(hourlyAccuracy.dataPoints, 'hour')}.
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>
      </Split>
    </>
  );
}

export default memo(ForecastChart);

/**
 * The model's own numbers, for whoever wants them, behind "For the curious" at the foot of
 * the Forecast & stats view. `children` adds more rows (the page's 60-day totals).
 */
export function ForecastModelFacts({ children }: { children?: ReactNode }) {
  const { data: forecast } = useQuery({
    queryKey: ['forecast', 7],
    queryFn: () => fetchForecast(7),
    staleTime: 600_000,
  });
  const { data: accuracy } = useQuery({
    queryKey: ['forecast-accuracy', 30],
    queryFn: () => fetchForecastAccuracy(30),
    staleTime: 600_000,
  });
  const ok = forecast?.status === 'ok';
  const graded = accuracy && accuracy.dataPoints > 0 ? accuracy : null;
  return (
    <section className="fp-panel fp-panel--flush" aria-label="For the curious">
      <Disclosure variant="row" summary="For the curious: the forecast model and raw numbers" openSummary="The forecast model and raw numbers">
        <KeyValue cols>
          <KV label="Trained on" value={ok && forecast.dataPointsUsed != null ? plural(forecast.dataPointsUsed, 'day') : DASH} />
          <KV label="Fit to weather (R², 0 to 1)" value={ok && forecast.rSquared != null ? formatNumber(forecast.rSquared, { decimals: 4, fixed: true }) : DASH} mono />
          <KV label="Average miss (MAE), last 30 days" value={graded ? kwh(graded.mae, 2) : DASH} />
          <KV label="Root-mean-square miss" value={graded ? kwh(graded.rmse, 2) : DASH} />
          <KV label="Average miss, percent" value={graded ? formatPercent(graded.mape, 1) : DASH} />
          <KV label="Forecasts checked, last 30 days" value={graded ? formatNumber(graded.dataPoints) : DASH} />
          {children}
        </KeyValue>
      </Disclosure>
    </section>
  );
}
