import type { IconName } from '../components/ui/Icon';

/**
 * The one mapping from the server's enums to Faceplate's status language: a tone and a plain
 * label. Faceplate has exactly four status words and lamps, OK (green), Heads-up (amber),
 * Problem (red) and Info (blue), plus neutral for a plain state that isn't a judgement
 * ("Idle", "Expired"). Pages never pick a status colour themselves; they ask here, and draw
 * the result with <Lamp>, <Badge> or <StatusText> (components/ui/Status.tsx).
 *
 * Unknown values (a new enum the backend adds before the app knows it) fall back to neutral
 * with the raw value tidied into words, so nothing renders blank or SHOUTS.
 */

export type Tone = 'ok' | 'headsup' | 'problem' | 'info' | 'neutral';

export interface Status {
  tone: Tone;
  /** What people read: "Heads-up", "Member", "Emptying the bin". */
  label: string;
}

/** The status words, for a lamp that needs its word said (sr-only text, a legend). */
export const TONE_WORD: Record<Tone, string> = {
  ok: 'OK',
  headsup: 'Heads-up',
  problem: 'Problem',
  info: 'Info',
  neutral: 'No status',
};

/** Worst first: the order a list of statuses is summed up in (a verdict's lamp is the worst row). */
export const TONE_RANK: Record<Tone, number> = { problem: 4, headsup: 3, info: 2, ok: 1, neutral: 0 };

/** The worst tone of several ("the lamp is the worst row listed"); neutral for none. */
export function worstTone(tones: Iterable<Tone>): Tone {
  let worst: Tone = 'neutral';
  for (const t of tones) if (TONE_RANK[t] > TONE_RANK[worst]) worst = t;
  return worst;
}

// The kit's class suffixes call heads-up "warn" (fp-lamp--warn, fp-badge--warn). Neutral has none.
const KIT: Record<Tone, string> = { ok: 'ok', headsup: 'warn', problem: 'problem', info: 'info', neutral: '' };

/** The kit modifier for a tone: kitTone('headsup') = 'warn'; '' for neutral. */
export function kitTone(tone: Tone): string {
  return KIT[tone];
}

/** "PENDING_APPROVAL" → "Pending approval": the fallback for values the app doesn't know yet. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const words = value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lookup(table: Record<string, Status>, value: string | null | undefined, fallback: Status): Status {
  if (!value) return fallback;
  return table[value] ?? table[value.toUpperCase()] ?? { tone: 'neutral', label: humanize(value) };
}

const NONE: Status = { tone: 'neutral', label: '' };

// ─── People ─────────────────────────────────────────────────────────────

/** Role labels are Admin / Member / Guest everywhere (never ADMIN, USER, "Household Member"; B-053). */
export const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', USER: 'Member', GUEST: 'Guest' };

/** "Admin" / "Member" / "Guest" from user.role. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABEL[role.toUpperCase()] ?? humanize(role);
}

const ACCOUNT: Record<string, Status> = {
  ACTIVE: { tone: 'ok', label: 'Active' },
  PENDING_APPROVAL: { tone: 'headsup', label: 'Waiting for approval' },
  DISABLED: { tone: 'neutral', label: 'Turned off' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
};
/** An account (AdminUser.status, ProfileResponse.status). */
export function accountStatus(status: string | null | undefined): Status {
  return lookup(ACCOUNT, status, NONE);
}

