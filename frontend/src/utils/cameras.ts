import type { Camera, CameraBatteryReading } from '../types';
import { SLEEP_AFTER_MS } from '../hooks/useAppSleep';
import { formatHour, formatShortDate, formatTime, formatWeekday, homeClock, homeDayKey, toInstant } from './format';
import type { Tone } from './status';
import { errorMessage, errorStatus } from '../api/climate';

// Presentation + live-view policy for the Cameras tab. Kept free of React so it
// can be unit-tested directly (see src/test/cameras.test.tsx).

/**
 * A battery camera's live view stops after this long and asks "Still watching?".
 * The bridge is set to let battery streams run a little longer
 * (STREAM_BATTERY_BUDGET_MS in docker-compose.yml), so the page asks before the
 * video would die.
 */
export const BATTERY_LIVE_BUDGET_MS = 5 * 60_000;

/**
 * No pointer/key/scroll/touch for this long → every live view stops. The same as the
 * app's sleep (useAppSleep), which normally takes over at that moment anyway.
 */
export const IDLE_STOP_MS = SLEEP_AFTER_MS;

/** Motion/person events newer than this get the highlight ring on the tile. */
export const RECENT_EVENT_MS = 2 * 60_000;

/** Same thresholds and comparisons (≤) as CameraAlertService, so a tile and its alert agree. */
export const BATTERY_LOW = 30;
export const BATTERY_CRITICAL = 15;

export type BatteryTone = 'ok' | 'low' | 'critical' | 'unknown';

export function batteryTone(pct: number | null | undefined): BatteryTone {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  if (pct <= BATTERY_CRITICAL) return 'critical';
  if (pct <= BATTERY_LOW) return 'low';
  return 'ok';
}

/**
 * The lamp tone for a battery level, on the same thresholds as the camera alerts (≤ 30% a
 * heads-up, ≤ 15% a problem), so a tile and its alert never disagree. A charging battery
 * never alarms.
 */
export function batteryLampTone(pct: number | null | undefined, charging = false): Tone {
  const t = batteryTone(pct);
  if (t === 'unknown') return 'neutral';
  if (charging) return 'ok';
  return t === 'critical' ? 'problem' : t === 'low' ? 'headsup' : 'ok';
}

/** The camera says its charge comes from the sun ("Solar charging"); a cable top-up doesn't (B-109). */
export function isSolar(chargingStatus: string | null | undefined): boolean {
  return /solar/i.test(chargingStatus ?? '');
}

export type ChargeState = 'charging' | 'draining' | 'steady' | 'unknown';

/**
 * Charging as reported when the camera says; otherwise the trend over the last
 * two readings (a rise means it's charging — by day, that's the solar panel).
 * `inferred` tells the UI to hedge the wording.
 */
export function chargeState(
  camera: Pick<Camera, 'charging'>,
  readings: CameraBatteryReading[] | undefined,
): { state: ChargeState; inferred: boolean } {
  if (camera.charging === true) return { state: 'charging', inferred: false };
  if (camera.charging === false) return { state: 'draining', inferred: false };
  const trend = trendOf(readings);
  return { state: trend, inferred: trend !== 'unknown' };
}

function trendOf(readings: CameraBatteryReading[] | undefined): ChargeState {
  if (!readings || readings.length < 2) return 'unknown';
  const last = readings[readings.length - 1];
  // Compare with the most recent reading at a different level, so a run of
  // identical snapshots doesn't hide the direction.
  for (let i = readings.length - 2; i >= 0; i--) {
    const d = last.percent - readings[i].percent;
    if (d > 0) return 'charging';
    if (d < 0) return 'draining';
  }
  return 'steady';
}

/** "Solar charging" / "Charging" / "Draining" / "Holding" — with "likely" when inferred. */
export function chargeLabel(camera: Pick<Camera, 'chargingStatus'>, state: ChargeState, inferred: boolean): string {
  if (state === 'unknown') return '';
  if (state === 'charging') {
    const solar = isSolar(camera.chargingStatus);
    return inferred ? 'Likely charging' : solar ? 'Solar charging' : 'Charging';
  }
  if (state === 'draining') return 'On battery';
  return 'Holding steady';
}

/**
 * Whether the tile starts live video by itself: every camera does, battery ones
 * included. Members sign in for a minute to check on the house, so the picture
 * should already be live when they get there, not waiting on a tap. A battery
 * camera still stops at BATTERY_LIVE_BUDGET_MS and asks before going on.
 */
