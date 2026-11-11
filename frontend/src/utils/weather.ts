// ── WMO Weather Code helpers ──────────────────────────────────
// See: https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM

import type { IconName } from '../components/ui/Icon';
import type { WeatherHour } from '../types';
import { homeClock, homeDayKey, toInstant, type DateInput } from './format';
import { sunTimesOn } from './sun';

type Sky = 'clear' | 'few' | 'partly' | 'overcast' | 'fog' | 'rain' | 'snow' | 'storm';

const WMO_CODES: Record<number, { description: string; day: string; night: string; sky: Sky }> = {
  0:  { description: 'Clear sky',           day: '☀️',  night: '🌙', sky: 'clear' },
  1:  { description: 'Mainly clear',        day: '🌤️',  night: '🌙', sky: 'few' },
  2:  { description: 'Partly cloudy',       day: '⛅',  night: '☁️', sky: 'partly' },
  3:  { description: 'Overcast',            day: '☁️',  night: '☁️', sky: 'overcast' },
  45: { description: 'Fog',                 day: '🌫️',  night: '🌫️', sky: 'fog' },
  48: { description: 'Rime fog',            day: '🌫️',  night: '🌫️', sky: 'fog' },
  51: { description: 'Light drizzle',       day: '🌦️',  night: '🌧️', sky: 'rain' },
  53: { description: 'Moderate drizzle',    day: '🌦️',  night: '🌧️', sky: 'rain' },
  55: { description: 'Dense drizzle',       day: '🌧️',  night: '🌧️', sky: 'rain' },
  56: { description: 'Freezing drizzle',    day: '🌧️',  night: '🌧️', sky: 'rain' },
  57: { description: 'Freezing drizzle',    day: '🌧️',  night: '🌧️', sky: 'rain' },
  61: { description: 'Slight rain',         day: '🌦️',  night: '🌧️', sky: 'rain' },
  63: { description: 'Moderate rain',       day: '🌧️',  night: '🌧️', sky: 'rain' },
  65: { description: 'Heavy rain',          day: '🌧️',  night: '🌧️', sky: 'rain' },
  66: { description: 'Freezing rain',       day: '🌧️',  night: '🌧️', sky: 'rain' },
  67: { description: 'Freezing rain',       day: '🌧️',  night: '🌧️', sky: 'rain' },
  71: { description: 'Slight snow',         day: '🌨️',  night: '🌨️', sky: 'snow' },
  73: { description: 'Moderate snow',       day: '🌨️',  night: '🌨️', sky: 'snow' },
  75: { description: 'Heavy snow',          day: '❄️',  night: '❄️', sky: 'snow' },
  77: { description: 'Snow grains',         day: '❄️',  night: '❄️', sky: 'snow' },
  80: { description: 'Rain showers',        day: '🌦️',  night: '🌧️', sky: 'rain' },
  81: { description: 'Moderate showers',    day: '🌧️',  night: '🌧️', sky: 'rain' },
  82: { description: 'Violent showers',     day: '🌧️',  night: '🌧️', sky: 'rain' },
  85: { description: 'Snow showers',        day: '🌨️',  night: '🌨️', sky: 'snow' },
  86: { description: 'Heavy snow showers',  day: '❄️',  night: '❄️', sky: 'snow' },
  95: { description: 'Thunderstorm',        day: '⛈️',  night: '⛈️', sky: 'storm' },
  96: { description: 'Hail thunderstorm',   day: '⛈️',  night: '⛈️', sky: 'storm' },
  99: { description: 'Hail thunderstorm',   day: '⛈️',  night: '⛈️', sky: 'storm' },
};

const DEFAULT_WEATHER = { description: 'Unknown', day: '🌡️', night: '🌡️', sky: 'overcast' as Sky };

/** Where the house is, for sunrise and sunset. Null falls back to a fixed 8 PM – 6 AM night. */
export interface SunPlace {
  lat: number | null;
  lon: number | null;
}

/**
 * Whether it is dark at home at `when` (default now): before that day's sunrise or after its
 * sunset (B-072: a fixed 8 PM – 6 AM night showed a sun for hours after a winter sunset). The
 * day and the fallback hour are read on the home's clock, so a phone on a trip agrees with home.
 */
