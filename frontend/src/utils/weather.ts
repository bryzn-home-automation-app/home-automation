// ── WMO Weather Code helpers ──────────────────────────────────
// See: https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM

const WMO_CODES: Record<number, { description: string; day: string; night: string }> = {
  0:  { description: 'Clear sky',           day: '☀️',  night: '🌙' },
  1:  { description: 'Mainly clear',        day: '🌤️',  night: '🌙' },
  2:  { description: 'Partly cloudy',       day: '⛅',  night: '☁️' },
  3:  { description: 'Overcast',            day: '☁️',  night: '☁️' },
  45: { description: 'Fog',                 day: '🌫️',  night: '🌫️' },
  48: { description: 'Rime fog',            day: '🌫️',  night: '🌫️' },
  51: { description: 'Light drizzle',       day: '🌦️',  night: '🌧️' },
  53: { description: 'Moderate drizzle',    day: '🌦️',  night: '🌧️' },
  55: { description: 'Dense drizzle',       day: '🌧️',  night: '🌧️' },
  56: { description: 'Freezing drizzle',    day: '🌧️',  night: '🌧️' },
  57: { description: 'Freezing drizzle',    day: '🌧️',  night: '🌧️' },
  61: { description: 'Slight rain',         day: '🌦️',  night: '🌧️' },
  63: { description: 'Moderate rain',       day: '🌧️',  night: '🌧️' },
  65: { description: 'Heavy rain',          day: '🌧️',  night: '🌧️' },
  66: { description: 'Freezing rain',       day: '🌧️',  night: '🌧️' },
  67: { description: 'Freezing rain',       day: '🌧️',  night: '🌧️' },
  71: { description: 'Slight snow',         day: '🌨️',  night: '🌨️' },
  73: { description: 'Moderate snow',       day: '🌨️',  night: '🌨️' },
  75: { description: 'Heavy snow',          day: '❄️',  night: '❄️' },
  77: { description: 'Snow grains',         day: '❄️',  night: '❄️' },
  80: { description: 'Rain showers',        day: '🌦️',  night: '🌧️' },
  81: { description: 'Moderate showers',    day: '🌧️',  night: '🌧️' },
  82: { description: 'Violent showers',     day: '🌧️',  night: '🌧️' },
  85: { description: 'Snow showers',        day: '🌨️',  night: '🌨️' },
  86: { description: 'Heavy snow showers',  day: '❄️',  night: '❄️' },
  95: { description: 'Thunderstorm',        day: '⛈️',  night: '⛈️' },
  96: { description: 'Hail thunderstorm',   day: '⛈️',  night: '⛈️' },
  99: { description: 'Hail thunderstorm',   day: '⛈️',  night: '⛈️' },
};

const DEFAULT_WEATHER = { description: 'Unknown', day: '🌡️', night: '🌡️' };

/** Returns true if the current local time is between 8 PM and 6 AM (night). */
export function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
}

export function getWeatherCodeDescription(code: number): string {
  return WMO_CODES[code]?.description ?? DEFAULT_WEATHER.description;
}

/** Get a day/night-aware weather emoji for a WMO weather code. */
export function getWeatherEmoji(code: number): string {
  const entry = WMO_CODES[code] ?? DEFAULT_WEATHER;
  return isNightTime() ? entry.night : entry.day;
}

/**
 * Weather emoji for a specific hour, day/night-aware based on THAT hour's
 * local time (not the current time). `hour` is 0-23.
 */
export function getWeatherEmojiForHour(code: number, hour: number): string {
  const entry = WMO_CODES[code] ?? DEFAULT_WEATHER;
  const isNight = hour >= 20 || hour < 6;
  return isNight ? entry.night : entry.day;
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