export function autoLive(camera: Pick<Camera, 'liveAvailable' | 'available'>): boolean {
  return camera.liveAvailable && camera.available;
}

export interface LiveInputs {
  camera: Pick<Camera, 'liveAvailable' | 'available'>;
  /** The viewer tapped play / resume. */
  requested: boolean;
  pageVisible: boolean;
  /** Nobody has touched the page for IDLE_STOP_MS. */
  idle: boolean;
  /** Live failed and hasn't been retried — don't loop on a broken stream. */
  failed: boolean;
}

/**
 * The single rule for "should this tile be streaming right now": whenever the
 * Cameras tab is open and someone is plausibly there. Tiles below the fold
 * stream too, so scrolling down finds them already live. Everything else
 * (snapshot, prompts) is presentation.
 */
export function shouldStream(i: LiveInputs): boolean {
  if (!i.camera.liveAvailable || !i.camera.available || i.failed) return false;
  if (!i.pageVisible || i.idle) return false;
  return i.requested || autoLive(i.camera);
}

/** "just now", "4 min ago", "2 hr ago", "3 d ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
}

/** The newest motion/person event, for the tile badge. */
export function latestEvent(
  camera: Pick<Camera, 'lastMotionAt' | 'lastPersonAt'>,
): { kind: 'person' | 'motion'; at: string } | null {
  const m = camera.lastMotionAt ? new Date(camera.lastMotionAt).getTime() : NaN;
  const p = camera.lastPersonAt ? new Date(camera.lastPersonAt).getTime() : NaN;
  if (Number.isNaN(m) && Number.isNaN(p)) return null;
  // A person detection also trips motion; prefer "person" when they're close.
  if (!Number.isNaN(p) && (Number.isNaN(m) || p >= m - 5_000)) return { kind: 'person', at: camera.lastPersonAt! };
  return { kind: 'motion', at: camera.lastMotionAt! };
}

export function isRecent(iso: string | null | undefined, now = Date.now(), windowMs = RECENT_EVENT_MS): boolean {
  if (!iso) return false;
  const ms = now - new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= 0 && ms <= windowMs;
}

// ── battery chart ──

export interface BatteryPoint {
  t: number;
  /** Level on charging segments (null elsewhere) — drawn green. */
  charge: number | null;
  /** Level on draining/steady segments — drawn grey. */
  drain: number | null;
}

/**
 * One point per reading, split into two series so the line changes colour per
 * segment. The segment from reading i-1 to i is "charging" when the camera
 * reported charging at i, or — when it doesn't report — when the level rose.
 * Boundary points carry both values so the two lines join up.
 */
export function batterySeries(readings: CameraBatteryReading[]): BatteryPoint[] {
  const pts: BatteryPoint[] = readings.map((r) => ({ t: toInstant(r.at) ?? NaN, charge: null, drain: null }));
  if (readings.length === 1) pts[0].drain = readings[0].percent;
  for (let i = 1; i < readings.length; i++) {
    const r = readings[i];
    const charging = r.charging ?? r.percent > readings[i - 1].percent;
    const key = charging ? 'charge' : 'drain';
    pts[i - 1][key] = readings[i - 1].percent;
    pts[i][key] = r.percent;
  }
  return pts.filter((p) => Number.isFinite(p.t));
}

/**
 * A row of the combined battery chart: the time, then for each camera track `i` its level
 * (`v{i}`, continuous across the whole of that camera's readings) and its level again on
 * charging stretches only (`c{i}`, null elsewhere; boundary points carry both, so a charging
 * stretch starts and ends on the line). Null outside the camera's own readings.
 */
export type CombinedBatteryRow = { t: number } & Record<string, number | null>;

/** The data keys of track `i` in a CombinedBatteryRow. */
export const levelKey = (i: number) => `v${i}`;
export const chargeKey = (i: number) => `c${i}`;

/**
 * Several cameras' readings on one time axis, for one chart with a line per camera. Rows are
 * the union of every camera's reading times; a camera with no reading at a row's time gets
 * the value on its straight line between its neighbouring readings, so its line and its
 * charging stretches have no holes where another camera reported. A stretch from reading
 * i-1 to i is charging when the camera said so at i, or, when it doesn't say, when the level rose
 * (the same rule as batterySeries).
 */
