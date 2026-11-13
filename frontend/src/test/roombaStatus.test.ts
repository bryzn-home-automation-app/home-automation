import { describe, expect, it } from 'vitest';
import {
  commandLabel, commandState, cycleLabel, dockIssueWords, dockLamp, lastSeen, lastSeenWords, nextScheduledClean, padLabel,
  partsSummary, roomAt, roombaState, roombaVerdict, runStatus, scheduleDays, scheduleLine,
} from '../utils/roombaStatus';
import type { RoombaMapGeoJson } from '../types';
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

describe('the dock', () => {
  // Nov 13 2026 on the NUC: docked, battery full, dock.state 301 ("Ready"), dock.error 0, and the
  // pad-wash state 671: the clean-water tank. The 9:00 AM vacuum-and-mop clean never started.
  const nov13 = {
    ...base,
    name: 'iRummy',
    batteryPct: 100,
    needsAttention: true,
    attentionReasons: ["The dock's clean-water tank is empty", 'picea unknown fault code:717', 'Maintenance overdue: Routine clean-up'],
    dockIssue: { kind: 'clean_water_empty', code: 671, since: '2026-11-13T15:01:00Z' },
  };
  const parts = [{ label: 'Routine clean-up', status: 'overdue' }];

  it('says the clean-water tank is empty and what to do, not "ready" (Nov 13)', () => {
    const v = roombaVerdict({ status: nov13, parts, now: NOW });
    expect(v).toMatchObject({
      tone: 'headsup',
      sentence: "The dock's clean-water tank is empty.",
      note: "Refill it and iRummy can mop again. If it's full, push it in firmly; a loose tank reads as empty.",
      code: 'Dock code 671',
      aboutParts: false,
    });
    expect(dockLamp({ ...nov13, dockState: 301 })).toEqual({ tone: 'headsup', label: 'Dock: clean water empty' });
  });

  it('tells the dirty-water tank apart from the clean one', () => {
    const v = roombaVerdict({ status: { ...nov13, dockIssue: { kind: 'dirty_water_full', code: 672, since: null } }, now: NOW });
    expect(v.sentence).toBe("The dock's dirty-water tank is full.");
    expect(v.note).toBe("Empty it and iRummy can mop again. If it's empty, push it in firmly; a loose tank reads as full.");
    expect(dockIssueWords({ kind: 'dirty_water_full', code: 654, since: null }, 'iRummy')?.note).toBe('Empty it and iRummy can mop again.');
    expect(dockIssueWords({ kind: 'dirty_water_out', code: 653, since: null }, 'iRummy')).toMatchObject({
      sentence: "The dock's dirty-water tank is out.", short: 'Dock: dirty tank out',
    });
    expect(dockIssueWords({ kind: 'clean_water_out', code: 650, since: null }, null)?.note).toBe('Fill it and put it back, and the Roomba can mop again.');
  });

  it('turns a code nobody decoded into "needs attention" with the code, never "ready"', () => {
    const v = roombaVerdict({ status: { ...nov13, dockIssue: { kind: 'other', code: 717, since: null } }, now: NOW });
    expect(v).toMatchObject({ tone: 'headsup', sentence: 'The dock needs attention.', code: 'Dock code 717' });
    expect(v.note).toMatch(/can't read yet/);
    // A kind from a newer poller reads the same way.
    expect(dockIssueWords({ kind: 'grey_water_sensor', code: 652, since: null }, 'iRummy')?.sentence).toBe('The dock needs attention.');
    expect(dockLamp({ ...nov13, dockState: 301, dockIssue: { kind: 'other', code: 717, since: null } })).toEqual({ tone: 'headsup', label: 'Dock code 717' });
  });

  it('the bag and the mop', () => {
    expect(dockIssueWords({ kind: 'bag', code: 353, since: null }, 'iRummy')).toMatchObject({
      sentence: 'The dock needs a new bag.', note: "Fit one so the dock can empty iRummy's bin again.",
    });
    expect(dockIssueWords({ kind: 'mop', code: 668, since: null }, 'iRummy')?.sentence).toBe("iRummy's mop isn't attached.");
    expect(dockIssueWords({ kind: 'mop', code: 756, since: null }, null)?.sentence).toBe("The Roomba's mop isn't attached.");
  });

  it('still puts an error and a robot away from the dock first', () => {
    expect(roombaVerdict({ status: { ...nov13, error: 17, errorText: 'Stuck on a cable' }, now: NOW }).sentence).toBe('iRummy needs help: stuck on a cable.');
    expect(roombaVerdict({ status: { ...nov13, phase: 'run', cycle: 'clean', running: true }, now: NOW }).sentence).toBe('iRummy is cleaning.');
  });

  it('a quiet dock is OK; nothing known, no lamp', () => {
    expect(dockLamp({ dockState: 301, dockError: 0, name: 'iRummy', dockIssue: null })).toEqual({ tone: 'ok', label: 'Dock OK' });
    expect(dockLamp({ dockState: 301, dockError: 46, name: 'iRummy' })).toEqual({ tone: 'headsup', label: 'Dock needs a look' });
    expect(dockLamp({ dockState: null, dockError: null, name: null })).toBeNull();
    expect(roombaVerdict({ status: { ...base, batteryPct: 100, dockIssue: null }, parts: [], now: NOW }).sentence).toBe('Rosie is docked and ready.');
  });
});

describe('lastSeen', () => {
  // Nov 12 2026: the robot paused in the living room at 11:00:34 AM, its mission ran out at
  // 12:30 PM and it never docked. The stored state then: phase "stop", cycle "none", 11%.
  const rect = (x0: number, y0: number, x1: number, y1: number) => ({
    type: 'Polygon' as const,
    coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
  });
  const geojson = {
    rooms: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 10, properties: { name: 'Living Room' }, geometry: rect(-7.6, 2.6, -1.25, 8.4) },
        { type: 'Feature', id: 12, properties: { name: 'Kitchen' }, geometry: rect(-7.6, -0.3, -1.8, 2.6) },
        { type: 'Feature', id: 15, properties: { name: 'Office' }, geometry: { type: 'MultiPolygon', coordinates: [rect(0.05, 4.9, 3.7, 8.4).coordinates] } },
      ],
    },
    dockPose: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1.0926, 5.7441] } }] },
  } as RoombaMapGeoJson;
  const stopped = { phase: 'stop', cycle: 'none', missionStart: null };
  const nov12 = { x: -5.550261, y: 4.627603, updatedAt: '2026-11-12T17:00:34.314398Z' };
  const at = (iso: string) => new Date(iso);
  // 1:30 PM at home.
  const NOV12 = at('2026-11-12T19:30:00Z');

  it("shows the Nov 12 stop in the living room, with its time", () => {
    const s = lastSeen({ status: stopped, position: nov12, geojson, now: NOV12 });
    expect(s).toMatchObject({ x: -5.550261, y: 4.627603, room: 'Living Room', at: nov12.updatedAt });
    expect(norm(s?.words ?? '')).toBe('Last seen in Living Room at 11:00 AM');
    expect(norm(s?.short ?? '')).toBe('Last seen 11:00 AM');
  });

  it('hides it once the robot is on its dock, however it got there', () => {
    // Back on the dock (it docked, or someone carried it there): charging, the bin emptying,
    // recharging partway through a clean.
    for (const status of [
      { phase: 'charge', cycle: 'none', missionStart: null },
      { phase: 'evac', cycle: 'clean', missionStart: null },
      { phase: 'charge', cycle: 'clean', missionStart: '2026-11-12T15:00:15Z' },
    ]) {
      expect(lastSeen({ status, position: nov12, geojson, now: NOV12 }), status.phase).toBeNull();
    }
  });

  it("doesn't draw a marker on the dock itself", () => {
    const byTheDock = { ...nov12, x: 1.4, y: 5.5 };
    expect(lastSeen({ status: stopped, position: byTheDock, geojson, now: NOV12 })).toBeNull();
    const aMetreOff = { ...nov12, x: 1.0926, y: 4.7 };
    expect(lastSeen({ status: stopped, position: aMetreOff, geojson, now: NOV12 })).not.toBeNull();
  });

  it('leaves a moving robot to the live dot, until its position stops changing', () => {
    const cleaning = { phase: 'run', cycle: 'clean', missionStart: '2026-11-12T15:00:15Z' };
    const recent = { ...nov12, updatedAt: '2026-11-12T19:29:30Z' };
    expect(lastSeen({ status: cleaning, position: recent, geojson, now: NOV12 })).toBeNull();
    expect(lastSeen({ status: { ...cleaning, phase: 'hmPostMsn' }, position: recent, geojson, now: NOV12 })).toBeNull();
    // "Cleaning" for two hours without a new position: it died mid-clean and its cloud state froze.
    expect(lastSeen({ status: cleaning, position: nov12, geojson, now: NOV12 })?.room).toBe('Living Room');
    expect(lastSeen({ status: { ...cleaning, phase: 'hmPostMsn' }, position: nov12, geojson, now: NOV12 })).not.toBeNull();
  });

  it('shows a stuck or paused robot at once', () => {
    const justNow = { ...nov12, updatedAt: '2026-11-12T19:29:55Z' };
    const stuck = { ...stopped, phase: 'stuck', cycle: 'clean' };
    const paused = { ...stopped, cycle: 'clean', missionStart: '2026-11-12T15:00:15Z' };
    expect(lastSeen({ status: stuck, position: justNow, geojson, now: NOV12 })).not.toBeNull();
    expect(lastSeen({ status: paused, position: justNow, geojson, now: NOV12 })).not.toBeNull();
  });

  it("ignores a position from before this clean began: the robot has left the dock since", () => {
    const newClean = { phase: 'stuck', cycle: 'clean', missionStart: '2026-11-13T15:00:00Z' };
    expect(lastSeen({ status: newClean, position: nov12, geojson, now: at('2026-11-13T15:02:00Z') })).toBeNull();
  });

  it('leaves the room out when the spot is in none, and needs a status and a fix', () => {
    const hall = { ...nov12, x: -0.5, y: 4.0 };
    expect(norm(lastSeen({ status: stopped, position: hall, geojson, now: NOV12 })?.words ?? '')).toBe('Last seen at 11:00 AM');
    expect(lastSeen({ status: stopped, position: nov12, geojson: null, now: NOV12 })?.room).toBeNull();
    expect(lastSeen({ status: null, position: nov12, geojson, now: NOV12 })).toBeNull();
    expect(lastSeen({ status: stopped, position: null, geojson, now: NOV12 })).toBeNull();
    expect(lastSeen({ status: stopped, position: { ...nov12, x: Number.NaN }, geojson, now: NOV12 })).toBeNull();
  });

  it('says the day when it was not today', () => {
    expect(norm(lastSeenWords('Living Room', nov12.updatedAt, at('2026-11-13T14:00:00Z')))).toBe('Last seen in Living Room yesterday at 11:00 AM');
    expect(norm(lastSeenWords(null, nov12.updatedAt, at('2026-11-16T14:00:00Z')))).toBe('Last seen on Thu, Nov 12 at 11:00 AM');
    const s = lastSeen({ status: stopped, position: nov12, geojson, now: at('2026-11-13T14:00:00Z') });
    expect(norm(s?.short ?? '')).toBe('Last seen yesterday, 11:00 AM');
  });

  it('finds the room in a multi-part room too', () => {
    expect(roomAt(geojson, 2, 6)).toBe('Office');
    expect(roomAt(geojson, -3, 1)).toBe('Kitchen');
    expect(roomAt(geojson, 20, 20)).toBeNull();
    expect(roomAt(undefined, 0, 0)).toBeNull();
  });

  it('puts it in the verdict, and never says "docked" with it', () => {
    const words = { words: 'Last seen in Living Room at 11:00 AM' };
    const status = { ...base, phase: 'stop', cycle: 'none', batteryPct: 11 };
    const v = roombaVerdict({ status, lastSeen: words, now: NOV12 });
    expect(v).toMatchObject({ tone: 'headsup', sentence: 'Rosie is stopped away from the dock.', note: 'Last seen in Living Room at 11:00 AM.' });
    // Without a marker (none stored, or on the dock) the old words stand.
    expect(roombaVerdict({ status: base, now: NOV12 }).sentence).toBe('Rosie is docked and ready.');
    const err = roombaVerdict({ status: { ...status, error: 17, errorText: 'Stuck on a cable' }, lastSeen: words, now: NOV12 });
    expect(err.note).toBe('Last seen in Living Room at 11:00 AM. Sort it out at the robot, then start the clean again.');
    const paused = roombaVerdict({ status: { ...status, cycle: 'clean' }, lastSeen: words, now: NOV12 });
    expect(paused).toMatchObject({ sentence: 'Rosie is paused partway through a clean.', note: 'Last seen in Living Room at 11:00 AM. Resume it, or send it home to the dock.' });
    expect(roombaVerdict({ status: { ...status, phase: 'stuck' }, lastSeen: words, now: NOV12 })).toMatchObject({ tone: 'problem', sentence: 'Rosie is stuck.' });
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
