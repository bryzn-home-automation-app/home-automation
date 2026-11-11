/**
 * The one place dates, times, money, numbers and durations are written for people.
 * Faceplate's content rules (docs/faceplate/KIT.md §11) in code:
 *
 *   dates     "Mon, Nov 9" (the year only when it isn't this year), ranges "Nov 5 – Dec 5"
 *   times     "5:00 PM"; hour ticks "5 PM", "Noon", "12 AM"
 *   relative  "Just now", "2 min ago", "2 hr ago", "Yesterday", "in 3 days"
 *   money     "$1,234.50", negative "−$1.50" (a real minus sign), estimates "about $114"
 *   numbers   grouped "11,400 gal", "27%", "71°"
 *   durations one style everywhere: "45 min", "2 hr 56 min", "3 days 4 hr"
 *
 * Everything is computed in the HOME's time zone, not the phone's. The backend reads CoServ,
 * Open-Meteo and the thermostats in Central time, so a phone on a trip to California must still
 * call 11 PM at home "11 PM" and "today" the home's today (B-073, B-076 and B-093 were day maths
 * done in UTC or in the device's zone). What a value means depends on its shape:
 *
 *   - a Date, epoch ms, or an ISO string with Z or an offset: an instant, shown at home;
 *   - "2026-11-09": a calendar day, never shifted (new Date('2026-11-09') is UTC midnight,
 *     the previous evening in the US; see utils/localDate.ts);
 *   - "2026-11-09 17:00:00.0" / "2026-11-09T17:00" with no zone: the backend's LocalDateTime,
 *     which is already the home's wall clock, so it is shown as written.
 *
 * Numbers and a short unit are joined with a no-break space (NBSP below) so "1,124 sq ft" or
 * "5:00 PM" never breaks across lines. Missing or invalid values come out as DASH.
 */

/** The home's zone: Open-Meteo is asked for it and the sync scripts use it (ctDayBounds). */
export const HOME_TIME_ZONE = 'America/Chicago';

/** Shown for a missing or unreadable value. */
export const DASH = '—';
/** Joins a figure to its unit (and a time to AM/PM) so they wrap as one. */
export const NBSP = ' ';
/** The typographic minus for negative amounts ("−$1.50"), not a hyphen. */
export const MINUS = '−';
/** Ranges use a spaced en dash: "Nov 5 – Dec 5". */
export const RANGE = ' – ';

export type DateInput = Date | string | number;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

/** A moment as read on a clock at home. `hasTime` is false for a calendar day ("2026-11-09"). */
export interface HomeClock {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
  hasTime: boolean;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

let partsFormatter: Intl.DateTimeFormat | null = null;
function homeParts(ms: number): HomeClock {
  // Built lazily and kept: constructing an Intl formatter is the slow part.
  partsFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: HOME_TIME_ZONE,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  });
  const f: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(ms)) {
    if (p.type !== 'literal') f[p.type] = Number(p.value);
  }
  return fields(f.year, f.month, f.day, f.hour % 24, f.minute, f.second, true);
}

function fields(year: number, month: number, day: number, hour: number, minute: number, second: number, hasTime: boolean): HomeClock {
  // Weekday from the calendar date itself, so it never depends on the device's zone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, second, weekday, hasTime };
}

/**
 * Reads any date-like value as the home's clock (see the header for how each shape is read).
 * Null for null, undefined, '' or anything unparseable.
 */
