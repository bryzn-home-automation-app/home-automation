import { useMemo, useEffect } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import type { WeatherHour, WeatherCurrent } from '../types';
import { getWeatherEmojiForHour, getWeatherCodeDescription } from '../utils/weather';

/** Open-Meteo hourly `time` is naive-local ISO ("YYYY-MM-DDTHH:00"). */
function nowLocalKey(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:00`;
}

/** The next `count` hours from now (inclusive of the current hour). */
export function nextHours(hourly: WeatherHour[] | undefined, count: number): WeatherHour[] {
  if (!hourly?.length) return [];
  const key = nowLocalKey();
  return hourly.filter((h) => typeof h.time === 'string' && h.time >= key).slice(0, count);
}

function hourOf(iso: string): number {
  const m = iso.match(/T(\d{2}):/);
  return m ? Number(m[1]) : 0;
}

function hourLabel(iso: string): string {
  const h = hourOf(iso);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

// ── Inline strip: next few hours, shown on the Home weather bar ──
export function ForecastStrip({ hourly }: { hourly: WeatherHour[] | undefined }) {
  const hours = useMemo(() => nextHours(hourly, 6), [hourly]);
  if (hours.length < 2) return null;

  return (
    <div className="flex items-stretch gap-1.5 sm:gap-2">
      {hours.map((h, i) => {
        const emoji = getWeatherEmojiForHour(h.weatherCode, hourOf(h.time));
        const pop = Math.round(h.precipitationProbability);
        return (
          <div
            key={h.time}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl border border-appborder bg-appinset px-1.5 py-2.5 sm:px-2"
          >
            <span className="text-[10px] font-medium text-apptext-muted">{i === 0 ? 'Now' : hourLabel(h.time)}</span>
            <span className="text-xl leading-none">{emoji}</span>
            <span className="text-sm font-semibold text-apptext">{Math.round(h.temperature)}°</span>
            <span className={`text-[10px] font-medium tabular-nums ${pop > 0 ? 'text-sky-300' : 'text-apptext-dim'}`}>
              {pop > 0 ? `${pop}%` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Full 24-hour forecast modal ──
const CHART_MARGIN = { top: 8, right: 12, left: -8, bottom: 0 } as const;

export function ForecastModal({
  hourly,
  current,
  onClose,
}: {
  hourly: WeatherHour[] | undefined;
  current: WeatherCurrent | null;
  onClose: () => void;
}) {
  const hours = useMemo(() => nextHours(hourly, 24), [hourly]);

  const chartData = useMemo(
    () => hours.map((h) => ({
      label: hourLabel(h.time),
      temp: Math.round(h.temperature),
      pop: Math.round(h.precipitationProbability),
    })),
    [hours],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[4vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="24-hour weather forecast"
    >
      <div
        className="w-full max-w-2xl rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_24px_60px_var(--appshadow-lg)] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Forecast</p>
            <h3 className="mt-1 text-xl font-semibold text-apptext">Next 24 hours</h3>
            {current && (
              <p className="mt-1 text-sm text-apptext-soft">
                Now {Math.round(current.temperature)}° · feels {Math.round(current.apparentTemperature)}° ·
                {' '}{getWeatherCodeDescription(current.weatherCode)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-appborder bg-appinset text-apptext-muted transition-colors hover:border-appborder-hover hover:text-apptext"
          >
            ✕
          </button>
        </div>

        {/* Temperature curve */}
        {chartData.length >= 2 && (
          <div className="mb-5 rounded-2xl border border-appborder bg-appinset p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-apptext-soft">Temperature (°F)</p>
            <ResponsiveContainer width="100%" height={140} debounce={80}>
              <AreaChart data={chartData} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--appaccent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--appaccent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--appchart-grid)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--appchart-tick)', fontSize: 10 }} interval={3} axisLine={{ stroke: 'var(--appchart-grid)' }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--appchart-tick)', fontSize: 10 }} width={32} axisLine={{ stroke: 'var(--appchart-grid)' }} tickLine={false} unit="°" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--appchart-bg)', border: '1px solid var(--appchart-border)', borderRadius: '14px', fontSize: '12px', color: 'var(--apptext)' }}
                  formatter={(v: number, name: string) => name === 'temp' ? [`${v}°F`, 'Temp'] : [`${v}%`, 'Precip']}
                  labelStyle={{ color: 'var(--apptext-muted)', marginBottom: 2 }}
                />
                <Area type="monotone" dataKey="temp" stroke="var(--appaccent)" strokeWidth={2.5} fill="url(#tempFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Hourly detail list */}
        <div className="max-h-[42vh] overflow-y-auto pr-1">
          {/* Header row */}
          <div className="mb-1 grid grid-cols-[3.5rem_2rem_1fr_auto] items-center gap-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-apptext-soft sm:grid-cols-[4rem_2.5rem_1fr_4rem_4rem_4rem]">
            <span>Time</span>
            <span></span>
            <span>Temp</span>
            <span className="hidden text-right sm:block">Precip</span>
            <span className="text-right">Rain</span>
            <span className="hidden text-right sm:block">Wind</span>
          </div>
          <div className="space-y-1">
            {hours.map((h, i) => {
              const emoji = getWeatherEmojiForHour(h.weatherCode, hourOf(h.time));
              const pop = Math.round(h.precipitationProbability);
              return (
                <div
                  key={h.time}
                  className="grid grid-cols-[3.5rem_2rem_1fr_auto] items-center gap-2 rounded-xl border border-appborder-light bg-appinset px-2 py-2 text-sm sm:grid-cols-[4rem_2.5rem_1fr_4rem_4rem_4rem]"
                >
                  <span className="text-xs font-medium text-apptext-soft">{i === 0 ? 'Now' : hourLabel(h.time)}</span>
                  <span className="text-lg leading-none" title={getWeatherCodeDescription(h.weatherCode)}>{emoji}</span>
                  <span className="font-semibold text-apptext">
                    {Math.round(h.temperature)}°
                    <span className="ml-1 text-xs font-normal text-apptext-muted">feels {Math.round(h.apparentTemperature)}°</span>
                  </span>
                  <span className={`hidden text-right text-xs font-medium tabular-nums sm:block ${pop > 0 ? 'text-sky-300' : 'text-apptext-dim'}`}>{pop}%</span>
                  <span className="text-right text-xs tabular-nums text-apptext-soft">
                    {h.precipitation > 0 ? `${h.precipitation.toFixed(2)}"` : '—'}
                  </span>
                  <span className="hidden text-right text-xs tabular-nums text-apptext-soft sm:block">{Math.round(h.windSpeed)} mph</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
