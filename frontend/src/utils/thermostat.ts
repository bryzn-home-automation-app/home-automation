import type { Thermostat, ThermostatChange } from '../types';

// Presentation helpers for the Climate tab. Kept free of React so they can be
// unit-tested directly (see src/test/thermostat.test.tsx).

/**
 * Minimum °F between heat-to and cool-to in Auto. ecobee enforces its own
 * "Heat/Cool Min. Delta" (set to 3 on this home's thermostats); keeping the UI
 * at the same gap means a pair is never sent that ecobee would silently adjust.
 * HA doesn't expose the thermostat's value, so it lives here.
 */
export const HEAT_COOL_MIN_GAP = 3;

/**
 * Data older than this is called out as stale. A steady reading only refreshes on
 * the backend's 15-minute snapshot (HA sends no event when nothing changes), so
 * anything under ~15 min is normal — 20 leaves room for jitter.
 */
export const STALE_AFTER_MS = 20 * 60_000;

const MODE_LABELS: Record<string, string> = {
  heat_cool: 'Auto',
  heat: 'Heat',
  cool: 'Cool',
  off: 'Off',
};

/** Display order for the mode buttons, whatever order HA reports them in. */
const MODE_ORDER = ['heat_cool', 'heat', 'cool', 'off'];

const ACTION_LABELS: Record<string, string> = {
  heating: 'Heating',
  cooling: 'Cooling',
  idle: 'Idle',
  fan: 'Fan only',
  drying: 'Dehumidifying',
  off: 'Off',
};

const PRESET_LABELS: Record<string, string> = {
  home: 'Home',
  away: 'Away',
  sleep: 'Sleep',
  away_indefinitely: 'Away until resumed',
  temp: 'Manual hold',
  vacation: 'Vacation',
};

function titleCase(v: string): string {
  return v
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return '—';
  return MODE_LABELS[mode] ?? titleCase(mode);
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return '—';
  return ACTION_LABELS[action] ?? titleCase(action);
}

export function presetLabel(preset: string | null | undefined): string {
  if (!preset) return '—';
  return PRESET_LABELS[preset] ?? titleCase(preset);
}

export function sortedModes(modes: string[]): string[] {
  const rank = (m: string) => {
    const i = MODE_ORDER.indexOf(m);
    return i === -1 ? MODE_ORDER.length : i;
  };
  return [...modes].sort((a, b) => rank(a) - rank(b));
}

/**
 * ecobee reports a manual setpoint change as preset "temp", and an open-ended
 * away as "away_indefinitely" — both are holds the schedule won't undo on its
 * own, so the card offers "Resume schedule" for them.
 */
export function isHold(preset: string | null | undefined): boolean {
  return preset === 'temp' || preset === 'away_indefinitely' || preset === 'vacation';
}

/** Hold-row copy: "Manual hold", "Away hold", … */
export function holdLabel(preset: string | null | undefined): string {
  if (preset === 'temp') return 'Manual hold';
  if (preset === 'away_indefinitely') return 'Away hold';
  if (preset === 'vacation') return 'Vacation hold';
  return 'Hold';
}

/** Presets a user can pick to hold. "temp" is a state, not a choice. */
export function selectablePresets(presets: string[]): string[] {
  return presets.filter((p) => p !== 'temp');
}

export type Setpoint =
  | { kind: 'single'; value: number | null }
  | { kind: 'range'; low: number | null; high: number | null }
  | { kind: 'none' };

/** What the setpoint control should show for the thermostat's current mode. */
export function currentSetpoint(t: Thermostat): Setpoint {
  switch (t.hvacMode) {
    case 'heat_cool':
    case 'auto': // some HA climate integrations call the range mode "auto" (the backend accepts both)
      return { kind: 'range', low: t.heatSetpoint, high: t.coolSetpoint };
    case 'heat':
      return { kind: 'single', value: t.targetTemperature ?? t.heatSetpoint };
    case 'cool':
      return { kind: 'single', value: t.targetTemperature ?? t.coolSetpoint };
    default:
      return { kind: 'none' };
  }
}

/**
 * Whole-degree limits, rounded inward (ecobee reports e.g. 44.6). The fallbacks
 * match the backend's (HomeDeviceService.bounds, °F) so the UI never offers a
 * setpoint the API would reject.
 */
export function limits(t: Pick<Thermostat, 'minTemp' | 'maxTemp'>): { min: number; max: number } {
  return { min: Math.ceil(t.minTemp ?? 45), max: Math.floor(t.maxTemp ?? 92) };
}

/** Keep a setpoint within the thermostat's limits; whole degrees for the ± buttons. */
export function clampSetpoint(value: number, t: Pick<Thermostat, 'minTemp' | 'maxTemp'>): number {
  const { min, max } = limits(t);
  return Math.min(max, Math.max(min, Math.round(value)));
}

export interface RangeResult {
  low: number;
  high: number;
  /** Which side was moved to keep the gap, if any. */
  pushed: 'low' | 'high' | null;
  /** The requested step couldn't be applied (it would cross a limit). */
  blocked: boolean;
}

/**
 * Apply a step to one side of an Auto range the way ecobee's own screen does:
 * clamp to the limits, and when the two get closer than `gap`, push the other
 * side along. If the other side can't move (it's at a limit), the step is
 * blocked and the previous range is returned unchanged.
 */
