import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { EnergyUsage } from '../types';
import { fetchWeatherForRange } from '../api/weather';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { isHourlySource } from '../utils/usageSource';
import { formatDate, formatDateTime, formatHour, formatNumber, formatShortDate, formatTemp, homeToday } from '../utils/format';
import { ChartLegend, Chips, EmptyState, Notice, Panel, QueryState, SkelBlock, useChartTheme, type QueryLike } from './ui';
import { niceTicks } from '../pages/utility/parts';

interface UsageWeatherChartProps {
  /** The hourly usage query, for its loading and error states. */
  usage: QueryLike<EnergyUsage[]>;
  startDate: string;
  endDate: string;
}

const MARGIN = { top: 6, right: 8, left: 0, bottom: 0 } as const;

const TIME_RANGES = [
  { value: '24h', label: '24 hours', points: 24, hourly: true },
  { value: '3d', label: '3 days', points: 72, hourly: true },
  { value: 'week', label: '7 days', points: 168, hourly: true },
  { value: 'month', label: '30 days', points: 30, hourly: false },
  { value: 'all', label: 'All', points: Infinity, hourly: false },
] as const;
type TimeRangeKey = (typeof TIME_RANGES)[number]['value'];

interface Point {
  /** The x key: "YYYY-MM-DDTHH:00" for hours, "YYYY-MM-DD" for days. */
  x: string;
  kWh: number | null;
  temp: number | null;
  highTemp: number | null;
  lowTemp: number | null;
}

/** Calendar date `days` before an ISO day. */
function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Use and temperature: electricity used over the outside temperature, as two charts stacked
 * on one time axis (one scale each; scrubbing either shows the same moment in both). Hourly for
 * the short ranges, daily highs and lows for the long ones.
 */
