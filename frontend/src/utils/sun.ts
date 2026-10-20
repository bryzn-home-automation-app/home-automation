// Sunrise / sunset for the home, for the "Auto (sunset)" theme. Same almanac
// algorithm as the backend's SunCalculator (US Naval Observatory, zenith 90.833°),
// accurate to a couple of minutes — and computed locally, so the theme keeps
// switching on time even when the app can't reach the server.

const ZENITH = 90.833;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (v: number, range: number) => ((v % range) + range) % range;

/** UTC hour of sunrise (`rising`) or sunset on a day of the year, or null in polar day/night. */
function utcHours(dayOfYear: number, lat: number, lon: number, rising: boolean): number | null {
  const lngHour = lon / 15;
  const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  const l = norm(m + 1.916 * Math.sin(rad(m)) + 0.02 * Math.sin(rad(2 * m)) + 282.634, 360);
  let ra = norm(deg(Math.atan(0.91764 * Math.tan(rad(l)))), 360);
  ra = (ra + Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90) / 15;
  const sinDec = 0.39782 * Math.sin(rad(l));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(ZENITH)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null;
  const h = (rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))) / 15;
  return norm(h + ra - 0.06571 * t - 6.622 - lngHour, 24);
}

function dayOfYear(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 0)) / 86_400_000);
}

export interface SunWindow {
  sunrise: Date;
  sunset: Date;
}

/** Sunrise → sunset for the local calendar day containing `date`, or null (polar). */
export function sunTimes(date: Date, lat: number, lon: number): SunWindow | null {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const n = dayOfYear(y, m, d);
  const rise = utcHours(n, lat, lon, true);
  const set = utcHours(n, lat, lon, false);
  if (rise == null || set == null) return null;
  const base = Date.UTC(y, m, d);
  const sunrise = new Date(base + rise * 3_600_000);
  let sunset = new Date(base + set * 3_600_000);
  // West of Greenwich the evening sunset lands on the next UTC day.
  if (sunset <= sunrise) sunset = new Date(sunset.getTime() + 86_400_000);
  return { sunrise, sunset };
}

/** True between today's sunrise and sunset; null when the location is unknown or polar. */
export function isDaytime(now: Date, lat: number | null, lon: number | null): boolean | null {
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  const w = sunTimes(now, lat, lon);
  if (!w) return null;
  return now >= w.sunrise && now < w.sunset;
}

/** The next sunrise or sunset after `now` (when the Auto theme should flip next). */
export function nextSunChange(now: Date, lat: number | null, lon: number | null): Date | null {
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  const today = sunTimes(now, lat, lon);
  if (!today) return null;
  if (now < today.sunrise) return today.sunrise;
  if (now < today.sunset) return today.sunset;
  const tomorrow = sunTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12), lat, lon);
  return tomorrow?.sunrise ?? null;
}