export function normalizeRange(
  low: number,
  high: number,
  field: 'low' | 'high',
  delta: number,
  gap: number,
  lim: { min: number; max: number },
): RangeResult {
  const clamp = (v: number) => Math.min(lim.max, Math.max(lim.min, Math.round(v)));
  if (field === 'low') {
    const nextLow = clamp(low + delta);
    if (nextLow === low) return { low, high, pushed: null, blocked: delta !== 0 };
    if (high - nextLow >= gap) return { low: nextLow, high, pushed: null, blocked: false };
    const nextHigh = nextLow + gap;
    if (nextHigh > lim.max) return { low, high, pushed: null, blocked: true };
    return { low: nextLow, high: nextHigh, pushed: 'high', blocked: false };
  }
  const nextHigh = clamp(high + delta);
  if (nextHigh === high) return { low, high, pushed: null, blocked: delta !== 0 };
  if (nextHigh - low >= gap) return { low, high: nextHigh, pushed: null, blocked: false };
  const nextLow = nextHigh - gap;
  if (nextLow < lim.min) return { low, high, pushed: null, blocked: true };
  return { low: nextLow, high: nextHigh, pushed: 'low', blocked: false };
}

export function formatTemp(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function unitSymbol(unit: string | null | undefined): string {
  return unit ? unit : '°F';
}

export type ChipTone = 'heat' | 'cool' | 'neutral' | 'warn' | 'fan';

/** The status chip: what the system is doing and toward what. */
export function statusChip(t: Thermostat): { text: string; tone: ChipTone } {
  if (!t.available) return { text: 'Offline', tone: 'warn' };
  if (t.hvacMode === 'off') return { text: 'System off', tone: 'neutral' };
  const sp = currentSetpoint(t);
  const deg = (v: number | null) => (v == null ? '' : ` ${formatTemp(v)}°`);
  switch (t.hvacAction) {
    case 'heating':
      return { text: `Heating to${deg(sp.kind === 'range' ? sp.low : sp.kind === 'single' ? sp.value : null)}`, tone: 'heat' };
    case 'cooling':
      return { text: `Cooling to${deg(sp.kind === 'range' ? sp.high : sp.kind === 'single' ? sp.value : null)}`, tone: 'cool' };
    case 'fan':
      return { text: 'Fan only', tone: 'fan' };
    case 'drying':
      return { text: 'Dehumidifying', tone: 'fan' };
    default:
      if (sp.kind === 'range' && sp.low != null && sp.high != null) {
        return { text: `Idle · ${formatTemp(sp.low)}–${formatTemp(sp.high)}°`, tone: 'neutral' };
      }
      if (sp.kind === 'single' && sp.value != null) {
        return { text: `Idle · holding ${formatTemp(sp.value)}°`, tone: 'neutral' };
      }
      return { text: actionLabel(t.hvacAction), tone: 'neutral' };
  }
}

/** "2:14 PM" today, "Yesterday 9:02 PM", else "Mon 9:02 PM" (older than a week: "Oct 3"). */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Set by you · 2:14 PM", "Set by Bryan · …", "Set at ecobee · …", "Set by Home Assistant · …". */
export function attributionText(change: ThermostatChange, currentUserId: number | null | undefined, now = new Date()): string {
  const when = formatWhen(change.at, now);
  let who: string;
  if (change.actor === 'ecobee') who = 'Set at ecobee';
  else if (change.actor === 'home_assistant') who = 'Set by Home Assistant';
  else if (currentUserId != null && change.byUserId === currentUserId) who = 'Set by you';
  else who = `Set by ${change.by}`;
  return when ? `${who} · ${when}` : who;
}

/** How long after another person's change we ask before overriding it. */
export const RECENT_CHANGE_WINDOW_MS = 10 * 60_000;

/**
 * Another app user changed this thermostat within the last 10 minutes → who and
 * how long ago, so the card can ask before overriding them. Only people count:
 * the current user's own changes, ecobee (schedule/wall unit) and Home
 * Assistant don't prompt.
 */
export function recentChangeByOther(
  change: ThermostatChange | null | undefined,
  currentUserId: number | null | undefined,
  now = Date.now(),
): { name: string; ago: string } | null {
  if (!change || change.actor !== 'app') return null;
  if (currentUserId != null && change.byUserId === currentUserId) return null;
  const elapsed = now - new Date(change.at).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > RECENT_CHANGE_WINDOW_MS) return null;
  const min = Math.floor(elapsed / 60_000);
  const ago = min < 1 ? 'just now' : `${min} minute${min === 1 ? '' : 's'} ago`;
  return { name: change.by, ago };
}

/** "Updated just now" / "Updated 4 min ago" / … from an ISO timestamp. */
export function updatedText(iso: string | null, now = Date.now()): string {
  if (!iso) return 'No reading yet';
  const diffMin = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(diffMin)) return 'No reading yet';
  if (diffMin < 1) return 'Updated just now';
  if (diffMin < 60) return `Updated ${diffMin} min ago`;
  const h = Math.round(diffMin / 60);
  return h < 24 ? `Updated ${h} hr ago` : `Updated ${Math.round(h / 24)} d ago`;
}

export function isStale(iso: string | null, now = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t > STALE_AFTER_MS;
}
