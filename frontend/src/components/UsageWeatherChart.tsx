import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EnergyUsage } from '../types';
import { fetchWeatherForRange } from '../api/weather';

interface UsageWeatherChartProps {
  usageData: EnergyUsage[];
  loading?: boolean;
  startDate: string;
  endDate: string;
}

const chartTheme = {
  tooltipBg: 'var(--appchart-bg)',
  tooltipBorder: 'var(--appchart-border)',
  text: 'var(--apptext)',
  muted: 'var(--apptext-muted)',
  grid: 'var(--appchart-grid)',
  tick: 'var(--appchart-tick)',
};

function formatDateLabel(iso: string): string {
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const localDate = new Date(Number(y), Number(m) - 1, Number(d));
    return localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Skeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-5">
      <div className="mb-4 h-5 w-48 rounded bg-appinset" />
      <div className="h-72 rounded-2xl bg-appinset" />
    </div>
  );
}

function buildDynamicAxis(
  values: Array<number | null | undefined>,
  options?: {
    points?: number;
    padRatio?: number;
    minPad?: number;
    floorZero?: boolean;
    integerTicks?: boolean;
  }
) {
  const points = options?.points ?? 8;
  const padRatio = options?.padRatio ?? 0.12;
  const minPad = options?.minPad ?? 1;
  const floorZero = options?.floorZero ?? false;
  const integerTicks = options?.integerTicks ?? false;

  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length || points < 2) {
    return { domain: undefined, ticks: undefined };
  }

  let min = Math.min(...nums);
  let max = Math.max(...nums);

  if (min === max) {
    const pad = Math.max(minPad, Math.abs(min) * padRatio, 1);
    min -= pad;
    max += pad;
  } else {
    const pad = Math.max(minPad, (max - min) * padRatio);
    min -= pad;
    max += pad;
  }

  if (floorZero) {
    min = Math.max(0, min);
  }

  if (integerTicks) {
    const step = Math.max(1, Math.ceil((max - min) / (points - 1)));
    let lo = Math.floor(min);
    let hi = Math.ceil(max);

    // Guarantee enough room for the requested number of evenly spaced integer ticks.
    while (hi - lo < step * (points - 1)) {
      lo -= 1;
      hi += 1;
    }

    const ticks = Array.from({ length: points }, (_, i) => lo + step * i);
    return {
      domain: [ticks[0], ticks[ticks.length - 1]] as [number, number],
      ticks,
    };
  }

  const step = (max - min) / (points - 1);
  const decimals = step >= 10 ? 0 : step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
  const ticks = Array.from({ length: points }, (_, i) =>
    Number((min + step * i).toFixed(decimals))
  );

  return {
    domain: [ticks[0], ticks[ticks.length - 1]] as [number, number],
    ticks,
  };
}

const TIME_RANGES = [
  { key: '24h',   label: '24h',      count: 24,        useHourly: true },
  { key: '3d',    label: '3 Days',   count: 72,        useHourly: true },
  { key: 'week',  label: '7 Days',   count: 168,       useHourly: true },
  { key: 'month', label: 'Monthly',  count: 30,        useHourly: false },
  { key: 'all',   label: 'All Time', count: Infinity,  useHourly: false },
] as const;
type TimeRangeKey = typeof TIME_RANGES[number]['key'];

