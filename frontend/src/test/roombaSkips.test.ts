import { describe, it, expect } from 'vitest';
import type { RoombaNativeSchedule, RoombaScheduleSkip } from '../types';
import { cleanName, cleanWhen, skipPicture, skippableClean, skipStatusLine } from '../utils/roombaSkips';
import { nextScheduledClean } from '../utils/roombaStatus';

// The owner's two schedules: Mon + Fri (vacuum and mop) and Tue – Thu (vacuum), both 9:00 AM.
// Nov 16 2026 is a Monday; 9:00 AM at home is 15:00 UTC.
const sched = (id: string, days: number[], enabled = true): RoombaNativeSchedule => ({
  householdScheduleId: id, name: 'Regular Schedule', frequency: 'WEEKLY', days, hour: 9, minute: 0, enabled,
  roomCount: 6, operatingModes: [2], updatedAt: '2026-10-08T14:30:45Z',
});
const MON_FRI = sched('hh_MONFRI', [1, 5]);
const TUE_THU = sched('hh_TUETHU', [2, 3, 4]);
const SCHEDULES = [MON_FRI, TUE_THU];

const skip = (over: Partial<RoombaScheduleSkip>): RoombaScheduleSkip => ({
  id: 1, householdScheduleId: 'hh_TUETHU', scheduleId: 'hh_TUETHU', date: '2026-11-17', hour: 9, minute: 0,
  scheduledFor: '2026-11-17T15:00:00Z', restoreAfter: '2026-11-17T15:30:00Z', state: 'PENDING', detail: null,
  lastError: null, undoRequested: false, requestedBy: 'user:1', createdAt: '2026-11-16T14:00:00Z', appliedAt: null,
  finishedAt: null, ...over,
});

/** Times join their AM/PM with a no-break space. */
const sp = (text: string) => text.replace(/ /g, ' ');

const MON_8AM = new Date('2026-11-16T14:00:00Z');
const MON_8PM = new Date('2026-11-17T02:00:00Z');

describe('skippable cleans', () => {
  it("offers today's clean while it's still ahead, and tomorrow's", () => {
    expect(skippableClean(SCHEDULES, [], 0, MON_8AM)).toMatchObject({ householdScheduleId: 'hh_MONFRI', date: '2026-11-16', hour: 9 });
    expect(skippableClean(SCHEDULES, [], 1, MON_8AM)).toMatchObject({ householdScheduleId: 'hh_TUETHU', date: '2026-11-17' });
    expect(skippableClean(SCHEDULES, [], 0, MON_8PM)).toBeNull();
  });

  it('not within two minutes of the start, which the server would refuse', () => {
    expect(skippableClean(SCHEDULES, [], 0, new Date('2026-11-16T14:57:00Z'))).not.toBeNull();
    expect(skippableClean(SCHEDULES, [], 0, new Date('2026-11-16T14:58:00Z'))).toBeNull();
  });

  it('not one already skipped, but again once that skip is undone', () => {
    expect(skippableClean(SCHEDULES, [skip({})], 1, MON_8PM)).toBeNull();
    expect(skippableClean(SCHEDULES, [skip({ undoRequested: true })], 1, MON_8PM)).not.toBeNull();
  });

  it('a schedule switched off by its own skip still has its other days to offer', () => {
    // Tuesday's skip has switched Tue – Thu off in the iRobot app; Wednesday's clean is still on.
    const off = [MON_FRI, sched('hh_TUETHU', [2, 3, 4], false)];
    const tue = skip({ state: 'APPLIED', appliedAt: '2026-11-16T14:00:00Z' });
    expect(skippableClean(off, [tue], 1, new Date('2026-11-17T16:00:00Z'))).toMatchObject({ date: '2026-11-18' });
    expect(skippableClean(off, [], 1, new Date('2026-11-17T16:00:00Z'))).toBeNull();
  });

  it('Sunday counts as 7 or 0', () => {
    const sat = new Date('2026-11-14T14:00:00Z');
    expect(skippableClean([sched('a', [7])], [], 1, sat)).toMatchObject({ date: '2026-11-15' });
    expect(skippableClean([sched('a', [0])], [], 1, sat)).toMatchObject({ date: '2026-11-15' });
  });
});

