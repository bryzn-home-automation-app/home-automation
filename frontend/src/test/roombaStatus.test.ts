import { describe, expect, it } from 'vitest';
import {
  commandLabel, commandState, cycleLabel, nextScheduledClean, padLabel, partsSummary, roombaState, roombaVerdict,
  runStatus, scheduleDays, scheduleLine,
} from '../utils/roombaStatus';
import { labelPoint, isFromControl } from '../components/RoombaMap';
import { cleanScopeSummary } from '../components/CleanModal';
import { endedLabel } from '../components/RoomRunDetailModal';
import { lastCommandLine } from '../components/RoombaControls';

const NBSP = '\u00a0';
const norm = (s: string) => s.split(NBSP).join(' ');

// Mon Nov 9 2026, 10:42 AM at home (America/Chicago, CST = UTC−6).
const NOW = new Date('2026-11-09T16:42:10Z');

const base = {
  phase: 'charge',
  cycle: 'none',
  error: 0,
  errorText: null,
  running: false,
  dockError: 0,
  dockText: 'Ready',
  online: true,
  updatedAt: '2026-11-09T16:42:00Z',
  name: 'Rosie',
};

describe('roombaState', () => {
  it('says the bin is emptying, not cleaning, though the backend counts evac as running (B-140)', () => {
    const s = roombaState({ ...base, phase: 'evac', cycle: 'clean', running: true }, NOW);
    expect(s.label).toBe('Emptying the bin');
    expect(s.cleaning).toBe(false);
    expect(s.inMission).toBe(true);
  });

  it('never calls a stale reading live (B-070, B-138)', () => {
    const s = roombaState({ ...base, phase: 'run', cycle: 'clean', running: true, online: false, updatedAt: '2026-11-09T13:30:00Z' }, NOW);
    expect(s.label).toBe('Offline');
    expect(s.cleaning).toBe(false);
    expect(s.inMission).toBe(false);
    expect(s.lastSeen).toBe('Last seen cleaning, 3 hr ago');
  });

  it('keeps a mid-clean recharge in the mission (B-130)', () => {
    const s = roombaState({ ...base, phase: 'charge', cycle: 'clean' }, NOW);
    expect(s.label).toBe('Recharging to finish');
    expect(s.inMission).toBe(true);
    expect(s.cleaning).toBe(false);
  });

  it('counts every leg of a clean as a mission, so the controls lead with Pause (evac, heading back, recharging)', () => {
    const legs = [
      { phase: 'evac', cycle: 'clean', running: true },
      { phase: 'evac', cycle: 'quick', running: true },
      { phase: 'hmMidMsn', cycle: 'clean', running: false },
      { phase: 'charge', cycle: 'clean', running: false },
      { phase: 'run', cycle: 'spot', running: true },
    ];
    for (const leg of legs) {
      const s = roombaState({ ...base, ...leg }, NOW);
      expect(s, leg.phase).toMatchObject({ inMission: true, paused: false });
    }
  });

  it("doesn't call a stand-alone bin empty or an idle dock a mission", () => {
    expect(roombaState({ ...base, phase: 'evac', cycle: 'evac', running: true }, NOW).inMission).toBe(false);
    expect(roombaState({ ...base, phase: 'evac', cycle: 'none', running: true }, NOW).inMission).toBe(false);
    expect(roombaState({ ...base, phase: 'hmPostMsn', cycle: 'none' }, NOW).inMission).toBe(false);
    expect(roombaState({ ...base, phase: 'stop', cycle: 'none' }, NOW)).toMatchObject({ inMission: false, paused: false });
  });

  it('cleans, pauses and docks', () => {
    expect(roombaState({ ...base, phase: 'run', cycle: 'clean', running: true }, NOW)).toMatchObject({ label: 'Cleaning', cleaning: true, inMission: true });
    expect(roombaState({ ...base, phase: 'stop', cycle: 'clean' }, NOW)).toMatchObject({ label: 'Paused', paused: true, inMission: true });
    expect(roombaState(base, NOW)).toMatchObject({ label: 'Docked', tone: 'ok', inMission: false });
    expect(roombaState(null, NOW).label).toBe('No status yet');
  });
});

