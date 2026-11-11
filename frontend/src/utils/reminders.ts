import type {
  DueReminder,
  HeadsUpInput,
  HeadsUpKind,
  HeadsUpOption,
  Reminder,
  ReminderHeadsUp,
  ReminderInput,
  ReminderRepeat,
  Weekday,
} from '../api/reminders';
import { daysBetween, formatDate, formatList, formatTime, homeToday, type DateInput } from './format';

/*
 * Reminders in plain words: the rule ("Every Friday · heads-up the afternoon and evening
 * before · done by 8:00 AM"), Home's due line ("Tomorrow · Fri, Nov 13"), and the add/edit
 * form's draft. Every date goes through utils/format.ts (the home's clock).
 */

export const WEEKDAYS: readonly { value: Weekday; short: string; long: string }[] = [
  { value: 'MON', short: 'Mon', long: 'Monday' },
  { value: 'TUE', short: 'Tue', long: 'Tuesday' },
  { value: 'WED', short: 'Wed', long: 'Wednesday' },
  { value: 'THU', short: 'Thu', long: 'Thursday' },
  { value: 'FRI', short: 'Fri', long: 'Friday' },
  { value: 'SAT', short: 'Sat', long: 'Saturday' },
  { value: 'SUN', short: 'Sun', long: 'Sunday' },
];

/** The heads-up choices in the order the form shows them (earliest first). */
export const HEADS_UP_ORDER: readonly HeadsUpKind[] = [
  'DAYS_BEFORE',
  'MORNING_BEFORE',
  'AFTERNOON_BEFORE',
  'EVENING_BEFORE',
  'NIGHT_BEFORE',
  'MORNING_OF',
  'AT_TIME',
];

/** Names for the choices; the server's /reminders/heads-ups adds each preset's time. */
export const HEADS_UP_LABEL: Record<HeadsUpKind, string> = {
  DAYS_BEFORE: 'Days before',
  MORNING_BEFORE: 'Morning before',
  AFTERNOON_BEFORE: 'Afternoon before',
  EVENING_BEFORE: 'Evening before',
  NIGHT_BEFORE: 'Night before',
  MORNING_OF: 'Morning of',
  AT_TIME: 'At a time on the day',
};

export const MAX_DAYS_BEFORE = 14;
export const NAME_MAX = 60;
export const NOTE_MAX = 200;