export function isNightAt(when: DateInput = new Date(), place?: SunPlace | null): boolean {
  const day = homeDayKey(when);
  const window = day ? sunTimesOn(day, place?.lat ?? null, place?.lon ?? null) : null;
  const t = toInstant(when);
  if (window && t != null) return t < window.sunrise.getTime() || t >= window.sunset.getTime();
  const hour = homeClock(when)?.hour ?? new Date().getHours();
  return hour >= 20 || hour < 6;
}

/** True when it is night at home now (fixed 8 PM – 6 AM unless a place is given). */
export function isNightTime(place?: SunPlace | null): boolean {
  return isNightAt(new Date(), place);
}

export function getWeatherCodeDescription(code: number): string {
  return WMO_CODES[code]?.description ?? DEFAULT_WEATHER.description;
}

/** Get a day/night-aware weather emoji for a WMO weather code (older cards only). */
export function getWeatherEmoji(code: number, place?: SunPlace | null): string {
  const entry = WMO_CODES[code] ?? DEFAULT_WEATHER;
  return isNightTime(place) ? entry.night : entry.day;
}

/** Get the dominant weather emoji for a list of codes (mode), day/night-aware. */
export function getDominantWeatherEmoji(codes: number[]): string {
  if (!codes.length) return isNightTime() ? DEFAULT_WEATHER.night : DEFAULT_WEATHER.day;
  const freq = new Map<number, number>();
  for (const c of codes) freq.set(c, (freq.get(c) ?? 0) + 1);
  let best = codes[0];
  let bestCount = 0;
  for (const [code, count] of freq) {
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return getWeatherEmoji(best);
}

/** The kit icon for a WMO code: sun / moon by day and night, cloud, rain, snow, storm, fog. */
export function weatherIcon(code: number, night: boolean): IconName {
  const sky = (WMO_CODES[code] ?? DEFAULT_WEATHER).sky;
  switch (sky) {
    case 'clear': return night ? 'moon' : 'sun';
    case 'few':
    case 'partly': return night ? 'cloud-moon' : 'cloud-sun';
    case 'fog': return 'fog';
    case 'rain': return 'rain';
    case 'snow': return 'snowflake';
    case 'storm': return 'storm';
    default: return 'cloud';
  }
}

/** Rain, snow or a storm (the hour strip tints these). */
export function isWet(code: number): boolean {
  const sky = (WMO_CODES[code] ?? DEFAULT_WEATHER).sky;
  return sky === 'rain' || sky === 'snow' || sky === 'storm';
}

// ── Hourly forecast ─────────────────────────────────────────────

/**
 * The current hour at home as Open-Meteo writes it ("YYYY-MM-DDTHH:00"; the backend asks for
 * America/Chicago). Built on the home clock, not the device's (B-073: from the West Coast the
 * strip used to start two hours back).
 */
export function homeHourKey(now: DateInput = new Date()): string {
  const c = homeClock(now);
  if (!c) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${c.year}-${p(c.month)}-${p(c.day)}T${p(c.hour)}:00`;
}

/** The next `count` hours from now (inclusive of the current hour). */
export function nextHours(hourly: WeatherHour[] | undefined, count: number, now: DateInput = new Date()): WeatherHour[] {
  if (!hourly?.length) return [];
  const key = homeHourKey(now);
  return hourly.filter((h) => typeof h.time === 'string' && h.time >= key).slice(0, count);
}

/** The hour of a forecast time, 0–23 (it is already home wall-clock). */
export function hourOf(iso: string): number {
  const m = iso.match(/T(\d{2}):/);
  return m ? Number(m[1]) : 0;
}

/** Hours (from the list given) when rain is likely, as [first, last] runs of consecutive hours. */
export function rainRuns(hours: WeatherHour[], threshold = 50): Array<{ from: WeatherHour; to: WeatherHour }> {
  const runs: Array<{ from: WeatherHour; to: WeatherHour }> = [];
  let open: { from: WeatherHour; to: WeatherHour } | null = null;
  for (const h of hours) {
    if (h.precipitationProbability >= threshold) {
      if (open) open.to = h;
      else open = { from: h, to: h };
    } else if (open) {
      runs.push(open);
      open = null;
    }
  }
  if (open) runs.push(open);
  return runs;
}