describe('roombaVerdict', () => {
  it('leads with an overdue part when the robot is docked', () => {
    const v = roombaVerdict({ status: base, parts: [{ label: 'Dock bag', status: 'overdue' }, { label: 'Filter', status: 'ok' }], now: NOW });
    expect(v.tone).toBe('headsup');
    expect(v.sentence).toBe('Rosie is ready, but a part needs replacing.');
    expect(v.note).toBe('The dock bag is overdue.');
    expect(v.aboutParts).toBe(true);
  });

  it('reports cleaning with the area and time so far', () => {
    const v = roombaVerdict({ status: { ...base, phase: 'run', cycle: 'clean', running: true, sqft: 268, runtimeMinutes: 47 }, now: NOW });
    expect(v.sentence).toBe('Rosie is cleaning.');
    expect(norm(v.note ?? '')).toBe('268 sq ft, 47 min in.');
  });

  it('says when the robot stopped checking in', () => {
    const v = roombaVerdict({ status: { ...base, online: false, running: true, phase: 'run', updatedAt: '2026-11-09T13:30:00Z' }, now: NOW });
    expect(v.tone).toBe('headsup');
    expect(norm(v.sentence)).toBe("Rosie hasn't checked in since 7:30 AM.");
    expect(v.note).toMatch(/^It was cleaning then\./);
  });

  it('puts an error first and is calm when all is well', () => {
    expect(roombaVerdict({ status: { ...base, error: 17, errorText: 'Stuck on a cable' }, now: NOW }).sentence).toBe('Rosie needs help: stuck on a cable.');
    const ok = roombaVerdict({ status: { ...base, batteryPct: 100 }, parts: [], now: NOW });
    expect(ok).toMatchObject({ tone: 'ok', sentence: 'Rosie is docked and ready.', note: 'Battery at 100%.' });
    expect(roombaVerdict({ status: null }).tone).toBe('neutral');
  });
});

describe('partsSummary', () => {
  it('lists overdue and due-soon parts by name', () => {
    expect(partsSummary([{ label: 'Filter', status: 'due_soon' }, { label: 'Dock bag', status: 'overdue' }])).toEqual({ overdue: ['Dock bag'], dueSoon: ['Filter'], tone: 'headsup' });
    expect(partsSummary(undefined).tone).toBe('ok');
  });
});

describe('robot words', () => {
  it('maps run outcomes, cycles, pads and commands to words (B-120, B-126)', () => {
    expect(runStatus('COMPLETED')).toEqual({ tone: 'ok', label: 'Finished' });
    expect(runStatus('STUCK').tone).toBe('problem');
    expect(runStatus('CANCELLED').label).toBe('Stopped early');
    expect(cycleLabel('clean')).toBe('Cleaning run');
    expect(padLabel('padPlate')).toBe('Pad plate only (no pad)');
    expect(padLabel('someNewPad')).toBe('Some new pad');
    expect(commandLabel('clean_rooms')).toBe('Clean rooms');
    expect(commandLabel('dock')).toBe('Send home');
    expect(commandState('PENDING').label).toBe('Queued');
    // OK is "accepted by broker": it reached the robot, which isn't proof it acted.
    expect(commandState('OK').label).toBe('Sent to the robot');
    expect(commandState('FAILED')).toEqual({ tone: 'problem', label: 'Failed' });
  });

  it('writes the last command with its state and when', () => {
    const line = lastCommandLine({ command: 'clean_rooms', status: 'OK', createdAt: '2026-11-09T16:39:00Z', processedAt: '2026-11-09T16:40:10Z' }, NOW);
    expect(line).toBe('Clean rooms · sent to the robot 2 min ago');
    const failed = lastCommandLine({ command: 'pause', status: 'FAILED', detail: 'robot unreachable', createdAt: '2026-11-09T16:39:00Z', processedAt: '2026-11-09T16:40:10Z' }, NOW);
    expect(failed).toBe('Pause · failed 2 min ago: robot unreachable');
  });
});

