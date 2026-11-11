import api from './client';

/*
 * Household reminders (/api/reminders): shared by every member, never shown to guests (the
 * server refuses them). Dates are "2026-11-13", times "HH:mm", moments "2026-11-12T14:00",
 * all on the home's clock.
 */

export type ReminderRepeat = 'WEEKLY' | 'MONTHLY' | 'ONCE';
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export type HeadsUpKind =
  | 'DAYS_BEFORE'
  | 'MORNING_BEFORE'
  | 'AFTERNOON_BEFORE'
  | 'EVENING_BEFORE'
  | 'NIGHT_BEFORE'
  | 'MORNING_OF'
  | 'AT_TIME';

/** A heads-up as saved: `days` before the due date (0 = on the day) at `time` (resolved for presets too). */
export interface ReminderHeadsUp {
  key: string;
  kind: HeadsUpKind;
  label: string;
  days: number;
  time: string;
}

/** One due date. `visible`: on Home right now (inside its window and not done). */
export interface ReminderOccurrence {
  date: string;
  showFrom: string;
  dueAt: string;
  visible: boolean;
  completed: boolean;
  completedBy: string | null;
  completedAt: string | null;
}

export interface Reminder {
  id: number;
  name: string;
  note: string | null;
  repeat: ReminderRepeat;
  weekdays: Weekday[];
  dayOfMonth: number | null;
  /** ONCE: the day. */
  date: string | null;
  /** Done by this time on the due day; null = end of the day. */
  dueBy: string | null;
  headsUps: ReminderHeadsUp[];
  /** Alerts (in the app and on phones) at each heads-up. */
  alerts: boolean;
  /** The due date being worked towards, done or not; null when a one-time reminder is over. */
  occurrence: ReminderOccurrence | null;
  /** When `occurrence` is done: the one after. */
  nextOccurrence: ReminderOccurrence | null;
  createdBy: string | null;
  updatedAt: string | null;
}

/** A reminder showing on Home now. */
export interface DueReminder {
  id: number;
  name: string;
  note: string | null;
  date: string;
  dueBy: string | null;
  showFrom: string;
  dueAt: string;
}

/** A heads-up choice for the form; presets carry their day and time, `custom` ones take the member's. */
export interface HeadsUpOption {
  kind: HeadsUpKind;
  label: string;
  daysBefore: number | null;
  time: string | null;
  custom: boolean;
}

export interface HeadsUpInput {
  kind: HeadsUpKind;
  days?: number;
  time?: string;
}

export interface ReminderInput {
  name: string;
  note?: string | null;
  repeat: ReminderRepeat;
  weekdays?: Weekday[];
  dayOfMonth?: number | null;
  date?: string | null;
  dueBy?: string | null;
  headsUps: HeadsUpInput[];
  alerts?: boolean;
}

export const REMINDERS_KEY = ['reminders'];
export const DUE_REMINDERS_KEY = ['reminders', 'due'];
export const HEADS_UP_OPTIONS_KEY = ['reminders', 'heads-ups'];

const list = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

export async function fetchReminders(): Promise<Reminder[]> {
  const res = await api.get('/reminders');
  return list<Reminder>(res.data);
}

export async function fetchDueReminders(): Promise<DueReminder[]> {
  const res = await api.get('/reminders/due');
  return list<DueReminder>(res.data);
}

export async function fetchHeadsUpOptions(): Promise<HeadsUpOption[]> {
  const res = await api.get('/reminders/heads-ups');
  return list<HeadsUpOption>(res.data);
}

export async function createReminder(input: ReminderInput): Promise<Reminder> {
  const res = await api.post<Reminder>('/reminders', input);
  return res.data;
}

export async function updateReminder(id: number, input: ReminderInput): Promise<Reminder> {
  const res = await api.put<Reminder>(`/reminders/${id}`, input);
  return res.data;
}

export async function setReminderAlerts(id: number, alerts: boolean): Promise<Reminder> {
  const res = await api.put<Reminder>(`/reminders/${id}/alerts`, { alerts });
  return res.data;
}

export async function deleteReminder(id: number): Promise<void> {
  await api.delete(`/reminders/${id}`);
}

/** Marks the occurrence due on `date` done for the household. */
export async function completeReminder(id: number, date: string): Promise<Reminder> {
  const res = await api.post<Reminder>(`/reminders/${id}/complete`, { date });
  return res.data;
}

export async function undoReminder(id: number, date: string): Promise<Reminder> {
  const res = await api.post<Reminder>(`/reminders/${id}/undo`, { date });
  return res.data;
}