function UsageWeatherChart({ usage, startDate, endDate }: UsageWeatherChartProps) {
  const t = useChartTheme();
  const [range, setRange] = useState<TimeRangeKey>('24h');
  const weatherInterval = useJitteredInterval(3_600_000, 60_000);
  const usageData = usage.data;

  const dateStart = typeof startDate === 'string' ? startDate.slice(0, 10) : '';
  const dateEnd = typeof endDate === 'string' ? endDate.slice(0, 10) : '';
  const weatherEnabled = dateStart !== '' && dateEnd !== '';

  const { data: weather, isLoading: weatherLoading, isError: weatherError } = useQuery({
    queryKey: ['weather', dateStart, dateEnd],
    queryFn: () => fetchWeatherForRange(dateStart, dateEnd),
    enabled: weatherEnabled,
    staleTime: 3_600_000,
    refetchInterval: weatherInterval,
    refetchIntervalInBackground: false,
  });

  const weatherByDate = useMemo(() => {
    const map = new Map<string, { mean: number; high: number; low: number }>();
    for (const w of weather?.daily ?? []) {
      if (typeof w.date !== 'string' || !w.date) continue;
      if (typeof w.meanTemperature !== 'number' || Number.isNaN(w.meanTemperature)) continue;
      map.set(w.date, {
        mean: w.meanTemperature,
        high: typeof w.maxTemperature === 'number' ? w.maxTemperature : w.meanTemperature,
        low: typeof w.minTemperature === 'number' ? w.minTemperature : w.meanTemperature,
      });
    }
    return map;
  }, [weather]);

  // ── Electric usage by day and by hour ──
  const { byDate, byHour } = useMemo(() => {
    const hourlyDateMap = new Map<string, number>();
    const dailyDateMap = new Map<string, number>();
    const hourMap = new Map<string, number>();
    for (const d of usageData ?? []) {
      if (typeof d.timestamp !== 'string' || d.timestamp.length < 10) continue;
      const kwh = Number(d.usageKwh);
      if (Number.isNaN(kwh)) continue;
      const date = d.timestamp.slice(0, 10);
      if (isHourlySource(d.source)) {
        hourlyDateMap.set(date, (hourlyDateMap.get(date) ?? 0) + kwh);
        const normalized = d.timestamp.replace(' ', 'T');
        if (normalized.length >= 13) {
          const hourKey = normalized.substring(0, 13);
          hourMap.set(hourKey, (hourMap.get(hourKey) ?? 0) + kwh);
        }
      } else {
        dailyDateMap.set(date, (dailyDateMap.get(date) ?? 0) + kwh);
      }
    }
    // Prefer the hourly sum per date; fall back to a daily record when no hourly data exists.
    const dateMap = new Map<string, number>();
    for (const date of new Set([...hourlyDateMap.keys(), ...dailyDateMap.keys()])) {
      dateMap.set(date, hourlyDateMap.get(date) ?? dailyDateMap.get(date) ?? 0);
    }
    return { byDate: dateMap, byHour: hourMap };
  }, [usageData]);

  const dailyData = useMemo<Point[]>(
    () =>
      Array.from(byDate.entries())
        .map(([date, kWh]) => {
          const w = weatherByDate.get(date);
          return { x: date, kWh: Math.round(kWh * 100) / 100, temp: w?.mean ?? null, highTemp: w?.high ?? null, lowTemp: w?.low ?? null };
        })
        .sort((a, b) => a.x.localeCompare(b.x)),
    [byDate, weatherByDate]
  );

  // Hours from the last eight home days that have both a reading and a temperature.
  const hourlyData = useMemo<Point[]>(() => {
    const cutoff = `${daysBefore(homeToday(), 8)}T00:00`;
    return (weather?.hourly ?? [])
      .filter((h) => typeof h.time === 'string' && h.time >= cutoff && h.temperature > 0)
      .map((h) => {
        const x = h.time.substring(0, 16);
        return { x, kWh: byHour.get(h.time.substring(0, 13)) ?? null, temp: h.temperature, highTemp: null, lowTemp: null };
      })
      .filter((p) => p.kWh != null);
  }, [weather, byHour]);

  const rangeConfig = TIME_RANGES.find((r) => r.value === range) ?? TIME_RANGES[0];
  const useHourly = rangeConfig.hourly && hourlyData.length >= 2;

  const shown = useMemo<Point[]>(() => {
    if (useHourly) return hourlyData.slice(-rangeConfig.points);
    if (!Number.isFinite(rangeConfig.points)) {
      // Cap the all-time line with an even stride so it never draws more than 500 segments.
      const MAX = 500;
      if (dailyData.length <= MAX) return dailyData;
      const step = (dailyData.length - 1) / (MAX - 1);
      return Array.from({ length: MAX }, (_, i) => dailyData[Math.round(i * step)]);
    }
    return dailyData.slice(-rangeConfig.points);
  }, [useHourly, hourlyData, dailyData, rangeConfig]);

  // Explicit ticks: midnights for the multi-day hourly views, every fourth hour for 24 hours,
  // about six dates for the daily views. Keyed on the unique x, so a missing hour or a part-
  // posted day can't knock the labels off (B-019).
  const ticks = useMemo(() => {
    if (useHourly && range === '24h') return shown.filter((_, i) => i % 4 === 0).map((p) => p.x);
    if (useHourly) return shown.filter((p) => p.x.endsWith('T00:00')).map((p) => p.x);
    const every = Math.max(1, Math.ceil(shown.length / 6));
    return shown.filter((_, i) => i % every === 0).map((p) => p.x);
  }, [shown, useHourly, range]);
  const tickFormatter = (x: string) => (useHourly && range === '24h' ? formatHour(x) : formatShortDate(x.slice(0, 10)));
  const labelFormatter = (x: string) => (useHourly ? formatDateTime(x) : formatDate(x));

  const hasWeather = shown.some((p) => p.temp != null || p.highTemp != null);
  const kwhTicks = useMemo(() => niceTicks(shown.map((p) => p.kWh), { floorZero: true }), [shown]);
  const tempTicks = useMemo(
    () => niceTicks(useHourly ? shown.map((p) => p.temp) : shown.flatMap((p) => [p.highTemp, p.lowTemp]), { pad: 1 }),
    [shown, useHourly]
  );
  const lastDay = shown.length ? shown[shown.length - 1].x.slice(0, 10) : null;
  const syncId = 'utility-uvt';
  // preserveStartEnd lets Recharts drop a tick that would collide on a narrow phone.
  const xAxis = { dataKey: 'x', ...t.axis, ticks, interval: 'preserveStartEnd' as const, minTickGap: 12, tickFormatter };

  return (
    <Panel title="Use and temperature" subtitle="Cold nights and hot afternoons drive the bill. Scrub either chart to compare the same moment">
      <div className="fp-stack">
        <Chips label="Range" value={range} onChange={setRange} options={TIME_RANGES} />
        <QueryState
          query={usage}
          what="the readings"
          loading={<SkelBlock height={300} />}
          empty={
            <EmptyState icon="bar-chart" title="No electric use yet" compact>
              Readings sync each evening once CoServ posts the day.
            </EmptyState>
          }
        >
          {() =>
            weatherEnabled && weatherLoading ? (
              <SkelBlock height={300} />
            ) : shown.length < 2 ? (
              <EmptyState icon="bar-chart" title={`Not enough readings for ${rangeConfig.label.toLowerCase()}`} compact>
                Try a longer range.
              </EmptyState>
            ) : (
              <div className="fp-stack fp-stack--m">
                {weatherError && !hasWeather && (
                  // The usage still draws; only the temperature is missing (B-090).
                  <Notice tone="headsup">Temperature is unavailable right now, so this shows use only.</Notice>
                )}
                {useHourly && lastDay && (
                  <Notice tone="neutral">
                    {formatDate(lastDay)} is the latest day with readings. The meter reports once a day, so today isn&rsquo;t in yet.
                  </Notice>
                )}
                <p className="fp-label">Electricity used</p>
                <ResponsiveContainer width="100%" height={170} debounce={80}>
                  <LineChart data={shown} margin={MARGIN} syncId={syncId}>
                    <CartesianGrid {...t.grid} />
                    <XAxis {...xAxis} />
                    <YAxis {...t.axis} width={36} ticks={kwhTicks} domain={kwhTicks ? [kwhTicks[0], kwhTicks[kwhTicks.length - 1]] : undefined} />
                    <Tooltip
                      {...t.tooltip}
                      labelFormatter={labelFormatter}
                      formatter={(v: number) => [formatNumber(v, { decimals: 2, fixed: true, unit: 'kWh' }), 'Used']}
                    />
                    <Line
                      type="monotone"
                      dataKey="kWh"
                      stroke={t.series.ink}
                      strokeWidth={useHourly ? 1.5 : 2.5}
                      dot={shown.length <= 5 ? { fill: t.series.ink, r: 3 } : false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
                {hasWeather && (
                  <>
                    <div className="fp-spread">
                      <p className="fp-label">Temperature outside</p>
                      {!useHourly && (
                        <ChartLegend items={[{ label: 'High', tone: 'heat', key: 'line' }, { label: 'Low', tone: 'cool', key: 'line' }]} />
                      )}
                    </div>
                    <ResponsiveContainer width="100%" height={120} debounce={80}>
                      <LineChart data={shown} margin={MARGIN} syncId={syncId}>
                        <CartesianGrid {...t.grid} />
                        <XAxis {...xAxis} />
                        <YAxis {...t.axis} width={36} ticks={tempTicks} domain={tempTicks ? [tempTicks[0], tempTicks[tempTicks.length - 1]] : undefined} tickFormatter={(v: number) => formatTemp(v)} />
                        <Tooltip
                          {...t.tooltip}
                          labelFormatter={labelFormatter}
                          formatter={(v: number, name: string) => [
                            formatTemp(v),
                            name === 'highTemp' ? 'High' : name === 'lowTemp' ? 'Low' : 'Outside',
                          ]}
                        />
                        {useHourly ? (
                          <Line type="monotone" dataKey="temp" stroke={t.series.heat} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                        ) : (
                          <>
                            <Line type="monotone" dataKey="highTemp" stroke={t.series.heat} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
                            <Line type="monotone" dataKey="lowTemp" stroke={t.series.cool} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>
            )
          }
        </QueryState>
      </div>
    </Panel>
  );
}

export default memo(UsageWeatherChart);
