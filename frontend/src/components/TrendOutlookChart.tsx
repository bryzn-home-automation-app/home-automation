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
import { formatDate, formatNumber, formatShortDate, homeToday } from '../utils/format';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import type { DailyUsagePoint } from '../types';
import { ChartLegend, EmptyState, Panel, QueryState, SkelBlock, useChartTheme, type QueryLike } from './ui';

/**
 * Daily use: the last 30 days of actual use (ink) against the forecast (graphite, dashed: the
 * stored prediction for past days, the live forecast from today on), with a Today marker.
 * Band-free; the Forecast & stats view has the likely range.
 */

const HIST_DAYS = 30;
const OUTLOOK_DAYS = 14;
const MARGIN = { top: 18, right: 16, left: 0, bottom: 0 } as const;

/** ISO date + 1 calendar day, in calendar terms (no time-zone shifting). */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

interface Row {
  date: string;
  actual: number | null;
  predicted: number | null;
  /** Tooltip-less connector joining the actual line to the first predicted point. */
  bridge: number | null;
}

interface TrendOutlookChartProps {
  /** The daily-totals query, for its loading and error states. */
  daily: QueryLike<DailyUsagePoint[]>;
  /** Its totals as `{ date, kWh }`, ascending by date. */
  points: Array<{ date: string; kWh: number }>;
}

const kwh = (v: unknown) => (typeof v === 'number' ? formatNumber(v, { decimals: 1, fixed: true, unit: 'kWh' }) : String(v));

function TrendOutlookChart({ daily, points }: TrendOutlookChartProps) {
  const t = useChartTheme();
  const forecastInterval = useJitteredInterval(600_000);
  const today = homeToday();

  const actuals = useMemo(() => points.filter((p) => p.date <= today).slice(-HIST_DAYS), [points, today]);
  const startDate = actuals.length ? actuals[0].date : '';
  // Snapshot window follows the first plotted day (not a fixed day count), so
  // the oldest visible day keeps its stored prediction even across data gaps.
  const historyDays = startDate ? Math.min(90, daysBetween(startDate, today) + 1) : HIST_DAYS;

  // Same key as the forecast chart's 14-day view, so the two share one cached fetch.
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

    // If the last actual day has no prediction of its own, join the actual line
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

  // A tick each week, from the first day, so the axis never crowds on a phone.
  const ticks = useMemo(() => chartData.filter((_, i) => i % 7 === 0).map((r) => r.date), [chartData]);

  return (
    <Panel title="Daily use" subtitle={`The last ${HIST_DAYS} days against the forecast, and the ${OUTLOOK_DAYS} days ahead`}>
      <QueryState
        query={daily}
        what="the daily use"
        loading={<SkelBlock height={240} />}
        empty={
          <EmptyState icon="bar-chart" title="No electric use yet" compact>
            Readings sync each evening once CoServ posts the day.
          </EmptyState>
        }
      >
        {() =>
          chartData.length < 2 ? (
            <EmptyState icon="bar-chart" title="Not enough days to draw yet" compact>
              The line starts once two days have posted.
            </EmptyState>
          ) : (
            <div className="fp-stack fp-stack--s">
              <ChartLegend
                items={[
                  { label: 'Actual', tone: 'ink', key: 'line' },
                  { label: 'Forecast', tone: 'graphite', key: 'dash' },
                  { label: 'Today', key: 'today' },
                ]}
              />
              <ResponsiveContainer width="100%" height={240} debounce={80}>
                <ComposedChart data={chartData} margin={MARGIN}>
                  <CartesianGrid {...t.grid} />
                  <XAxis dataKey="date" {...t.axis} ticks={ticks} interval="preserveStartEnd" minTickGap={12} tickFormatter={(d: string) => formatShortDate(d)} />
                  <YAxis {...t.axis} width={36} />
                  <Tooltip
                    {...t.tooltip}
                    labelFormatter={(d: string) => formatDate(d)}
                    formatter={(value: number, name: string) => [kwh(value), name === 'actual' ? 'Actual' : 'Forecast']}
                  />
                  {/* The label sits above the plot, clear of the lines it marks (B-080). */}
                  <ReferenceLine
                    x={today}
                    {...t.today}
                    label={{ value: 'Today', position: 'top', fill: t.axis.tick.fill, fontSize: 11, fontFamily: t.axis.tick.fontFamily }}
                  />
                  <Line type="monotone" dataKey="bridge" stroke={t.series.graphite} strokeWidth={2} strokeDasharray={t.dash} dot={false} isAnimationActive={false} connectNulls tooltipType="none" />
                  <Line type="monotone" dataKey="predicted" stroke={t.series.graphite} strokeWidth={2} strokeDasharray={t.dash} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="actual" stroke={t.series.ink} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )
        }
      </QueryState>
    </Panel>
  );
}

export default memo(TrendOutlookChart);
