import type { DailyUsagePoint, RoombaRun, RoombaStatus, Thermostat, WeatherHour } from '../../types';
import type { Notification } from '../../api/notifications';
import { COMPLETE_DAY_MIN_HOURS } from '../../utils/usageSummary';
import {
  daysBetween, formatHour, formatNumber, formatShortDate, formatStamp, formatTemp, plural, type DateInput,
} from '../../utils/format';
import { notificationCategory, worstTone, type Tone } from '../../utils/status';
import { isRecharging } from '../../utils/roomba';
import { roombaState, type RoombaState } from '../../utils/roombaStatus';
import { hourOf, rainRuns } from '../../utils/weather';

/*
 * Home's words, kept free of React so each rule is tested on its own (test/homeSummary.test.ts).
 * Home only summarises: every figure here has a page that explains it.
 */

// ─── Electric ───────────────────────────────────────────────────────────

/**
 * The newest day with a full set of readings. Same threshold as the Electric tab's averages
 * (usageSummary COMPLETE_DAY_MIN_HOURS), so the two don't name different days as the latest
 * while yesterday is still posting (B-081, Home's part).
 */
export function latestCompleteDay(daily: DailyUsagePoint[] | undefined): DailyUsagePoint | null {
  const complete = (Array.isArray(daily) ? daily : []).filter((d) => d.readingCount >= COMPLETE_DAY_MIN_HOURS);
  if (!complete.length) return null;
  return complete.reduce((a, b) => (b.date > a.date ? b : a));
}

// ─── Roomba ─────────────────────────────────────────────────────────────

/**
 * What the robot is doing, for Home's readout, lamp and shortcut. The state itself comes from
 * utils/roombaStatus, the same function the Roomba page draws from, so the two pages can't
 * disagree: a stale reading is "Offline" with when it was last seen (B-070), the bin emptying
 * is not "Cleaning" (B-140). Home only adds the robot's own "needs a look" flag to the tone,
 * which is what the Roomba page's verdict does too, so a badge can't contradict the line beside
 * it (B-065).
 */
export interface HomeRoomba {
  state: RoombaState;
  tone: Tone;
  /** "Docked. Last cleaned Nov 8, 1,124 sq ft" / "Offline. Last seen cleaning, 2 hr ago". */
  line: string;
}

export function homeRoomba(
  rb: RoombaStatus | null | undefined,
  lastRun: RoombaRun | null | undefined,
  now: DateInput = new Date(),
): HomeRoomba {
  const state = roombaState(rb, toTime(now));
  const detail = roombaDetail(rb, lastRun, now);
  if (!rb) return { state, tone: 'neutral', line: detail };
  const flagged = !state.offline && rb.needsAttention && state.tone !== 'problem';
  return { state, tone: flagged ? 'headsup' : state.tone, line: `${state.label}. ${detail}` };
}

/** The line under the Roomba's state. */
export function roombaDetail(rb: RoombaStatus | null | undefined, lastRun: RoombaRun | null | undefined, now: DateInput = new Date()): string {
  if (!rb) return 'Waiting for the robot to check in';
  const state = roombaState(rb, toTime(now));
  if (state.offline) return state.lastSeen ?? 'Not heard from yet';
  if (rb.needsAttention && rb.attentionReasons.length) return rb.attentionReasons[0];
  const phase = (rb.phase ?? '').toLowerCase();
  const sqft = rb.sqft != null ? formatNumber(rb.sqft, { unit: 'sq ft' }) : null;
  if (phase === 'evac') return 'Emptying the bin at the dock';
  if (state.cleaning) return sqft ? `Cleaning now, ${sqft} so far` : 'Cleaning now';
  if (isRecharging(rb)) return sqft ? `Recharging to finish, ${sqft} so far` : 'Recharging to finish the clean';
  return lastRunWords(lastRun) ?? 'No cleans recorded yet';
}

function toTime(now: DateInput): Date | number {
  return typeof now === 'string' ? new Date(now) : now;
}

/** How a finished run ended, in words (B-069: a cancelled run is not "Last cleaned"). */
export function lastRunWords(run: Pick<RoombaRun, 'status' | 'completedAt' | 'squareFeet'> | null | undefined): string | null {
  if (!run?.completedAt) return null;
  const when = formatShortDate(run.completedAt);
  const lead = run.status === 'COMPLETED'
    ? 'Last cleaned'
    : run.status === 'STUCK'
      ? 'Last run got stuck'
      : run.status === 'CANCELLED'
        ? 'Last run cancelled'
        : 'Last run ended early';
  const area = run.status === 'COMPLETED' && run.squareFeet != null ? `, ${formatNumber(run.squareFeet, { unit: 'sq ft' })}` : '';
  return `${lead} ${when}${area}`;
}

// ─── Climate ────────────────────────────────────────────────────────────

/** "71°, idle" / "69°, heating to 70°" / "off" for one thermostat. */
export function thermostatWords(t: Thermostat): string {
  if (!t.available) return 'not answering';
  const temp = formatTemp(t.temperature);
  const action = (t.hvacAction ?? '').toLowerCase();
  const mode = (t.hvacMode ?? '').toLowerCase();
  if (mode === 'off' || action === 'off') return `${temp}, off`;
  if (action === 'heating') return `${temp}, heating to ${formatTemp(t.heatSetpoint ?? t.targetTemperature)}`;
  if (action === 'cooling') return `${temp}, cooling to ${formatTemp(t.coolSetpoint ?? t.targetTemperature)}`;
  return `${temp}, idle`;
}