export function homeClock(input: DateInput | null | undefined): HomeClock | null {
  if (input == null || input === '') return null;
  if (typeof input === 'string') {
    const s = input.trim();
    let m = DATE_ONLY.exec(s);
    if (m) return validDay(+m[1], +m[2], +m[3]) ? fields(+m[1], +m[2], +m[3], 0, 0, 0, false) : null;
    m = WALL_CLOCK.exec(s);
    if (m) {
      return validDay(+m[1], +m[2], +m[3])
        ? fields(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, true)
        : null;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? homeParts(ms) : null;
  }
  const ms = input instanceof Date ? input.getTime() : input;
  return Number.isFinite(ms) ? homeParts(ms) : null;
}

function validDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * The instant a value stands for, in epoch ms. A home wall-clock string is converted with the
 * home's UTC offset at that moment (DST-safe); a calendar day becomes its home midnight.
 */
export function toInstant(input: DateInput | null | undefined): number | null {
  if (input == null || input === '') return null;
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input.getTime() : null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const s = input.trim();
  if (!DATE_ONLY.test(s) && !WALL_CLOCK.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  const c = homeClock(s);
  if (!c) return null;
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  // Guess with the offset at the UTC reading, then correct once with the offset at the guess
  // (the two differ only across a DST change).
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return guess;
}

/** The home's offset from UTC at an instant, in ms (Central: −5 h or −6 h). */
function offsetAt(ms: number): number {
  const c = homeParts(ms);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-09": the home's calendar day of a value (default: now). Null when unreadable. */
export function homeDayKey(input: DateInput | null | undefined = new Date()): string | null {
  const c = homeClock(input);
  return c ? `${c.year}-${pad(c.month)}-${pad(c.day)}` : null;
}

/** Today at home as "YYYY-MM-DD" (the device's own day can already be tomorrow, or still yesterday). */
export function homeToday(now: DateInput = new Date()): string {
  return homeDayKey(now) as string;
}

/** Whole calendar days from `a` to `b` at home (b later = positive), ignoring the time of day. */
export function daysBetween(a: DateInput, b: DateInput): number | null {
  const x = homeClock(a);
  const y = homeClock(b);
  if (!x || !y) return null;
  return Math.round((Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / DAY_MS);
}

// ─── Dates ──────────────────────────────────────────────────────────────

export interface DateOptions {
  /** Show the weekday ("Mon, Nov 9"). Default true. */
  weekday?: boolean;
  /** 'auto' (default) adds the year only when it isn't the home's current year. */
  year?: 'auto' | 'always' | 'never';
  /** For tests and for "this year": defaults to the current time. */
  now?: DateInput;
}

function dateText(c: HomeClock, opts: DateOptions = {}): string {
  const { weekday = true, year = 'auto' } = opts;
  const showYear = year === 'always' || (year === 'auto' && c.year !== homeClock(opts.now ?? new Date())?.year);
  const md = `${MONTHS[c.month - 1]}${NBSP}${c.day}`;
  return `${weekday ? `${WEEKDAYS[c.weekday]}, ` : ''}${md}${showYear ? `, ${c.year}` : ''}`;
}

/** "Mon, Nov 9"; "Mon, Nov 9, 2025" in another year. */
export function formatDate(input: DateInput | null | undefined, opts?: DateOptions): string {
  const c = homeClock(input);
  return c ? dateText(c, opts) : DASH;
}

/** "Nov 9" (no weekday): table cells, chart ticks, ranges. */
export function formatShortDate(input: DateInput | null | undefined, opts?: Omit<DateOptions, 'weekday'>): string {
  return formatDate(input, { ...opts, weekday: false });
}

/** "Mon": a weekday on its own (chart ticks, the week's forecast). */
export function formatWeekday(input: DateInput | null | undefined): string {
  const c = homeClock(input);
  return c ? WEEKDAYS[c.weekday] : DASH;
}

/** "Oct ’26": a bill goes by the month its cycle ENDS in, as CoServ dates it (gasBills.billMonth; B-098). */
export function formatMonthYear(input: DateInput | null | undefined): string {
  const c = homeClock(input);
  return c ? `${MONTHS[c.month - 1]}${NBSP}’${String(c.year).slice(2)}` : DASH;
}

// ─── Times ──────────────────────────────────────────────────────────────

function timeText(c: HomeClock): string {
  const h12 = c.hour % 12 || 12;
  return `${h12}:${pad(c.minute)}${NBSP}${c.hour < 12 ? 'AM' : 'PM'}`;
}

/** "5:00 PM". A calendar day (no time) gives DASH. */
export function formatTime(input: DateInput | null | undefined): string {
  const c = homeClock(input);
  return c && c.hasTime ? timeText(c) : DASH;
}

/** An hour mark: "5 PM", "Noon", "12 AM" (hour strips and chart ticks). Accepts a value or an hour 0–23. */
export function formatHour(input: DateInput | null | undefined, opts: { hourOnly?: boolean } = {}): string {
  let hour: number;
  if (opts.hourOnly || (typeof input === 'number' && input >= 0 && input < 24 && Number.isInteger(input))) {
    hour = Number(input);
  } else {
    const c = homeClock(input);
    if (!c || !c.hasTime) return DASH;
    hour = c.hour;
  }
  if (hour === 12) return 'Noon';
  return `${hour % 12 || 12}${NBSP}${hour < 12 ? 'AM' : 'PM'}`;
}

/** "Mon, Nov 9, 5:00 PM" (year added when it isn't this year). */
export function formatDateTime(input: DateInput | null | undefined, opts?: DateOptions): string {
  const c = homeClock(input);
  if (!c) return DASH;
  return c.hasTime ? `${dateText(c, opts)}, ${timeText(c)}` : dateText(c, opts);
}

/**
 * A stamp for an event in a list or a meta line, as short as stays unambiguous:
 * today "8:05 AM", yesterday "Yesterday, 3:44 PM", this past week "Sat, 10:10 PM",
 * older "Fri, Oct 30" (with `time: 'always'`, "Fri, Oct 30, 10:10 PM").
 */
export function formatStamp(
  input: DateInput | null | undefined,
  opts: { now?: DateInput; time?: 'recent' | 'always' } = {},
): string {
  const c = homeClock(input);
  if (!c) return DASH;
  const now = opts.now ?? new Date();
  const ago = daysBetween(input as DateInput, now) ?? 0;
  if (!c.hasTime) return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : dateText(c, { now });
  if (ago === 0) return timeText(c);
  if (ago === 1) return `Yesterday, ${timeText(c)}`;
  if (ago > 1 && ago < 7) return `${WEEKDAYS[c.weekday]}, ${timeText(c)}`;
  return opts.time === 'always' ? `${dateText(c, { now })}, ${timeText(c)}` : dateText(c, { now });
}

/** A day heading: "Today", "Yesterday", "Tomorrow", else "Mon, Nov 9". */
export function formatDayName(input: DateInput | null | undefined, now: DateInput = new Date()): string {
  const c = homeClock(input);
  if (!c) return DASH;
  const ago = daysBetween(input as DateInput, now);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago === -1) return 'Tomorrow';
  return dateText(c, { now });
}

// ─── Ranges ─────────────────────────────────────────────────────────────

/**
 * "Nov 5 – Dec 5". The year is added to the end when the range isn't this year, and to both
 * ends when it spans two years. Either end missing gives "Nov 5 – …" / DASH.
 */
export function formatDateRange(
  start: DateInput | null | undefined,
  end: DateInput | null | undefined,
  opts: { weekday?: boolean; now?: DateInput } = {},
): string {
  const a = homeClock(start);
  const b = homeClock(end);
  if (!a && !b) return DASH;
  const now = opts.now ?? new Date();
  const weekday = opts.weekday ?? false;
  if (!a || !b) {
    const one = (a ?? b) as HomeClock;
    return a ? `${dateText(one, { weekday, now })}${RANGE}…` : `…${RANGE}${dateText(one, { weekday, now })}`;
  }
  const thisYear = homeClock(now)?.year;
  if (a.year !== b.year) {
    return `${dateText(a, { weekday, year: 'always' })}${RANGE}${dateText(b, { weekday, year: 'always' })}`;
  }
  return `${dateText(a, { weekday, year: 'never' })}${RANGE}${dateText(b, { weekday, year: b.year === thisYear ? 'never' : 'always' })}`;
}

/**
 * "6:40 PM – 9:15 PM"; when the end falls on a later day than the start it says so,
 * "6:40 PM – Tue, 5:32 AM", so an overnight run can't look as if it ended before it began (B-134).
 */
export function formatTimeRange(start: DateInput | null | undefined, end: DateInput | null | undefined): string {
  const a = homeClock(start);
  const b = homeClock(end);
  if (!a || !a.hasTime) return DASH;
  if (!b || !b.hasTime) return `${timeText(a)}${RANGE}…`;
  const days = daysBetween(start as DateInput, end as DateInput) ?? 0;
  if (days === 0) return `${timeText(a)}${RANGE}${timeText(b)}`;
  return `${timeText(a)}${RANGE}${WEEKDAYS[b.weekday]}, ${timeText(b)}`;
}

// ─── Relative time and durations ────────────────────────────────────────

/**
 * How long ago (or until): "Just now", "1 min ago", "2 hr ago", "Yesterday", "3 days ago",
 * then the date; ahead, "in 5 min", "in 2 hr", "Tomorrow", "in 3 days". Hours count until the
 * calendar day changes at home, so 11 PM yesterday is "Yesterday", not "9 hr ago". Minutes win
 * over the day: three minutes across midnight is "3 min ago", not "Yesterday".
 */
export function formatRelative(input: DateInput | null | undefined, now: DateInput = new Date()): string {
  const at = toInstant(input);
  const nowMs = toInstant(now);
  if (at == null || nowMs == null) return DASH;
  const diffMin = Math.round((nowMs - at) / 60_000);
  const future = diffMin < 0;
  const min = Math.abs(diffMin);
  const days = Math.abs(daysBetween(at, nowMs) ?? 0);
  if (min < 1) return 'Just now';
  if (min < 60) return future ? `in ${min} min` : `${min} min ago`;
  if (days === 0) {
    const hr = Math.floor(min / 60);
    return future ? `in ${hr} hr` : `${hr} hr ago`;
  }
  if (days === 1) return future ? 'Tomorrow' : 'Yesterday';
  if (days < 7) return future ? `in ${days} days` : `${days} days ago`;
  return formatDate(at, { now });
}

/**
 * A length of time, the one style for the whole app: "under 1 min", "45 min", "2 hr 56 min",
 * "3 days 4 hr". From 10 hours the minutes are dropped ("14 hr"); from a day the hours are
 * the smallest step. Negative or missing gives DASH.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return DASH;
  if (minutes < 1) return `under${NBSP}1${NBSP}min`;
  const total = Math.round(minutes);
  if (total < 60) return `${total}${NBSP}min`;
  const hr = Math.floor(total / 60);
  const min = total % 60;
  if (hr < 24) return min && hr < 10 ? `${hr}${NBSP}hr ${min}${NBSP}min` : `${hr}${NBSP}hr`;
  const days = Math.floor(hr / 24);
  const rest = hr % 24;
  return `${plural(days, 'day')}${rest ? ` ${rest}${NBSP}hr` : ''}`;
}

/** The time between two values as a duration ("2 hr 56 min"). */
export function formatDurationBetween(start: DateInput | null | undefined, end: DateInput | null | undefined): string {
  const a = toInstant(start);
  const b = toInstant(end);
  return a == null || b == null ? DASH : formatDuration((b - a) / 60_000);
}

// ─── Numbers, money, units ──────────────────────────────────────────────

function grouped(n: number, decimals: number, minDecimals = decimals): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: minDecimals, maximumFractionDigits: decimals });
}

