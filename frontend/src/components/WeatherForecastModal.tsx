import { Fragment, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import type { WeatherHour, WeatherCurrent } from '../types';
import { Dialog, Icon, cx, useChartTheme } from './ui';
import {
  formatDate, formatDateTime, formatDayName, formatHour, formatNumber, formatPercent, formatTemp, homeDayKey,
} from '../utils/format';
import {
  getWeatherCodeDescription, isNightAt, isWet, nextHours, weatherIcon, type SunPlace,
} from '../utils/weather';

// The 24-hour forecast dialog, split from Home so recharts (~110 KB gz) loads only when
// someone opens it. The kit Dialog gives it focus, Escape, the back gesture, the scroll lock
// and an opaque panel (B-043, B-008); the page renders it only while it is open.

const CHART_MARGIN = { top: 6, right: 8, left: 0, bottom: 0 } as const;
const COLS = 'grid grid-cols-[52px_28px_minmax(0,1fr)_52px_60px] items-center gap-2 sm:grid-cols-[60px_32px_minmax(0,1fr)_72px_72px_64px]';

/** "Tomorrow · Tue, Nov 10": a relative name alone doesn't say which day it is. */
function dayHeading(day: string): string {
  const name = formatDayName(day);
  const date = formatDate(day);
  return name === date ? date : `${name} · ${date}`;
}

/** Every 4th hour gets a tick label; the rest stay blank so a phone axis doesn't crowd. */
function tickEvery4(time: string, i: number): string {
  return i % 4 === 0 ? formatHour(time) : '';
}

export default function ForecastModal({
  hourly,
  current,
  place,
  onClose,
}: {
  hourly: WeatherHour[] | undefined;
  current: WeatherCurrent | null;
  place?: SunPlace | null;
  onClose: () => void;
}) {
  const t = useChartTheme();
  const hours = useMemo(() => nextHours(hourly, 24), [hourly]);

  const chartData = useMemo(
    () => hours.map((h) => ({
      time: h.time,
      temp: Math.round(h.temperature),
      pop: Math.round(h.precipitationProbability),
    })),
    [hours],
  );
  // Fit the axis to the day's range, on whole 5° steps (B-062: from 0° the curve was a flat line).
  const tempAxis = useMemo(() => {
    if (!chartData.length) return { domain: [0, 100] as [number, number], ticks: [0, 50, 100] };
    const temps = chartData.map((d) => d.temp);
    const lo = Math.floor((Math.min(...temps) - 2) / 5) * 5;
    const hi = Math.ceil((Math.max(...temps) + 2) / 5) * 5;
    const mid = Math.round((lo + hi) / 2 / 5) * 5;
    return { domain: [lo, hi] as [number, number], ticks: mid > lo && mid < hi ? [lo, mid, hi] : [lo, hi] };
  }, [chartData]);
  const totalRain = useMemo(() => hours.reduce((s, h) => s + (h.precipitation > 0 ? h.precipitation : 0), 0), [hours]);

  const subtitle = current
    ? `Now ${formatTemp(current.temperature)}, feels like ${formatTemp(current.apparentTemperature)}, ${getWeatherCodeDescription(current.weatherCode).toLowerCase()}.${
      totalRain >= 0.01 ? ` About ${formatNumber(totalRain, { decimals: 2, unit: 'in' })} of rain in the next 24 hours.` : ''}`
    : undefined;

  return (
    <Dialog open onClose={onClose} eyebrow="Forecast" title="Next 24 hours" subtitle={subtitle}>
      {hours.length === 0 ? (
        <p className="text-apptext-muted">The hourly forecast hasn't come in yet. It refreshes every hour.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {chartData.length >= 2 && (
            <figure>
              <figcaption className="fp-label mb-2">Temperature</figcaption>
              <ResponsiveContainer width="100%" height={132} debounce={80}>
                <AreaChart data={chartData} margin={CHART_MARGIN} syncId="home-forecast">
                  <CartesianGrid {...t.grid} />
                  <XAxis dataKey="time" {...t.axis} tickFormatter={tickEvery4} interval={0} />
                  <YAxis {...t.axis} width={44} unit="°" domain={tempAxis.domain} ticks={tempAxis.ticks} />
                  <Tooltip
                    {...t.tooltip}
                    labelFormatter={(v) => formatDateTime(String(v))}
                    formatter={(v: number) => [formatTemp(v), 'Temperature']}
                  />
                  <Area type="monotone" dataKey="temp" stroke={t.series.ink} strokeWidth={2} fill={t.series.band} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </figure>
          )}
          {chartData.length >= 2 && (
            <figure>
              <figcaption className="fp-label mb-2">Chance of rain</figcaption>
              <ResponsiveContainer width="100%" height={72} debounce={80}>
                <BarChart data={chartData} margin={CHART_MARGIN} syncId="home-forecast">
                  <CartesianGrid {...t.grid} />
                  <XAxis dataKey="time" {...t.axis} tickFormatter={tickEvery4} interval={0} hide />
                  <YAxis {...t.axis} width={44} unit="%" domain={[0, 100]} ticks={[0, 50, 100]} />
                  <Tooltip
                    {...t.tooltip}
                    cursor={t.barCursor}
                    labelFormatter={(v) => formatDateTime(String(v))}
                    formatter={(v: number) => [formatPercent(v), 'Chance of rain']}
                  />
                  <Bar dataKey="pop" fill={t.series.cool} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          )}

          {/* Hour by hour. On a phone the chance of rain stays and the amount sits beside it
              (B-015: the phone used to show only the amount, "—" all evening). Wind joins from 640px. */}
          <div role="table" aria-label="Hour by hour" className="-mx-1 flex flex-col tabular-nums">
            <div role="row" className={cx(COLS, 'min-h-[30px] border-b border-appborder-strong px-1')}>
              <span role="columnheader" className="fp-label">Time</span>
              <span role="columnheader"><span className="fp-sr-only">Sky</span></span>
              <span role="columnheader" className="fp-label">Temp</span>
              <span role="columnheader" className="fp-label text-right">Chance</span>
              <span role="columnheader" className="fp-label text-right">Rain</span>
              <span role="columnheader" className="fp-label hidden text-right sm:block">Wind</span>
            </div>
            {hours.map((h, i) => {
              const day = homeDayKey(h.time) ?? '';
              const newDay = i > 0 && day !== homeDayKey(hours[i - 1].time);
              const wet = isWet(h.weatherCode);
              return (
                <Fragment key={h.time}>
                  {newDay && (
                    <div role="row" className="border-b border-appborder-strong px-1 pb-1.5 pt-4">
                      <span role="cell" className="fp-label">{dayHeading(day)}</span>
                    </div>
                  )}
                  <div
                    role="row"
                    className={cx(
                      COLS,
                      'min-h-10 px-1 text-[14px]',
                      i === 0 ? 'rounded-well bg-appinset' : 'border-b border-appborder',
                    )}
                    aria-current={i === 0 ? 'time' : undefined}
                  >
                    <span role="cell" className={cx('font-mono text-2xs', i === 0 ? 'font-medium text-apptext' : 'text-apptext-muted')}>
                      {formatHour(h.time)}
                    </span>
                    <span role="cell">
                      <Icon
                        name={weatherIcon(h.weatherCode, isNightAt(h.time, place))}
                        title={getWeatherCodeDescription(h.weatherCode)}
                        className={cx('text-[20px]', wet && 'text-appchart-cool')}
                      />
                    </span>
                    <span role="cell" className="min-w-0 truncate">
                      <b className="font-semibold">{formatTemp(h.temperature)}</b>{' '}
                      <span className="text-[12.5px] text-apptext-muted">feels {formatTemp(h.apparentTemperature)}</span>
                    </span>
                    <span role="cell" className="whitespace-nowrap text-right">{formatPercent(h.precipitationProbability)}</span>
                    <span role="cell" className={cx('whitespace-nowrap text-right', h.precipitation > 0 ? 'text-apptext' : 'text-apptext-muted')}>
                      {h.precipitation > 0 ? formatNumber(h.precipitation, { decimals: 2, fixed: true, unit: 'in' }) : '—'}
                    </span>
                    <span role="cell" className="hidden whitespace-nowrap text-right sm:block">
                      {formatNumber(h.windSpeed, { unit: 'mph' })}
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