describe('schedules', () => {
  it('names the days plainly', () => {
    expect(scheduleDays([1, 2, 3, 4, 5])).toBe('Mon – Fri');
    expect(scheduleDays([7])).toBe('Sundays');
    expect(scheduleDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(scheduleDays([6, 7])).toBe('Weekends');
    expect(scheduleDays([1, 3, 5])).toBe('Mon, Wed and Fri');
  });

  it('writes a whole schedule in one line', () => {
    expect(norm(scheduleLine({ days: [1, 2, 3, 4, 5], hour: 9, minute: 0, operatingModes: [2], roomCount: 3 }))).toBe('Mon – Fri · 9:00 AM · vacuum · 3 rooms');
    expect(norm(scheduleLine({ days: [7], hour: 10, minute: 5, operatingModes: [2, 4], roomCount: 0 }))).toBe('Sundays · 10:05 AM · vacuum, then mop · every room');
  });

  it('finds the next enabled clean in the home time zone', () => {
    const schedules = [
      { name: 'Weekday tidy', days: [1, 2, 3, 4, 5], hour: 9, minute: 0, enabled: true },
      { name: 'Kitchen after dinner', days: [1, 2, 3, 4, 5, 6, 7], hour: 19, minute: 30, enabled: false },
      { name: 'Sunday deep clean', days: [7], hour: 10, minute: 5, enabled: true },
    ];
    // Monday 10:42 AM: today's 9:00 has passed, so Tuesday 9:00.
    expect(nextScheduledClean(schedules, NOW)).toEqual({ at: '2026-11-10T09:00', name: 'Weekday tidy' });
    // Monday 8:00 AM: still today.
    expect(nextScheduledClean(schedules, new Date('2026-11-09T14:00:00Z'))?.at).toBe('2026-11-09T09:00');
    // Saturday: Sunday's clean comes first.
    expect(nextScheduledClean(schedules, new Date('2026-11-14T18:00:00Z'))).toEqual({ at: '2026-11-15T10:05', name: 'Sunday deep clean' });
    expect(nextScheduledClean([], NOW)).toBeNull();
  });
});

describe('map helpers', () => {
  it('puts a label inside an L-shaped room, and at the true centre of a closed rectangle (B-122)', () => {
    const rect: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]];
    expect(labelPoint(rect)).toEqual([2, 1.5]);
    // An L: a long bar along the bottom and a tall bar up the left side.
    const ell: [number, number][] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10], [0, 0]];
    const [x, y] = labelPoint(ell);
    const inside = (y >= 0 && y <= 2 && x >= 0 && x <= 10) || (x >= 0 && x <= 2 && y >= 0 && y <= 10);
    expect(inside).toBe(true);
  });

  it('leaves Enter on a focused control alone while dividing (B-124)', () => {
    const button = document.createElement('button');
    const span = document.createElement('span');
    button.appendChild(span);
    expect(isFromControl(span)).toBe(true);
    expect(isFromControl(document.body)).toBe(false);
    expect(isFromControl(null)).toBe(false);
  });
});

describe('clean dialog and run details', () => {
  it('says the scope as a whole sentence (B-137)', () => {
    expect(norm(cleanScopeSummary('all', 6, 6))).toBe('Cleaning the whole house · 6 rooms.');
    expect(cleanScopeSummary('all', 0, 0)).toBe('Cleaning the whole house.');
    expect(cleanScopeSummary('select', 6, 0)).toBe('Pick at least one room.');
    expect(norm(cleanScopeSummary('select', 6, 2))).toBe('2 rooms picked.');
  });

  it('names the day a run ended when it went past midnight (B-134)', () => {
    expect(norm(endedLabel('2026-10-27T00:40:00Z', '2026-10-27T03:15:00Z'))).toBe('10:15 PM');
    expect(norm(endedLabel('2026-10-27T00:40:00Z', '2026-10-27T11:32:00Z'))).toMatch(/^Tue, Oct 27.*6:32 AM$/);
  });
});
