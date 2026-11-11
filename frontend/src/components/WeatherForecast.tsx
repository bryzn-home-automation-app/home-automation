import { Icon, cx, knobs } from './ui';
import type { WeatherHour } from '../types';
import { formatHour, formatPercent, formatTemp } from '../utils/format';
import { getWeatherCodeDescription, isNightAt, isWet, weatherIcon, type SunPlace } from '../utils/weather';

/*
 * Home's "Next hours" strip: six hours on a phone, eight from 640px, twelve from lg. Each
 * hour shows its time, the sky, the temperature and the chance of rain as a short bar plus
 * the figure (the figure carries it; the bar is only a glance).
 *
 * Every slot is labelled with its own hour (B-071: the first slot used to say "Now" while
 * showing the forecast for the hour, not the reading above it); the current hour sits in a
 * well instead.
 */

export function ForecastStrip({ hours, place }: { hours: WeatherHour[]; place?: SunPlace | null }) {
  if (hours.length < 2) return null;
  return (
    <ol className="grid grid-cols-6 gap-1 sm:grid-cols-8 lg:grid-cols-12" aria-label="Hourly forecast">
      {hours.slice(0, 12).map((h, i) => {
        const pop = Math.round(h.precipitationProbability);
        const night = isNightAt(h.time, place);
        const sky = getWeatherCodeDescription(h.weatherCode);
        return (
          <li
            key={h.time}
            className={cx(
              'flex min-w-0 flex-col items-center gap-[7px] rounded-well px-0.5 py-2.5',
              i === 0 && 'bg-appinset shadow-[var(--appwell-shadow)]',
              i >= 6 && i < 8 && 'hidden sm:flex',
              i >= 8 && 'hidden lg:flex',
            )}
            aria-current={i === 0 ? 'time' : undefined}
          >
            <span className={cx('whitespace-nowrap font-mono text-3xs', i === 0 ? 'font-medium text-apptext' : 'text-apptext-muted')}>
              {formatHour(h.time)}
            </span>
            <Icon
              name={weatherIcon(h.weatherCode, night)}
              title={sky}
              className={cx('text-[24px]', isWet(h.weatherCode) ? 'text-appchart-cool' : 'text-apptext')}
            />
            <span className="fp-num fp-num--m">{formatTemp(h.temperature)}</span>
            <span className="flex w-full flex-col items-center gap-1">
              <span className="relative block h-1 w-[70%] max-w-10 overflow-hidden rounded-sm bg-appinset" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0 w-[var(--fp-p)] rounded-sm bg-appchart-cool"
                  style={knobs({ '--fp-p': `${Math.min(100, Math.max(0, pop))}%` })}
                />
              </span>
              <span className="font-mono text-[11px] text-apptext-muted">
                <span className="fp-sr-only">Chance of rain </span>
                {formatPercent(pop)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