/** "08:00" → "8:00 AM" (through formatTime, so it matches every other time in the app). */
export function clockText(hhmm: string | null | undefined): string {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return '';
  return formatTime(`2000-01-03T${hhmm.slice(0, 5)}`);
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

type RuleShape = Pick<Reminder, 'repeat' | 'weekdays' | 'dayOfMonth' | 'date' | 'dueBy'> & {
  headsUps: readonly Pick<ReminderHeadsUp, 'kind' | 'days' | 'time'>[];
};

/** "Every Friday", "Every weekday", "Monthly on the 31st (or the month's last day)", "Once, on Fri, Nov 20". */
export function repeatWords(r: Pick<Reminder, 'repeat' | 'weekdays' | 'dayOfMonth' | 'date'>): string {
  if (r.repeat === 'WEEKLY') {
    const days = WEEKDAYS.filter((d) => r.weekdays.includes(d.value));
    if (days.length === 7) return 'Every day';
    const set = days.map((d) => d.value).join(',');
    if (set === 'MON,TUE,WED,THU,FRI') return 'Every weekday';
    if (set === 'SAT,SUN') return 'Every weekend';
    if (!days.length) return 'No days chosen';
    return `Every ${formatList(days.map((d) => d.long))}`;
  }
  if (r.repeat === 'MONTHLY') {
    const n = r.dayOfMonth ?? 1;
    return `Monthly on the ${ordinal(n)}${n >= 29 ? " (or the month's last day)" : ''}`;
  }
  return `Once, on ${formatDate(r.date)}`;
}

const BEFORE_PART: Partial<Record<HeadsUpKind, string>> = {
  MORNING_BEFORE: 'morning',
  AFTERNOON_BEFORE: 'afternoon',
  EVENING_BEFORE: 'evening',
  NIGHT_BEFORE: 'night',
};

/**
 * The heads-ups in words, earliest first: "the afternoon and evening before",
 * "3 days before, the night before and the morning of", "at 6:30 AM on the day". Null for none.
 */
export function headsUpWords(headsUps: RuleShape['headsUps']): string | null {
  const parts: string[] = [];
  const days = headsUps.filter((h) => h.kind === 'DAYS_BEFORE').sort((a, b) => b.days - a.days);
  for (const h of days) parts.push(`${h.days} ${h.days === 1 ? 'day' : 'days'} before`);
  const before = HEADS_UP_ORDER.filter((k) => BEFORE_PART[k] && headsUps.some((h) => h.kind === k)).map((k) => BEFORE_PART[k] as string);
  if (before.length) parts.push(`the ${formatList(before)} before`);
  if (headsUps.some((h) => h.kind === 'MORNING_OF')) parts.push('the morning of');
  const atTimes = headsUps.filter((h) => h.kind === 'AT_TIME').sort((a, b) => a.time.localeCompare(b.time));
  if (atTimes.length) parts.push(`at ${formatList(atTimes.map((h) => clockText(h.time)))} on the day`);
  return parts.length ? formatList(parts) : null;
}

/** "Every Friday · heads-up the afternoon and evening before · done by 8:00 AM". */
export function ruleWords(r: RuleShape): string {
  const heads = headsUpWords(r.headsUps);
  return [
    repeatWords(r),
    heads ? `heads-up ${heads}` : 'shows on the day',
    r.dueBy ? `done by ${clockText(r.dueBy)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * When an occurrence is due, for a row: "Today, by 8:00 AM", "Today", "Tomorrow · Fri, Nov 13 ·
 * by 8:00 AM", "In 3 days · Mon, Nov 16".
 */
export function dueLine(date: string, dueBy: string | null | undefined, now: DateInput = new Date()): string {
  const days = daysBetween(homeToday(now), date) ?? 0;
  const by = dueBy ? clockText(dueBy) : '';
  if (days <= 0) return by ? `Today, by ${by}` : 'Today';
  const when = days === 1 ? `Tomorrow · ${formatDate(date, { now })}` : `In ${days} days · ${formatDate(date, { now })}`;
  return by ? `${when} · by ${by}` : when;
}

/** Due soonest first (the server already sends them so; kept for optimistic inserts). */
export function sortDue(list: readonly DueReminder[]): DueReminder[] {
  return [...list].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

// ─── The add / edit form ────────────────────────────────────────────────

export interface ReminderDraft {
  name: string;
  note: string;
  repeat: ReminderRepeat;
  weekdays: Weekday[];
  dayOfMonth: number;
  date: string;
  /** Off = by the end of the day. */
  hasDueBy: boolean;
  dueBy: string;
  /** The chosen heads-up kinds (presets and the two custom ones). */
  kinds: HeadsUpKind[];
  daysBefore: number;
  daysBeforeTime: string;
  atTime: string;
  alerts: boolean;
}

export type DraftErrors = Partial<Record<'name' | 'note' | 'weekdays' | 'date' | 'dueBy' | 'headsUps', string>>;

/** A new reminder's draft: weekly, nothing picked. */
export function emptyDraft(today: string = homeToday()): ReminderDraft {
  return {
    name: '',
    note: '',
    repeat: 'WEEKLY',
    weekdays: [],
    dayOfMonth: Number(today.slice(8, 10)) || 1,
    date: today,
    hasDueBy: false,
    dueBy: '08:00',
    kinds: ['EVENING_BEFORE'],
    daysBefore: 2,
    daysBeforeTime: '09:00',
    atTime: '07:00',
    alerts: true,
  };
}

export function draftFrom(r: Reminder, today: string = homeToday()): ReminderDraft {
  const base = emptyDraft(today);
  const days = r.headsUps.find((h) => h.kind === 'DAYS_BEFORE');
  const at = r.headsUps.find((h) => h.kind === 'AT_TIME');
  return {
    ...base,
    name: r.name,
    note: r.note ?? '',
    repeat: r.repeat,
    weekdays: [...r.weekdays],
    dayOfMonth: r.dayOfMonth ?? base.dayOfMonth,
    date: r.date ?? base.date,
    hasDueBy: r.dueBy != null,
    dueBy: r.dueBy ?? base.dueBy,
    kinds: HEADS_UP_ORDER.filter((k) => r.headsUps.some((h) => h.kind === k)),
    daysBefore: days?.days ?? base.daysBefore,
    daysBeforeTime: days?.time ?? base.daysBeforeTime,
    atTime: at?.time ?? base.atTime,
    alerts: r.alerts,
  };
}

/** What the draft asks for, in the API's shape. */
export function draftToInput(d: ReminderDraft): ReminderInput {
  const headsUps: HeadsUpInput[] = HEADS_UP_ORDER.filter((k) => d.kinds.includes(k)).map((kind) => {
    if (kind === 'DAYS_BEFORE') return { kind, days: d.daysBefore, time: d.daysBeforeTime };
    if (kind === 'AT_TIME') return { kind, time: d.atTime };
    return { kind };
  });
  return {
    name: d.name.trim(),
    note: d.note.trim() || null,
    repeat: d.repeat,
    weekdays: d.repeat === 'WEEKLY' ? WEEKDAYS.map((w) => w.value).filter((w) => d.weekdays.includes(w)) : undefined,
    dayOfMonth: d.repeat === 'MONTHLY' ? d.dayOfMonth : null,
    date: d.repeat === 'ONCE' ? d.date : null,
    dueBy: d.hasDueBy ? d.dueBy : null,
    headsUps,
    alerts: d.alerts,
  };
}

/** The same checks the server makes, so a mistake shows at its field before saving. */
export function validateDraft(
  d: ReminderDraft,
  opts: { today?: string; originalDate?: string | null; options?: readonly HeadsUpOption[] } = {},
): DraftErrors {
  const today = opts.today ?? homeToday();
  const e: DraftErrors = {};
  if (!d.name.trim()) e.name = 'Give the reminder a name.';
  else if (d.name.trim().length > NAME_MAX) e.name = `Keep the name to ${NAME_MAX} characters.`;
  if (d.note.trim().length > NOTE_MAX) e.note = `Keep the note to ${NOTE_MAX} characters.`;
  if (d.repeat === 'WEEKLY' && !d.weekdays.length) e.weekdays = 'Pick at least one day of the week.';
  if (d.repeat === 'ONCE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) e.date = 'Pick a date.';
    else if (d.date < today && d.date !== opts.originalDate) e.date = 'That date has already passed.';
  }
  if (d.hasDueBy && !/^\d{2}:\d{2}/.test(d.dueBy)) e.dueBy = 'Pick a time, or turn this off for the end of the day.';
  if (d.kinds.includes('DAYS_BEFORE') && (d.daysBefore < 1 || d.daysBefore > MAX_DAYS_BEFORE)) {
    e.headsUps = `Days before must be 1 to ${MAX_DAYS_BEFORE}.`;
  }
  if (d.hasDueBy && !e.dueBy) {
    const sameDay: { kind: HeadsUpKind; time: string }[] = [];
    if (d.kinds.includes('AT_TIME')) sameDay.push({ kind: 'AT_TIME', time: d.atTime });
    // Preset times come from the server (the one place they're set); unknown yet = the server checks.
    const morningOf = opts.options?.find((o) => o.kind === 'MORNING_OF')?.time;
    if (d.kinds.includes('MORNING_OF') && morningOf) sameDay.push({ kind: 'MORNING_OF', time: morningOf });
    const late = sameDay.find((h) => h.time.slice(0, 5) >= d.dueBy.slice(0, 5));
    if (late) e.headsUps = `The heads-up at ${clockText(late.time)} comes after the ${clockText(d.dueBy)} done-by time.`;
  }
  return e;
}

/** A preset's time from the server's options (e.g. AFTERNOON_BEFORE → "2:00 PM"), or ''. */
export function presetTime(options: readonly HeadsUpOption[] | undefined, kind: HeadsUpKind): string {
  const o = options?.find((x) => x.kind === kind);
  return o && !o.custom && o.time ? clockText(o.time) : '';
}

/** The owner's example, one tap from the empty page: trash goes out Friday by 8 AM. */
export const TRASH_STARTER: ReminderInput = {
  name: 'Trash day',
  note: 'Take the bins out tonight.',
  repeat: 'WEEKLY',
  weekdays: ['FRI'],
  dueBy: '08:00',
  headsUps: [{ kind: 'AFTERNOON_BEFORE' }, { kind: 'EVENING_BEFORE' }],
  alerts: true,
};
