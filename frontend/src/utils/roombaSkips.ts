import type { RoombaNativeSchedule, RoombaScheduleSkip } from '../types';
import { daysBetween, formatDate, formatTime, formatWeekdayLong, homeClock, type DateInput } from './format';

/*
 * Skipping a scheduled clean, for the Roomba page. iRobot has no "skip once": the poller switches
 * the schedule off in the iRobot app across the skipped start and back on after it
 * (roomba-poller/schedule_skips.py). These helpers say which clean can be skipped, which are, and
 * how to put that into words.
 */

/** Skips the poller is still working on. */
const ACTIVE = new Set(['PENDING', 'APPLYING', 'APPLIED']);
/** The backend refuses a clean starting within two minutes (RoombaScheduleSkipService.TOO_SOON). */
const LEAD_MINUTES = 2;

type ScheduleLike = Pick<RoombaNativeSchedule, 'householdScheduleId' | 'days' | 'hour' | 'minute' | 'enabled' | 'name'>;

/** Still under way (the schedule may be off because of it), undone or not. */
export function isActiveSkip(s: Pick<RoombaScheduleSkip, 'state'>): boolean {
  return ACTIVE.has(s.state);
}

/** The clean is skipped: under way and not undone. */
export function isSkipping(s: Pick<RoombaScheduleSkip, 'state' | 'undoRequested'>): boolean {
  return ACTIVE.has(s.state) && !s.undoRequested;
}

/** Schedules switched off by a skip of ours count as on: the poller switches them back. */
export function heldSchedules(skips: readonly RoombaScheduleSkip[] | null | undefined): Set<string> {
  return new Set((skips ?? []).filter(isActiveSkip).map((s) => s.householdScheduleId));
}

/** "householdScheduleId|YYYY-MM-DD" of every skipped clean. */
export function skippedCleans(skips: readonly RoombaScheduleSkip[] | null | undefined): Set<string> {
  return new Set((skips ?? []).filter(isSkipping).map((s) => `${s.householdScheduleId}|${s.date}`));
}

/**
 * Whether a schedule runs on a weekday (0 = Sunday … 6 = Saturday). Schedules count Monday as 1;
 * Sunday may come as 7 or as iRobot's own 0.
 */
export function runsOnWeekday(days: readonly number[], weekday: number): boolean {
  return days.includes(weekday === 0 ? 7 : weekday) || (weekday === 0 && days.includes(0));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "9:00 AM" for a schedule's hour and minute. */
export function scheduleTime(hour: number, minute: number): string {
  return formatTime(`2026-01-05T${pad2(hour)}:${pad2(minute)}`);
}

export interface SkippableClean {
  householdScheduleId: string;
  name: string | null;
  /** The day at home, "YYYY-MM-DD". */
  date: string;
  hour: number;
  minute: number;
}

/**
 * The first clean today (`offset` 0, still more than two minutes away) or tomorrow (1) that can be
 * skipped: from a schedule that is on (or off only for a skip of ours), and not skipped already.
 */
export function skippableClean(
  schedules: readonly ScheduleLike[] | null | undefined,
  skips: readonly RoombaScheduleSkip[] | null | undefined,
  offset: 0 | 1,
  now: DateInput = Date.now(),
): SkippableClean | null {
  const today = homeClock(now);
  if (!today || !schedules) return null;
  const held = heldSchedules(skips);
  const skipped = skippedCleans(skips);
  const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
  const date = `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
  const earliest = offset === 0 ? today.hour * 60 + today.minute + LEAD_MINUTES : -1;
  let best: SkippableClean | null = null;
  for (const s of schedules) {
    if (!(s.enabled || held.has(s.householdScheduleId)) || s.hour == null || s.minute == null) continue;
    if (!runsOnWeekday(s.days, day.getUTCDay())) continue;
    if (skipped.has(`${s.householdScheduleId}|${date}`)) continue;
    const minutes = s.hour * 60 + s.minute;
    if (minutes <= earliest) continue;
    if (!best || minutes < best.hour * 60 + best.minute) {
      best = { householdScheduleId: s.householdScheduleId, name: s.name, date, hour: s.hour, minute: s.minute };
    }
  }
  return best;
}

/** "Today's 9:00 AM clean", "Tomorrow's 9:00 AM clean", "Thursday's 9:00 AM clean". */
export function cleanName(date: string, hour: number, minute: number, now: DateInput = Date.now()): string {
  const ahead = daysBetween(now, date);
  const day = ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : ahead === -1 ? 'Yesterday' : formatWeekdayLong(date);
  return `${day}'s ${scheduleTime(hour, minute)} clean`;
}

/** "today at 3:00 PM", "tomorrow at 9:00 AM", "Monday at 9:00 AM", "Mon, Nov 30 at 9:00 AM". */
export function cleanWhen(at: DateInput, now: DateInput = Date.now()): string {
  const ahead = daysBetween(now, at) ?? 0;
  const day = ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : ahead > 1 && ahead < 7 ? formatWeekdayLong(at) : formatDate(at, { now });
  return `${day} at ${formatTime(at)}`;
}

/** "9:30 AM" today, else "tomorrow at 9:30 AM" / "Thursday at 9:30 AM". */
function until(at: DateInput, now: DateInput): string {
  return (daysBetween(now, at) ?? 0) === 0 ? formatTime(at) : cleanWhen(at, now);
}

export interface SkipPicture {
  /** Cleans skipped and still ahead, soonest first. */
  skipped: RoombaScheduleSkip[];
  /** The latest skip that couldn't be made, while it matters (12 h after its clean). */
  failed: RoombaScheduleSkip | null;
  /** A skip that ended before its clean without an undo (changed or switched on in the app). */
  dropped: RoombaScheduleSkip | null;
}

/** What the page shows about skips now. */
export function skipPicture(skips: readonly RoombaScheduleSkip[] | null | undefined, now: DateInput = Date.now()): SkipPicture {
  const nowMs = new Date(now).getTime();
  const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const list = [...(skips ?? [])];
  const skipped = list
    .filter((s) => isSkipping(s) && at(s.scheduledFor) > nowMs)
    .sort((a, b) => at(a.scheduledFor) - at(b.scheduledFor));
  const newest = (xs: RoombaScheduleSkip[]) => xs.sort((a, b) => at(b.scheduledFor) - at(a.scheduledFor))[0] ?? null;
  const failed = newest(list.filter((s) => s.state === 'FAILED' && at(s.scheduledFor) > nowMs - 12 * 3_600_000));
  const dropped = newest(list.filter((s) => (s.state === 'CANCELLED' || s.state === 'RESTORED') && !s.undoRequested
    && at(s.scheduledFor) > nowMs && at(s.finishedAt) < at(s.scheduledFor)));
  return { skipped, failed, dropped };
}

/**
 * The line under a skipped clean: why the iRobot app shows its schedule off, and until when. With a
 * failing cloud call, says it's retrying instead. `days` names the schedule ("Tue – Thu"): the
 * iRobot app calls every schedule "Regular Schedule".
 */
export function skipStatusLine(s: RoombaScheduleSkip, now: DateInput = Date.now(), days?: string): string {
  if (s.lastError) return "Couldn't reach the iRobot cloud yet. The home app keeps trying.";
  const which = days ? `The ${days} schedule` : 'Its schedule';
  const back = until(s.restoreAfter, now);
  if (s.state === 'APPLIED' || s.state === 'APPLYING') return `${which} is off in the iRobot app until ${back}.`;
  return `${which} will be off in the iRobot app until ${back}.`;
}