/** A unit's join: none before %, ° and ′, a no-break space otherwise ("27%", "71°", "35.5 kWh"). */
function withUnit(text: string, unit?: string): string {
  if (!unit) return text;
  return /^[%°′″]/.test(unit) ? `${text}${unit}` : `${text}${NBSP}${unit}`;
}

/**
 * "11,400", "35.5 kWh", "−3.2°". `decimals` is the most shown (default 0); trailing zeros are kept
 * only with `fixed: true` ("35.0").
 */
export function formatNumber(
  value: number | null | undefined,
  opts: { decimals?: number; fixed?: boolean; unit?: string; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const { decimals = 0, fixed = false, unit, signed = false } = opts;
  // Round first so a value that rounds to zero is "0", never "−0".
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded < 0 ? MINUS : signed && rounded > 0 ? '+' : '';
  return withUnit(`${sign}${grouped(Math.abs(rounded), decimals, fixed ? decimals : 0)}`, unit);
}

/** "27%" from 27 (a percentage, not a fraction). */
export function formatPercent(value: number | null | undefined, decimals = 0): string {
  return formatNumber(value, { decimals, unit: '%' });
}

/** "71°" (rounded). */
export function formatTemp(value: number | null | undefined, decimals = 0): string {
  return formatNumber(value, { decimals, unit: '°' });
}

/**
 * "$1,234.50", "−$1.50", "$0.00". `cents: false` rounds to whole dollars ("$114").
 * `signed` adds "+" to a positive amount (a difference: "+$3.20").
 */
export function formatMoney(
  value: number | null | undefined,
  opts: { cents?: boolean; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const decimals = opts.cents === false ? 0 : 2;
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded < 0 ? MINUS : opts.signed && rounded > 0 ? '+' : '';
  return `${sign}$${grouped(Math.abs(rounded), decimals, decimals)}`;
}

/** An estimate, without false precision: "about $114". */
export function formatAbout(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? DASH : `about ${formatMoney(value, { cents: false })}`;
}

/** A rate: "$0.1171/kWh" (four decimals: CoServ's tariff precision). */
export function formatRate(value: number | null | undefined, unit: string, decimals = 4): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `$${grouped(value, decimals, decimals)}/${unit}`;
}

// ─── Words ──────────────────────────────────────────────────────────────

/** "1 day", "3 days", "1,124 rooms" (the count grouped, joined with a no-break space). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${grouped(count, 0)}${NBSP}${count === 1 ? singular : pluralForm}`;
}

/** Just the word for a count: pluralWord(3, 'alert') = "alerts". */
export function pluralWord(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** "Bryan, Mai and Linh"; "Bryan and Mai"; "Bryan". */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