describe('next clean, with skips', () => {
  it('passes over a skipped clean', () => {
    expect(nextScheduledClean(SCHEDULES, MON_8PM)?.at).toBe('2026-11-17T09:00');
    expect(nextScheduledClean(SCHEDULES, MON_8PM, [skip({})])?.at).toBe('2026-11-18T09:00');
  });

  it("counts a schedule that is off only for a skip, and not one the owner switched off", () => {
    const off = [sched('hh_MONFRI', [1, 5], false), sched('hh_TUETHU', [2, 3, 4], false)];
    expect(nextScheduledClean(off, MON_8PM, [skip({ state: 'APPLIED' })])?.at).toBe('2026-11-18T09:00');
    expect(nextScheduledClean(off, MON_8PM, [])).toBeNull();
  });

  it('an undone skip runs after all', () => {
    expect(nextScheduledClean(SCHEDULES, MON_8PM, [skip({ undoRequested: true, state: 'APPLIED' })])?.at).toBe('2026-11-17T09:00');
  });

  it('a weekly clean that is skipped is next a week on', () => {
    const fri = new Date('2026-11-20T02:00:00Z'); // Thu evening
    const weekly = [sched('hh_FRI', [5])];
    const skipped = skip({ householdScheduleId: 'hh_FRI', date: '2026-11-20', scheduledFor: '2026-11-20T15:00:00Z' });
    expect(nextScheduledClean(weekly, fri, [skipped])?.at).toBe('2026-11-27T09:00');
  });
});

describe('words', () => {
  it('names a clean by its day', () => {
    expect(sp(cleanName('2026-11-16', 9, 0, MON_8AM))).toBe("Today's 9:00 AM clean");
    expect(sp(cleanName('2026-11-17', 9, 0, MON_8AM))).toBe("Tomorrow's 9:00 AM clean");
    expect(sp(cleanName('2026-11-19', 9, 0, MON_8AM))).toBe("Thursday's 9:00 AM clean");
  });

  it('says when the next clean is', () => {
    expect(sp(cleanWhen('2026-11-16T15:00', MON_8AM))).toBe('today at 3:00 PM');
    expect(sp(cleanWhen('2026-11-17T09:00', MON_8AM))).toBe('tomorrow at 9:00 AM');
    expect(sp(cleanWhen('2026-11-20T09:00', MON_8AM))).toBe('Friday at 9:00 AM');
    expect(sp(cleanWhen('2026-11-23T09:00', MON_8AM))).toBe('Mon, Nov 23 at 9:00 AM');
  });

  it('explains why the iRobot app shows the schedule off, and a retry', () => {
    expect(sp(skipStatusLine(skip({ state: 'APPLIED' }), MON_8PM, 'Tue – Thu'))).toBe('The Tue – Thu schedule is off in the iRobot app until tomorrow at 9:30 AM.');
    expect(sp(skipStatusLine(skip({}), new Date('2026-11-17T13:00:00Z')))).toBe('Its schedule will be off in the iRobot app until 9:30 AM.');
    expect(sp(skipStatusLine(skip({ lastError: 'OSError' }), MON_8PM))).toMatch(/keeps trying/);
  });
});

describe('what the page shows', () => {
  it('skipped cleans still ahead, soonest first; not undone ones, not past ones', () => {
    const wed = skip({ id: 2, date: '2026-11-18', scheduledFor: '2026-11-18T15:00:00Z' });
    const tue = skip({ id: 1 });
    const undone = skip({ id: 3, undoRequested: true });
    const past = skip({ id: 4, date: '2026-11-16', scheduledFor: '2026-11-16T15:00:00Z', state: 'APPLIED' });
    expect(skipPicture([wed, tue, undone, past], MON_8PM).skipped.map((s) => s.id)).toEqual([1, 2]);
  });

  it('a failure for 12 hours after its clean; a skip dropped before its clean, not an undo', () => {
    const failed = skip({ state: 'FAILED', detail: 'The schedule couldn’t be switched off…', date: '2026-11-16', scheduledFor: '2026-11-16T15:00:00Z' });
    expect(skipPicture([failed], MON_8PM).failed?.id).toBe(1);
    expect(skipPicture([failed], new Date('2026-11-17T04:00:00Z')).failed).toBeNull();
    const changed = skip({ state: 'CANCELLED', detail: 'changed in the iRobot app', finishedAt: '2026-11-17T01:00:00Z' });
    expect(skipPicture([changed], MON_8PM).dropped?.id).toBe(1);
    expect(skipPicture([{ ...changed, undoRequested: true }], MON_8PM).dropped).toBeNull();
    const done = skip({ state: 'RESTORED', finishedAt: '2026-11-17T15:30:00Z' });
    expect(skipPicture([done], MON_8PM).dropped).toBeNull();
  });
});
