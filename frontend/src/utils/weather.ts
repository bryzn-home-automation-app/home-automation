// ── WMO Weather Code helpers ──────────────────────────────────
// See: https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM

import type { IconName } from '../components/ui/Icon';
import type { WeatherHour, WeatherOutlookDay } from '../types';
import {
  formatList, formatTemp, formatWeekdayLong, homeClock, homeDayKey, homeToday, toInstant, type DateInput,
} from './format';
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

// ── The week ahead ──────────────────────────────────────────────

/** A chance of rain at or above this reads as "rain likely" (the same bar as the hour strip's rain runs). */
export const RAIN_LIKELY = 50;

/** One home calendar day of Home's week view. `missing` when the forecast has no temperatures for it. */
export interface WeekDay {
  /** "2026-11-12" */
  date: string;
  missing: boolean;
  high: number | null;
  low: number | null;
  /** 0–100, the day's highest hourly chance. */
  rainChance: number | null;
  /** Inches over the day. */
  rainInches: number | null;
  code: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** mph, the day's strongest wind. */
  wind: number | null;
  /** Rain likely: a chance at or over RAIN_LIKELY, or a wet amount when no chance is given. */
  wet: boolean;
}

type HourlyDay = Pick<WeekDay, 'date' | 'high' | 'low' | 'rainChance' | 'rainInches' | 'code' | 'wind'>;

/** "2026-11-12" + n days, on the calendar (no clock, no zone). */
export function shiftDayKey(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const fin = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The sky a day is planned around: its commonest code, or its commonest wet one when it rains for 3+ hours. */
function dominantCode(codes: number[]): number | null {
  if (!codes.length) return null;
  const wet = codes.filter(isWet);
  const pool = wet.length >= 3 ? wet : codes;
  const freq = new Map<number, number>();
  for (const c of pool) freq.set(c, (freq.get(c) ?? 0) + 1);
  let best = pool[0];
  for (const [c, n] of freq) if (n > (freq.get(best) ?? 0)) best = c;
  return best;
}

/**
 * Daily figures from an hourly forecast, keyed by home day. Open-Meteo's hourly `time` is
 * already home wall-clock ("2026-11-12T23:00"; the backend asks for America/Chicago), so the
 * day is the text before the T: 11 PM belongs to its own day, midnight to the next. A day
 * needs at least `minHours` hours to count (a 3-hour stub would make a fake high and low).
 */
export function daysFromHourly(hourly: WeatherHour[] | undefined, minHours = 18): Map<string, HourlyDay> {
  const groups = new Map<string, WeatherHour[]>();
  for (const h of hourly ?? []) {
    if (typeof h?.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(h.time)) continue;
    const key = h.time.slice(0, 10);
    const list = groups.get(key);
    if (list) list.push(h);
    else groups.set(key, [h]);
  }
  const out = new Map<string, HourlyDay>();
  for (const [date, hours] of groups) {
    const temps = hours.map((h) => fin(h.temperature)).filter((t): t is number => t != null);
    if (hours.length < minHours || !temps.length) continue;
    const chances = hours.map((h) => fin(h.precipitationProbability)).filter((t): t is number => t != null);
    const winds = hours.map((h) => fin(h.windSpeed)).filter((t): t is number => t != null);
    out.set(date, {
      date,
      high: Math.max(...temps),
      low: Math.min(...temps),
      rainChance: chances.length ? Math.max(...chances) : null,
      rainInches: hours.reduce((a, h) => a + (fin(h.precipitation) ?? 0), 0),
      code: dominantCode(hours.map((h) => h.weatherCode).filter((c) => typeof c === 'number')),
      wind: winds.length ? Math.max(...winds) : null,
    });
  }
  return out;
}

/**
 * The `count` home days starting today (home's today, not the device's), from the backend's
 * daily outlook. A day the outlook doesn't have, or has without temperatures, is filled from
 * the hourly forecast when that covers it (today and tomorrow, usually); otherwise it stays in
 * the list as `missing`, so the week keeps its seven slots. Days before today (an answer
 * cached across midnight) are dropped.
 */
export function buildWeek(
  days: WeatherOutlookDay[] | undefined,
  opts: { hourly?: WeatherHour[]; now?: DateInput; count?: number } = {},
): WeekDay[] {
  const { hourly, now = new Date(), count = 7 } = opts;
  const today = homeToday(now);
  const byDate = new Map<string, WeatherOutlookDay>();
  for (const d of days ?? []) {
    if (typeof d?.date === 'string') byDate.set(d.date.slice(0, 10), d);
  }
  const fromHours = hourly?.length ? daysFromHourly(hourly) : new Map<string, HourlyDay>();
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDayKey(today, i);
    const d = byDate.get(date);
    let day: WeekDay = {
      date,
      missing: false,
      high: fin(d?.maxTemperature),
      low: fin(d?.minTemperature),
      rainChance: fin(d?.precipitationProbability),
      rainInches: fin(d?.precipitation),
      code: fin(d?.weatherCode),
      sunrise: d?.sunrise ?? null,
      sunset: d?.sunset ?? null,
      wind: fin(d?.windSpeedMax),
      wet: false,
    };
    if (day.high == null || day.low == null) {
      const h = fromHours.get(date);
      if (h) {
        day = {
          ...day, ...h,
          rainChance: day.rainChance ?? h.rainChance,
          rainInches: day.rainInches ?? h.rainInches,
          code: day.code ?? h.code,
          wind: day.wind ?? h.wind,
        };
      }
    }
    day.missing = day.high == null || day.low == null;
    day.wet = !day.missing && (day.rainChance != null ? day.rainChance >= RAIN_LIKELY : (day.rainInches ?? 0) >= 0.1);
    return day;
  });
}

/** The week's coldest low and warmest high: the scale each day's range bar sits on. */
export function weekScale(week: WeekDay[]): { min: number; max: number } | null {
  const known = week.filter((d) => !d.missing);
  if (!known.length) return null;
  return { min: Math.min(...known.map((d) => d.low as number)), max: Math.max(...known.map((d) => d.high as number)) };
}

/** "today", "tomorrow", else "Saturday": a day inside a sentence. */
export function weekDayWord(date: string, now: DateInput = new Date()): string {
  const today = homeToday(now);
  if (date === today) return 'today';
  if (date === shiftDayKey(today, 1)) return 'tomorrow';
  return formatWeekdayLong(date);
}

/**
 * The week in a sentence or two, from the data: "Warmest Saturday at 74°, coldest Tuesday at
 * 41°. Rain likely Thursday and Friday." Undefined when no day has a forecast.
 */
export function weekSummary(week: WeekDay[], now: DateInput = new Date()): string | undefined {
  const known = week.filter((d) => !d.missing);
  if (!known.length) return undefined;
  const warm = known.reduce((a, b) => ((b.high as number) > (a.high as number) ? b : a));
  const cold = known.reduce((a, b) => ((b.low as number) < (a.low as number) ? b : a));
  const temps = `Warmest ${weekDayWord(warm.date, now)} at ${formatTemp(warm.high)}, coldest ${weekDayWord(cold.date, now)} at ${formatTemp(cold.low)}.`;
  const wet = known.filter((d) => d.wet);
  const rain = wet.length === 0
    ? 'No rain likely.'
    : wet.length >= 5
      ? 'Rain likely most days.'
      : `Rain likely ${formatList(wet.map((d) => weekDayWord(d.date, now)))}.`;
  return `${temps} ${rain}`;
}