function UsageWeatherChart({
  usageData,
  loading: usageLoading,
  startDate,
  endDate,
}: UsageWeatherChartProps) {
  const [range, setRange] = useState<TimeRangeKey>('24h');
  const dateStart = typeof startDate === 'string' ? startDate.slice(0, 10) : '';
  const dateEnd = typeof endDate === 'string' ? endDate.slice(0, 10) : '';
  const weatherEnabled = dateStart !== '' && dateEnd !== '';

  const {
    data: weather,
    isLoading: weatherLoading,
    isError: weatherError,
  } = useQuery({
    queryKey: ['weather', dateStart, dateEnd],
    queryFn: () => fetchWeatherForRange(dateStart, dateEnd),
    enabled: weatherEnabled,
    staleTime: 60_000,
    refetchInterval: 30_000,
  });

  // Build merged chart data — hourly for 24h/3d/week/month, daily for All Time
  const { chartData, hourlyData, useHourly } = useMemo(() => {
    const weatherByDate = new Map<string, { mean: number; high: number; low: number }>();
    if (weather?.daily) {
      for (const w of weather.daily) {
        if (typeof w.date !== 'string' || !w.date) continue;
        if (typeof w.meanTemperature !== 'number' || Number.isNaN(w.meanTemperature)) continue;
        weatherByDate.set(w.date, {
          mean: w.meanTemperature,
          high: typeof w.maxTemperature === 'number' ? w.maxTemperature : w.meanTemperature,
          low: typeof w.minTemperature === 'number' ? w.minTemperature : w.meanTemperature,
        });
      }
    }

    // Aggregate electric by date AND by hour for the kWh line
    const byDate = new Map<string, number>();
    const byHour = new Map<string, number>(); // key: "2026-08-07T14" to match weather format
    const isHourlySource = (d: EnergyUsage) =>
      d.source === 'CoServ Average Usage'; // only these have per-hour granularity
    for (const d of usageData) {
      if (typeof d.timestamp !== 'string' || d.timestamp.length < 10) continue;
      const date = d.timestamp.slice(0, 10);
      const usage = Number(d.usageKwh);
      if (Number.isNaN(usage)) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + usage);
      // Only map hourly-source records to hour buckets — daily records
      // (Green Button) would put 50+ kWh at midnight, skewing the chart.
      if (isHourlySource(d)) {
        // Normalize "2026-08-07 14:00:00" → "2026-08-07T14" to match weather format
        const normalized = d.timestamp.replace(' ', 'T');
        if (normalized.length >= 13) {
          const hourKey = normalized.substring(0, 13);
          byHour.set(hourKey, (byHour.get(hourKey) ?? 0) + usage);
        }
      }
    }

    const daily = Array.from(byDate.entries())
      .map(([date, kWh]) => {
        const w = weatherByDate.get(date);
        return {
          date,
          label: formatDateLabel(date),
          kWh: Math.round(kWh * 100) / 100,
          avgTemp: w?.mean ?? null,
          highTemp: w?.high ?? null,
          lowTemp: w?.low ?? null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // Hourly data — pull enough for the widest hourly-capable filter (weekly = 7d)
    let hourly: any[] = [];
    if (weather?.hourly) {
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - 192 * 60 * 60 * 1000); // 8 days
      const cutoffLocal = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}T00:00`;
      hourly = weather.hourly
        .filter((h: any) => h.time >= cutoffLocal && h.temperature > 0)
        .map((h: any) => {
          const d = new Date(h.time);
          const hour = d.getHours();
          const ampm = hour >= 12 ? 'PM' : 'AM';
          const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          // 24h: show hour labels. Multi-day hourly: show date at midnight, empty otherwise.
          const dateLabel = hour === 0 ? formatDateLabel(h.time) : '';
          const isMultiDay = range === '3d' || range === 'week';
          return {
            time: h.time,
            label: isMultiDay && hour !== 0 ? '' : isMultiDay ? dateLabel : `${h12}${ampm}`,
            date: h.time.slice(0, 10),
            temp: h.temperature,
            highTemp: h.temperature,
            lowTemp: h.temperature,
            avgTemp: h.temperature,
            apparentTemp: h.apparentTemperature,
            humidity: h.humidity,
            // Prefer per-hour kWh, fall back to daily total
            kWh: byHour.get(h.time.substring(0, 13)) ?? byDate.get(h.time.slice(0, 10)) ?? null,
          };
        });
    }

    const rangeConfig = TIME_RANGES.find((r) => r.key === range);
    const useH = (rangeConfig?.useHourly ?? false) && hourly.length >= 2;
    return { chartData: daily, hourlyData: hourly, useHourly: useH };
  }, [usageData, weather, range]);

  // Client-side time-range filter
  const filteredData = useMemo(() => {
    const rangeConfig = TIME_RANGES.find((r) => r.key === range);
    let result: any[];

    if (useHourly) {
      // Filter to only complete data points (both kWh + temp), then take
      // the last N matching entries. Electric lags behind temperature because
      // the meter updates once daily — incomplete points are silently dropped.
      const complete = hourlyData.filter((row: any) => row.kWh != null && row.temp != null);
      if (rangeConfig && isFinite(rangeConfig.count)) {
        result = complete.slice(-rangeConfig.count);
      } else {
        result = complete.slice(-24);
      }
      return result;
    }

    // Daily data: take the last N entries directly
    if (!rangeConfig || !isFinite(rangeConfig.count)) return chartData;
    return chartData.slice(-rangeConfig.count);
  }, [chartData, hourlyData, range, useHourly]);

  const hasWeather = filteredData.some((row: any) => (row.avgTemp ?? row.temp) != null);
  const showDots = filteredData.length <= 5;

  // Compute dynamic, evenly spaced axis ticks
  const { kwhDomain, kwhTicks } = useMemo(() => {
    const axis = buildDynamicAxis(
      filteredData.map((row) => row.kWh),
      { points: 8, padRatio: 0.12, minPad: 1, floorZero: true, integerTicks: true }
    );
    return { kwhDomain: axis.domain, kwhTicks: axis.ticks };
  }, [filteredData]);

  const { tempDomain, tempTicks } = useMemo(() => {
    const tempValues = useHourly
      ? filteredData.map((row: any) => row.temp)
      : filteredData.flatMap((row: any) => [row.avgTemp, row.highTemp, row.lowTemp]);

    const axis = buildDynamicAxis(
      tempValues,
      { points: 8, padRatio: 0.1, minPad: 2, floorZero: false, integerTicks: true }
    );
    return { tempDomain: axis.domain, tempTicks: axis.ticks };
  }, [filteredData, useHourly]);

  if (usageLoading || (weatherEnabled && weatherLoading)) {
    return <Skeleton />;
  }

  if (!usageData.length) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Correlation</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Usage vs Temperature</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          No electric usage data yet.
        </div>
      </div>
    );
  }

  if (weatherError && !hasWeather) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Correlation</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Electric Usage vs Temperature</h3>
        </div>
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          Weather data is unavailable right now. Usage chart data is still loading normally.
        </div>
      </div>
    );
  }

  // Shared header + filters block
  const header = (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Correlation</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Electric Usage vs Temperature</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">kWh</span>
          {hasWeather && <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">°F</span>}
        </div>
      </div>
      {useHourly && (() => {
        const dates = [...new Set(filteredData.map((row: any) => row.date).filter(Boolean))].sort();
        const rangeText = dates.length === 1
          ? dates[0]
          : dates.length > 1
          ? `${dates[0]} — ${dates[dates.length - 1]}`
          : '';
        return (
          <div className="mb-3 rounded-2xl border border-amber-300/10 bg-amber-300/5 px-3 py-2 text-xs text-amber-200/70">
            ⚡ Showing {filteredData.length} complete data points{rangeText && ` for ${rangeText}`}. Meter updates once daily — today's readings may not be available yet.
          </div>
        );
      })()}
      <div className="mb-4 flex gap-1.5">
        {TIME_RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              range === r.key
                ? 'bg-appaccent-soft text-appaccent-text border border-appaccent-border'
                : 'text-apptext-muted hover:text-apptext-soft border border-transparent hover:border-appborder'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </>
  );

  if (filteredData.length < 2) {
    return (
      <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        {header}
        <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
          Not enough data for {TIME_RANGES.find((r) => r.key === range)?.label ?? 'this range'}. Try a wider filter.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      {header}

      <ResponsiveContainer width="100%" height={320} debounce={80}>
        <LineChart data={filteredData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
          <XAxis
            dataKey="label"
            tick={{ fill: chartTheme.tick, fontSize: 11 }}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={false}
            interval={useHourly ? 0 : 'preserveStartEnd'}
          />

          <YAxis yAxisId="left" tick={{ fill: chartTheme.tick, fontSize: 11 }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} unit=" kWh" domain={kwhDomain as [number, number]} ticks={kwhTicks} />
          {hasWeather && <YAxis yAxisId="right" orientation="right" tick={{ fill: '#f59e0b', fontSize: 11 }} axisLine={{ stroke: chartTheme.grid }} tickLine={false} unit="°" domain={tempDomain as [number, number]} ticks={tempTicks} tickFormatter={(value) => `${Math.round(Number(value))}`} />}

          <Tooltip
            contentStyle={{ backgroundColor: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '16px', fontSize: '13px', color: chartTheme.text, boxShadow: '0 20px 50px var(--appshadow-lg)' }}
            formatter={(value: number, name: string) => {
              if (name === 'kWh') return [`${value.toFixed(2)} kWh`, 'Usage'];
              if (name === 'avgTemp' || name === 'temp') return [`${Math.round(value)}°F`, 'Temp'];
              if (name === 'highTemp') return [`${Math.round(value)}°F`, 'High'];
              if (name === 'lowTemp') return [`${Math.round(value)}°F`, 'Low'];
              return [value, name];
            }}
            labelFormatter={(label: string, payload: any) => {
              // Show full timestamp in tooltip for hourly data
              if (useHourly && payload?.[0]?.payload?.time) {
                const d = new Date(payload[0].payload.time);
                return d.toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                });
              }
              return label;
            }}
            labelStyle={{ color: chartTheme.muted, marginBottom: 4 }}
          />

          {/* Electric usage — tight line for hourly, bolder for daily */}
          {useHourly ? (
            <Line yAxisId="left" type="monotone" dataKey="kWh" stroke="#34d399" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          ) : (
            <Line yAxisId="left" type="monotone" dataKey="kWh" stroke="#34d399" strokeWidth={2.5} dot={showDots ? { fill: '#34d399', r: 4 } : false} isAnimationActive={false} connectNulls />
          )}

          {/* Temperature — amber dashed line */}
          {hasWeather && <Line yAxisId="right" type="monotone" dataKey={useHourly ? 'temp' : 'avgTemp'} stroke="#f59e0b" strokeWidth={2} dot={useHourly ? false : (showDots ? { fill: '#f59e0b', r: 4 } : false)} isAnimationActive={false} connectNulls strokeDasharray="8 3" />}

          {/* High / Low — only for daily (All Time) view where we have distinct min/max aggregates */}
          {hasWeather && !useHourly && <Line yAxisId="right" type="monotone" dataKey="highTemp" stroke="#f87171" strokeWidth={1.5} dot={showDots ? { fill: '#f87171', r: 3 } : false} isAnimationActive={false} connectNulls strokeDasharray="2 4" />}
          {hasWeather && !useHourly && <Line yAxisId="right" type="monotone" dataKey="lowTemp" stroke="#38bdf8" strokeWidth={1.5} dot={showDots ? { fill: '#38bdf8', r: 3 } : false} isAnimationActive={false} connectNulls strokeDasharray="2 4" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(UsageWeatherChart);