export function combinedBatterySeries(tracks: CameraBatteryReading[][]): CombinedBatteryRow[] {
  const clean = tracks.map((readings) =>
    readings
      .map((r) => ({ t: toInstant(r.at) ?? NaN, p: r.percent, charging: r.charging }))
      .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.p))
      .sort((a, b) => a.t - b.t),
  );
  // charging[i] = the stretch ending at reading i is a charge (index 0 unused).
  const charging = clean.map((rs) => rs.map((r, i) => i > 0 && (r.charging ?? r.p > rs[i - 1].p)));
  const times = [...new Set(clean.flatMap((rs) => rs.map((r) => r.t)))].sort((a, b) => a - b);
  const cursor = clean.map(() => 0);
  return times.map((t) => {
    const row: CombinedBatteryRow = { t };
    clean.forEach((rs, k) => {
      const v = levelKey(k);
      const c = chargeKey(k);
      row[v] = null;
      row[c] = null;
      if (!rs.length || t < rs[0].t || t > rs[rs.length - 1].t) return;
      // Advance to the first reading at or after t (rows and readings are both sorted).
      while (cursor[k] < rs.length - 1 && rs[cursor[k]].t < t) cursor[k]++;
      const j = cursor[k];
      if (rs[j].t === t) {
        // The last reading at this time (duplicates collapse onto it).
        let last = j;
        while (last + 1 < rs.length && rs[last + 1].t === t) last++;
        row[v] = rs[last].p;
        const charged = (j > 0 && charging[k][j]) || (last + 1 < rs.length && charging[k][last + 1]);
        if (charged) row[c] = rs[last].p;
        return;
      }
      const a = rs[j - 1];
      const b = rs[j];
      const value = a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t);
      row[v] = value;
      if (charging[k][j]) row[c] = value;
    });
    return row;
  });
}

/** A battery chart's y-axis: the visible range and its round tick positions, in percent. */
export interface BatteryAxis {
  domain: [number, number];
  ticks: number[];
  /** The whole 0–100% scale (nothing to zoom to, or asked for). */
  full: boolean;
}

export const FULL_BATTERY_AXIS: BatteryAxis = { domain: [0, 100], ticks: [0, 25, 50, 75, 100], full: true };

/** Tick steps tried in order; the first that keeps the axis to MAX_TICKS wins. */
const AXIS_STEPS = [5, 10, 20] as const;
const MAX_TICKS = 6;
/** A fitted axis this tall is hardly a zoom: show the plain 0–100% scale instead. */
const MAX_FIT_SPAN = 75;

/**
 * A y-axis fitted to the readings (every camera's, in the chart's window) rather than 0–100%:
 * the lowest and highest reading (and the alert threshold, once a camera is within `near` points
 * of it), with a few points of padding, then
 * snapped out to round 5 / 10 / 20 % ticks (3 to 6 of them), never below 0 or above 100, and at
 * least `minSpan` points tall so a camera holding steady doesn't look like it's swinging. No
 * readings, or readings that need three quarters of the scale or more, give the plain 0–100% axis.
 */
export function batteryAxis(
  values: ReadonlyArray<number | null | undefined>,
  opts: { threshold?: number; pad?: number; minSpan?: number; near?: number } = {},
): BatteryAxis {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return FULL_BATTERY_AXIS;
  const { threshold = BATTERY_LOW, pad = 3, minSpan = 20, near = 15 } = opts;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  // The alert line only earns a place on the scale once a camera is getting close to it; batteries
  // sitting at 94–100% get an 80–100% axis, not one dragged down to 30%.
  const showThreshold = min <= threshold + near;
  let lo = clamp((showThreshold ? Math.min(min, threshold) : min) - pad);
  let hi = clamp((showThreshold ? Math.max(max, threshold) : max) + pad);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
    // Slide back inside 0–100 rather than cut the span short.
    if (lo < 0) [lo, hi] = [0, hi - lo];
    if (hi > 100) [lo, hi] = [lo - (hi - 100), 100];
    lo = clamp(lo);
  }
  for (const step of AXIS_STEPS) {
    const from = Math.floor(lo / step) * step;
    const to = Math.min(100, Math.ceil(hi / step) * step);
    const count = Math.round((to - from) / step) + 1;
    if (count > MAX_TICKS) continue;
    if (to - from >= MAX_FIT_SPAN) return FULL_BATTERY_AXIS;
    return { domain: [from, to], ticks: Array.from({ length: count }, (_, i) => from + i * step), full: false };
  }
  return FULL_BATTERY_AXIS;
}

