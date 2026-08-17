import { useQuery } from '@tanstack/react-query';
import { fetchWeatherForRange } from '../api/weather';
import { getWeatherEmoji } from '../utils/weather';
import type { WeatherHour } from '../types';

interface Weather24HourCardProps {
  startDate: string;
  endDate: string;
}

// ── Helpers ──────────────────────────────────────────────────

function formatTemp(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value)}°F`;
}

function formatHourTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}${ampm}`;
}

// ── Skeleton ─────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-5">
      <div className="mb-4 h-4 w-32 rounded bg-appinset" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-appborder-light bg-appinset p-3">
            <div className="mb-2 h-3 w-16 rounded bg-appinset-strong" />
            <div className="h-7 w-20 rounded bg-appinset-strong" />
          </div>
        ))}
      </div>
      <div className="mt-4 h-2 rounded-full bg-appinset" />
    </div>
  );
}

// ── Hourly Sparkline ─────────────────────────────────────────

function HourlySparkline({ hours }: { hours: WeatherHour[] }) {
  const temps = hours.map((h) => h.temperature).filter((t) => t > 0);
  if (temps.length < 2) return null;

  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const range = max - min || 1;

  return (
    <div className="mt-4 flex items-end gap-[2px] h-10">
      {hours.map((h, i) => {
        const height = h.temperature > 0
          ? Math.max(8, ((h.temperature - min) / range) * 100)
          : 4;
        return (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-appaccent-soft/60 hover:bg-appaccent transition-colors"
            style={{ height: `${height}%` }}
            title={`${formatHourTime(h.time)}: ${formatTemp(h.temperature)}`}
          />
        );
      })}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

export default function Weather24HourCard({
  startDate,
  endDate,
}: Weather24HourCardProps) {
  const dateStart = startDate.slice(0, 10);
  const dateEnd = endDate.slice(0, 10);
  const enabled = dateStart !== '' && dateEnd !== '';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['weather', dateStart, dateEnd],
    queryFn: () => fetchWeatherForRange(dateStart, dateEnd),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled || isError) return null;
  if (isLoading) return <Skeleton />;
  if (!data) return null;

  // Take the last 24 hours of hourly data
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const last24h = data.hourly.filter((h) => h.time >= cutoff && h.temperature > 0);

  if (last24h.length < 2) return null;

  const temps = last24h.map((h) => h.temperature);
  const hi = Math.max(...temps);
  const lo = Math.min(...temps);
  const avg = temps.reduce((s, t) => s + t, 0) / temps.length;
  const current = data.current;
  const nowHour = last24h[last24h.length - 1];
  const humidity = nowHour?.humidity;
  const precip = last24h.reduce((s, h) => s + h.precipitation, 0);
  const emoji = getWeatherEmoji(nowHour?.weatherCode ?? 0);

  return (
    <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Last 24 Hours
        </p>
      </div>

      {/* Stat tiles row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mt-3">
        <div className="rounded-2xl border border-appborder-light bg-appinset p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Now</p>
          <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-apptext">
            {current ? formatTemp(current.temperature) : formatTemp(nowHour?.temperature)}
          </p>
          {current && (
            <p className="mt-0.5 text-xs text-apptext-muted">
              Feels {formatTemp(current.apparentTemperature)}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-sky-300/35 bg-sky-300/18 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-muted">High</p>
          <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-sky-200">
            {formatTemp(hi)}
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-300/35 bg-emerald-300/18 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-muted">Low</p>
          <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-emerald-200">
            {formatTemp(lo)}
          </p>
        </div>

        <div className="rounded-2xl border border-appborder-light bg-appinset p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Average</p>
          <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-apptext">
            {formatTemp(avg)}
          </p>
        </div>
      </div>

      {/* Hourly sparkline */}
      <HourlySparkline hours={last24h} />

      {/* Bottom row: humidity + precip */}
      <div className="mt-3 flex items-center gap-4 text-xs text-apptext-muted">
        {humidity != null && humidity > 0 && (
          <span>💧 Humidity {Math.round(humidity)}%</span>
        )}
        {precip > 0 && (
          <span>🌧 {precip.toFixed(2)}" total</span>
        )}
      </div>
    </section>
  );
}