/** "Downstairs 71°, idle. Upstairs 69°, heating to 70°" */
export function climateLine(thermostats: Thermostat[]): string {
  return thermostats.map((t) => `${t.name} ${thermostatWords(t)}`).join('. ');
}

// ─── Weather ────────────────────────────────────────────────────────────

/** "1 – 9 AM" / "11 PM – 2 AM" / "until 9 AM" for the first run of likely rain in these hours. */
export function rainWindow(hours: WeatherHour[]): { from: number; to: number; text: string; range: string } | null {
  const run = rainRuns(hours)[0];
  if (!run) return null;
  const from = hourOf(run.from.time);
  const to = (hourOf(run.to.time) + 1) % 24;
  const startsNow = hours.length > 0 && run.from.time === hours[0].time;
  const fromText = from === 0 ? 'midnight' : formatHour(from);
  const toText = formatHour(to);
  // "1 – 9 AM" when both ends share AM/PM, as people say it.
  const sameHalf = from !== 0 && from !== 12 && to !== 12 && (from < 12) === (to < 12) && to !== 0;
  const text = startsNow
    ? `until ${toText}`
    : sameHalf
      ? `from ${fromText.replace(/\s?(AM|PM)$/, '')} to ${toText}`
      : `from ${fromText} to ${toText}`;
  // The legend's short form: "1 – 9 AM", "Midnight – 10 AM", "Now – 9 AM".
  const startText = startsNow ? 'Now' : sameHalf ? fromText.replace(/\s?(AM|PM)$/, '') : fromText;
  const range = `${startText.charAt(0).toUpperCase()}${startText.slice(1)} – ${toText}`;
  return { from, to, text, range };
}

// ─── Needs a look ───────────────────────────────────────────────────────

export interface AttentionItem {
  key: string;
  tone: Tone;
  title: string;
  meta?: string;
  to: string;
}

export interface AttentionInput {
  roomba?: RoombaStatus | null;
  thermostats?: Thermostat[] | null;
  /** The newest few alerts (the Home list). */
  alerts?: Notification[] | null;
  latestDay?: DailyUsagePoint | null;
  now?: DateInput;
}

/**
 * The few things worth a tap, worst first. Only what the family can act on or should know:
 * a robot that needs help, a thermostat that stopped answering, unread warnings, electric
 * readings that have fallen behind.
 */
export function attentionItems({ roomba, thermostats, alerts, latestDay, now = new Date() }: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (roomba) {
    if (roomba.error) {
      items.push({ key: 'roomba', tone: 'problem', title: 'The Roomba needs help', meta: roomba.errorText ?? 'Open Roomba to see what happened', to: '/roomba' });
    } else if (roomba.needsAttention && roomba.attentionReasons.length) {
      const [first, ...rest] = roomba.attentionReasons;
      items.push({ key: 'roomba', tone: 'headsup', title: first, meta: rest.length ? rest.join('. ') : 'Open Roomba for the details', to: '/roomba' });
    } else if (!roomba.online) {
      const seen = roombaState(roomba, toTime(now)).lastSeen;
      items.push({ key: 'roomba', tone: 'headsup', title: "The Roomba hasn't checked in", meta: seen ?? 'Open Roomba for the details', to: '/roomba' });
    }
  }

  const silent = (thermostats ?? []).filter((t) => !t.available);
  if (silent.length) {
    items.push({
      key: 'climate',
      tone: 'headsup',
      title: silent.length === 1 ? `The ${silent[0].name} thermostat isn't answering` : `${silent.length} thermostats aren't answering`,
      meta: 'Its readings and controls are paused until it is back',
      to: '/climate',
    });
  }

  const unread = (alerts ?? []).filter((a) => !a.isRead);
  const critical = unread.filter((a) => a.severity === 'CRITICAL');
  const warning = unread.filter((a) => a.severity === 'WARNING');
  if (critical.length) {
    items.push({ key: 'alerts-critical', tone: 'problem', title: critical.length === 1 ? critical[0].title : `${plural(critical.length, 'urgent alert')} unread`, meta: alertMeta(critical[0], now), to: '/notifications' });
  } else if (warning.length) {
    items.push({ key: 'alerts-warning', tone: 'headsup', title: warning.length === 1 ? warning[0].title : `${plural(warning.length, 'heads-up alert')} unread`, meta: alertMeta(warning[0], now), to: '/notifications' });
  }

  // CoServ posts yesterday by the evening; three days without a full day means the sync is stuck.
  if (latestDay) {
    const age = daysBetween(latestDay.date, now);
    if (age != null && age >= 3) {
      items.push({ key: 'electric', tone: 'headsup', title: 'Electric readings are behind', meta: `The last full day is ${formatShortDate(latestDay.date)}`, to: '/utility' });
    }
  }

  const rank: Record<Tone, number> = { problem: 0, headsup: 1, info: 2, ok: 3, neutral: 4 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** "Electric · 8:05 AM": the alert's topic and when (the same line the alerts list shows). */
export function alertMeta(a: Pick<Notification, 'category' | 'createdAt'>, now: DateInput = new Date()): string {
  return `${notificationCategory(a.category).label} · ${formatStamp(a.createdAt, { now })}`;
}

/** The verdict sentence and its lamp for a list of attention items. */
export function homeVerdict(items: AttentionItem[]): { tone: Tone; text: string } {
  if (!items.length) return { tone: 'ok', text: 'All quiet at home.' };
  const tone = worstTone(items.map((i) => i.tone));
  return { tone, text: items.length === 1 ? 'One thing needs a look.' : 'A few things need a look.' };
}