/** Night = the gaps between daylight windows, within [from, to]. */
export function nightWindows(
  daylight: Array<{ from: string; to: string }>,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const days = daylight
    .map((d) => ({ from: new Date(d.from).getTime(), to: new Date(d.to).getTime() }))
    .filter((d) => Number.isFinite(d.from) && Number.isFinite(d.to))
    .sort((a, b) => a.from - b.from);
  if (!days.length) return [];
  const out: Array<{ from: number; to: number }> = [];
  let cursor = from;
  for (const d of days) {
    if (d.from > cursor) out.push({ from: cursor, to: Math.min(d.from, to) });
    cursor = Math.max(cursor, d.to);
  }
  if (cursor < to) out.push({ from: cursor, to });
  return out.filter((n) => n.to > n.from);
}

export interface DaySummary {
  /** The home's calendar day, YYYY-MM-DD. */
  day: string;
  gained: number;
  used: number;
  /** Every rise that day happened in daylight: the sun, not a cable (B-109). Absent without daylight data. */
  solar?: boolean;
}

/**
 * Percentage points gained and used per day at home: every rise between readings counts as
 * gained, every drop as used (a change spanning midnight goes to the day it ends in). With the
 * daylight windows, a day whose gains all came in daylight is marked `solar`. Newest day first.
 */
export function dailySummary(
  readings: CameraBatteryReading[],
  daylight?: Array<{ from: string; to: string }>,
): DaySummary[] {
  const windows = (daylight ?? [])
    .map((d) => ({ from: toInstant(d.from) ?? NaN, to: toInstant(d.to) ?? NaN }))
    .filter((d) => Number.isFinite(d.from) && Number.isFinite(d.to));
  const inDaylight = (at: number) => windows.some((w) => at >= w.from && at <= w.to);
  const byDay = new Map<string, DaySummary & { dark: boolean }>();
  for (let i = 1; i < readings.length; i++) {
    const d = readings[i].percent - readings[i - 1].percent;
    if (d === 0) continue;
    const day = homeDayKey(readings[i].at);
    if (!day) continue;
    const s = byDay.get(day) ?? { day, gained: 0, used: 0, dark: false };
    if (d > 0) {
      s.gained += d;
      if (!inDaylight(toInstant(readings[i].at) ?? NaN)) s.dark = true;
    } else s.used -= d;
    byDay.set(day, s);
  }
  return [...byDay.values()]
    .map(({ dark, ...s }) => ({
      ...s,
      gained: Math.round(s.gained),
      used: Math.round(s.used),
      ...(daylight ? { solar: s.gained > 0 && !dark } : {}),
    }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * The day-by-day list for a chart window: only days that start inside it (B-021: on the 24 h
 * view, "Yesterday" covered only yesterday evening and read "+0% sun"). Seven at most.
 */
export function summaryDays(
  readings: CameraBatteryReading[],
  from: number,
  daylight?: Array<{ from: string; to: string }>,
): DaySummary[] {
  return dailySummary(readings, daylight)
    .filter((d) => (toInstant(d.day) ?? -Infinity) >= from)
    .slice(0, 7);
}

/**
 * Tick positions on whole hours at home for a time axis (B-102): every 3 hours on a day's
 * window, each midnight on a week, every 5th midnight on a month.
 */
export function timeTicks(from: number, to: number, hours: number): number[] {
  const ticks: number[] = [];
  const HOUR = 3_600_000;
  let midnights = 0;
  // Whole UTC hours are whole hours at home too (Central is a whole number of hours off UTC).
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) {
    const c = homeClock(t);
    if (!c) continue;
    if (hours <= 24) {
      if (c.hour % 3 === 0) ticks.push(t);
    } else if (c.hour === 0) {
      if (hours <= 24 * 7 || midnights % 5 === 0) ticks.push(t);
      midnights++;
    }
  }
  return ticks;
}

/** The label for a tick from timeTicks: "6 PM", "Tue", "Nov 4". */
export function formatTimeTick(t: number, hours: number): string {
  if (hours <= 24) return formatHour(t);
  if (hours <= 24 * 7) return formatWeekday(t);
  return formatShortDate(t);
}

/**
 * Why a refresh of the thermostats or cameras failed, in words that point at the right thing
 * (B-103). Both lists are served from the home server's database, so a 503 means the Home
 * Assistant link is off; no status at all means the server (or the Wi-Fi) didn't answer.
 */
export function staleReason(error: unknown, lastGood: number | undefined): string {
  const since = lastGood ? ` Showing what came in at ${formatTime(lastGood)}.` : '';
  const status = errorStatus(error);
  if (status === 503) return `Can't reach Home Assistant.${since}`;
  if (status == null) return `Can't reach the home server.${since}`;
  const msg = errorMessage(error).replace(/\.$/, '');
  return `${msg}.${since}`;
}
