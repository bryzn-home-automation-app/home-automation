import type { Camera, CameraBatteryReading } from '../types';

// Presentation + live-view policy for the Cameras tab. Kept free of React so it
// can be unit-tested directly (see src/test/cameras.test.tsx).

/**
 * A battery camera's live view stops after this long and asks "Still watching?".
 * The bridge is set to let battery streams run a little longer
 * (STREAM_BATTERY_BUDGET_MS in docker-compose.yml), so the page asks before the
 * video would die.
 */
export const BATTERY_LIVE_BUDGET_MS = 5 * 60_000;

/** No pointer/key/scroll/touch for this long → every live view stops. */
export const IDLE_STOP_MS = 5 * 60_000;

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
    const solar = /solar/i.test(camera.chargingStatus ?? '');
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
  const pts: BatteryPoint[] = readings.map((r) => ({ t: new Date(r.at).getTime(), charge: null, drain: null }));
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
  /** Local date, YYYY-MM-DD. */
  day: string;
  gained: number;
  used: number;
}

/**
 * Percentage points gained and used per local day: every rise between readings
 * counts as gained, every drop as used (a change spanning midnight goes to the
 * day it ends in). Newest day first.
 */
export function dailySummary(readings: CameraBatteryReading[]): DaySummary[] {
  const byDay = new Map<string, DaySummary>();
  for (let i = 1; i < readings.length; i++) {
    const d = readings[i].percent - readings[i - 1].percent;
    if (d === 0) continue;
    const day = localDay(readings[i].at);
    const s = byDay.get(day) ?? { day, gained: 0, used: 0 };
    if (d > 0) s.gained += d;
    else s.used -= d;
    byDay.set(day, s);
  }
  return [...byDay.values()]
    .map((s) => ({ ...s, gained: Math.round(s.gained), used: Math.round(s.used) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today" / "Yesterday" / "Mon" for a YYYY-MM-DD local day. */
export function dayLabel(day: string, now = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, diff < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}
