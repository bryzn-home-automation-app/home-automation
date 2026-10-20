import { useMemo } from 'react';
import type { WeatherHour } from '../types';
import { getWeatherEmojiForHour } from '../utils/weather';

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

export function hourOf(iso: string): number {
  const m = iso.match(/T(\d{2}):/);
  return m ? Number(m[1]) : 0;
}

export function hourLabel(iso: string): string {
  const h = hourOf(iso);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

/** "Today"/"Tomorrow" + weekday/date label for a YYYY-MM-DD key. */
export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const rel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : null;
  const fmt = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return rel ? `${rel} · ${fmt}` : fmt;
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
            <span className="text-3xs font-medium text-apptext-muted">{i === 0 ? 'Now' : hourLabel(h.time)}</span>
            <span className="text-xl leading-none">{emoji}</span>
            <span className="text-sm font-semibold text-apptext">{Math.round(h.temperature)}°</span>
            <span className={`text-3xs font-medium tabular-nums ${pop > 0 ? 'text-sky-300' : 'text-apptext-dim'}`}>
              {pop > 0 ? `${pop}%` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