const GUEST_SESSION: Record<string, Status> = {
  ACTIVE: { tone: 'ok', label: 'Active' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
  REVOKED: { tone: 'neutral', label: 'Ended' },
};
/** A guest's visit (GuestSession.status). */
export function guestSessionStatus(status: string | null | undefined): Status {
  return lookup(GUEST_SESSION, status, NONE);
}

const DEVICE_LINK: Record<string, Status> = {
  PENDING: { tone: 'headsup', label: 'Waiting to link' },
  LINKED: { tone: 'ok', label: 'Linked' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
};
/** A "This device" link code (Who's home). */
export function deviceLinkStatus(status: string | null | undefined): Status {
  return lookup(DEVICE_LINK, status, NONE);
}

// ─── Alerts ─────────────────────────────────────────────────────────────

const SEVERITY: Record<string, Status> = {
  CRITICAL: { tone: 'problem', label: 'Problem' },
  WARNING: { tone: 'headsup', label: 'Heads-up' },
  INFO: { tone: 'info', label: 'Info' },
  SUCCESS: { tone: 'ok', label: 'OK' },
};
/** A notification's severity (Notification.severity). */
export function severityStatus(severity: string | null | undefined): Status {
  return lookup(SEVERITY, severity, { tone: 'info', label: 'Info' });
}

/** Category is a topic, not a status: a label and its nav icon, no colour. */
export interface Category {
  label: string;
  icon: IconName;
}
const CATEGORY: Record<string, Category> = {
  ELECTRICAL: { label: 'Electric', icon: 'bolt' },
  GAS: { label: 'Gas', icon: 'flame' },
  WATER: { label: 'Water', icon: 'droplet' },
  ROOMBA: { label: 'Roomba', icon: 'robot' },
  CAMERA: { label: 'Cameras', icon: 'camera' },
  WIFI: { label: 'Guest Wi-Fi', icon: 'wifi' },
  WEATHER: { label: 'Weather', icon: 'cloud-sun' },
  SYSTEM: { label: 'Home server', icon: 'server' },
  REMINDER: { label: 'Reminders', icon: 'calendar' },
};
/** A notification's category (Notification.category). */
export function notificationCategory(category: string | null | undefined): Category {
  if (!category) return { label: 'General', icon: 'bell' };
  return CATEGORY[category.toUpperCase()] ?? { label: humanize(category), icon: 'bell' };
}

// ─── Admin ──────────────────────────────────────────────────────────────

const EVENT_LEVEL: Record<string, Status> = {
  ERROR: { tone: 'problem', label: 'Failed' },
  WARN: { tone: 'headsup', label: 'Warning' },
  WARNING: { tone: 'headsup', label: 'Warning' },
  INFO: { tone: 'ok', label: 'OK' },
};
/** A diagnostic event's level (app_events: ERROR / WARN / INFO). */
export function eventLevelStatus(level: string | null | undefined): Status {
  return lookup(EVENT_LEVEL, level, { tone: 'ok', label: 'OK' });
}

const CHECK_LEVEL: Record<string, Status> = {
  CRITICAL: { tone: 'problem', label: 'Problem' },
  WARNING: { tone: 'headsup', label: 'Heads-up' },
  OK: { tone: 'ok', label: 'OK' },
  WARN: { tone: 'headsup', label: 'Heads-up' },
};
/** A health check (HostCheck.level 'critical' | 'warning'; Diagnostics config checks 'OK' | 'WARN'). */
export function checkStatus(level: string | null | undefined): Status {
  return lookup(CHECK_LEVEL, level, NONE);
}

// ─── Maintenance (enum only: the tab itself is deferred) ────────────────

const PRIORITY: Record<string, Status> = {
  LOW: { tone: 'neutral', label: 'Low' },
  MEDIUM: { tone: 'neutral', label: 'Normal' },
  HIGH: { tone: 'headsup', label: 'High' },
  EMERGENCY: { tone: 'problem', label: 'Urgent' },
};
/** A job's priority (MaintenanceRecord.priority). */
export function priorityStatus(priority: string | null | undefined): Status {
  return lookup(PRIORITY, priority, NONE);
}

const JOB: Record<string, Status> = {
  SCHEDULED: { tone: 'info', label: 'Scheduled' },
  IN_PROGRESS: { tone: 'headsup', label: 'In progress' },
  COMPLETED: { tone: 'ok', label: 'Done' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};
/** A job's status (MaintenanceRecord.status). */
export function jobStatus(status: string | null | undefined): Status {
  return lookup(JOB, status, NONE);
}

// ─── Devices ────────────────────────────────────────────────────────────

/** The Roomba status fields this needs (RoombaStatus from api/roomba). */
export interface RoombaPhaseInput {
  phase: string | null;
  cycle?: string | null;
  error?: number | null;
  errorText?: string | null;
  running?: boolean;
  dockError?: number | null;
  dockText?: string | null;
}

/**
 * What the robot is doing, in family words. Order matters: an error wins, then the bin
 * emptying (the dock's "evac" phase counts as running, which once made the page say
 * "Cleaning" while it emptied; B-140), then a mid-clean recharge (phase "charge" with the
 * cycle still on reads as finished otherwise; see utils/roomba.isRecharging).
 */
export function roombaPhaseStatus(s: RoombaPhaseInput | null | undefined): Status {
  if (!s) return { tone: 'neutral', label: 'No status yet' };
  if (s.error) return { tone: 'problem', label: s.errorText ? s.errorText : 'Needs help' };
  const phase = (s.phase ?? '').toLowerCase();
  const cycleOn = s.cycle != null && s.cycle !== '' && s.cycle !== 'none';
  if (phase === 'evac') return { tone: 'info', label: 'Emptying the bin' };
  if (phase === 'stuck') return { tone: 'problem', label: 'Stuck' };
  if (phase === 'charge') {
    if (cycleOn) return { tone: 'info', label: 'Recharging to finish' };
    if (s.dockError) return { tone: 'headsup', label: s.dockText ? `Dock: ${s.dockText}` : 'Dock needs a look' };
    return { tone: 'ok', label: 'Docked' };
  }
  if (phase === 'run') return { tone: 'info', label: 'Cleaning' };
  if (phase === 'hmpostmsn' || phase === 'hmusrdock' || phase === 'hmmidmsn') return { tone: 'info', label: 'Heading home' };
  if (phase === 'stop' || phase === 'pause') return { tone: cycleOn ? 'headsup' : 'neutral', label: cycleOn ? 'Paused' : 'Stopped' };
  if (phase === 'idle' || phase === '') return { tone: 'neutral', label: s.running ? 'Cleaning' : 'Idle' };
  return { tone: s.running ? 'info' : 'neutral', label: humanize(s.phase) };
}

/**
 * A battery level: a heads-up under 30% (the Driveway camera at 27%), a problem under 15%.
 * `charging` keeps a low battery from alarming while it fills.
 */
export function batteryStatus(pct: number | null | undefined, charging = false): Status {
  if (pct == null || !Number.isFinite(pct)) return { tone: 'neutral', label: 'Battery unknown' };
  const label = `${Math.round(pct)}%`;
  if (charging) return { tone: 'ok', label: `${label}, charging` };
  if (pct < 15) return { tone: 'problem', label };
  if (pct < 30) return { tone: 'headsup', label };
  return { tone: 'ok', label };
}

/** A device that is either reachable or not (cameras, thermostats, the hub). */
export function onlineStatus(online: boolean | null | undefined): Status {
  if (online == null) return { tone: 'neutral', label: 'Not checked yet' };
  return online ? { tone: 'ok', label: 'Online' } : { tone: 'problem', label: 'Offline' };
}
