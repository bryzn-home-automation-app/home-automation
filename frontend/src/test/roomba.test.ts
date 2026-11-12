import { describe, expect, it } from 'vitest';
import { cleaningMinutes, isRecharging, minuteTicks, roomsSummary, runTimeSummary } from '../utils/roomba';
import type { RoombaRun } from '../types';

describe('cleaningMinutes', () => {
  it('takes the recharge stops out of a confirmed run', () => {
    expect(cleaningMinutes({ durationMinutes: 653, chargeMinutes: 390, verified: true })).toBe(263);
  });

  it('takes the pauses out too', () => {
    // Nov 6: 419 min start to finish = 186 cleaning + 203 recharging + 30 paused.
    expect(cleaningMinutes({ durationMinutes: 419, chargeMinutes: 203, pauseMinutes: 30, verified: true })).toBe(186);
    expect(cleaningMinutes({ durationMinutes: 169, chargeMinutes: 0, pauseMinutes: 55, verified: true })).toBe(114);
  });

  it('is the whole duration when there was no recharge', () => {
    expect(cleaningMinutes({ durationMinutes: 97, chargeMinutes: 0, verified: true })).toBe(97);
    expect(cleaningMinutes({ durationMinutes: 45, chargeMinutes: null, verified: false })).toBe(45);
  });

  it('drops a glitched unconfirmed duration but trusts the cloud', () => {
    expect(cleaningMinutes({ durationMinutes: 1500, chargeMinutes: null, verified: false })).toBeNull();
    expect(cleaningMinutes({ durationMinutes: 1500, chargeMinutes: 400, verified: true })).toBe(1100);
    expect(cleaningMinutes({ durationMinutes: null, chargeMinutes: null, verified: true })).toBeNull();
  });
});

describe('roomsSummary', () => {
  it('names up to two rooms and counts the rest', () => {
    expect(roomsSummary(['Living Room'])).toBe('Living Room');
    expect(roomsSummary(['Living Room', 'Kitchen'])).toBe('Living Room, Kitchen');
    expect(roomsSummary(['Living Room', 'Kitchen', 'Office', 'Bathroom'])).toBe('Living Room, Kitchen +2');
  });

  it('says whole home when the run named no rooms', () => {
    expect(roomsSummary([])).toBe('Whole home');
    expect(roomsSummary(undefined)).toBe('Whole home');
  });
});

// Shaped like the cloud's history rows (newest first): durationMinutes is wall clock and
// includes chargeMinutes and pauseMinutes.
let nextId = 100;
function run(over: Partial<RoombaRun>): RoombaRun {
  return {
    id: nextId++, startedAt: '2026-11-06T15:00:18Z', completedAt: null, durationMinutes: 419, squareFeet: 1555,
    status: 'COMPLETED', missionId: null, missionNumber: null, error: 0, errorText: null, initiator: 'cloud',
    cycle: null, source: 'irobot-history', chargeMinutes: 203, pauseMinutes: 30, evacuations: 6, doneCode: 'ok',
    rooms: [], settings: null, verified: true, ...over,
  };
}

describe('runTimeSummary', () => {
  it('splits each confirmed run into cleaning, recharging and paused, oldest first', () => {
    const s = runTimeSummary([
      run({ id: 2, startedAt: '2026-11-10T15:00:16Z', durationMinutes: 106, chargeMinutes: 0, pauseMinutes: 0, status: 'STUCK', errorText: 'Bumper is stuck' }),
      run({ id: 1 }),
    ]);
    expect(s.bars.map((b) => b.id)).toEqual([1, 2]);
    expect(s.bars[0]).toMatchObject({ floor: 186, charging: 203, paused: 30, total: 419, finished: true });
    expect(s.bars[1]).toMatchObject({ floor: 106, charging: 0, paused: 0, finished: false, errorText: 'Bumper is stuck' });
  });

  it('gives the typical cleaning time and the recharge share from finished cleans only', () => {
    const s = runTimeSummary([
      run({ durationMinutes: 72, chargeMinutes: 0, pauseMinutes: 41, status: 'CANCELLED' }),
      run({ durationMinutes: 169, chargeMinutes: 0, pauseMinutes: 55 }), // 114 cleaning, no recharge
      run({ durationMinutes: 106, chargeMinutes: 0, pauseMinutes: 0, status: 'STUCK' }),
      run({ durationMinutes: 419, chargeMinutes: 203, pauseMinutes: 30 }), // 186
      run({ durationMinutes: 383, chargeMinutes: 201, pauseMinutes: 0 }), // 182
    ]);
    expect(s.finished).toBe(3);
    expect(s.recharged).toBe(2);
    expect(s.typicalCleaning).toBe(182);
    // An even count takes the middle two.
    expect(runTimeSummary([
      run({}), run({ durationMinutes: 383, chargeMinutes: 201, pauseMinutes: 0 }),
      run({ durationMinutes: 169, chargeMinutes: 0, pauseMinutes: 55 }), run({ durationMinutes: 653, chargeMinutes: 390, pauseMinutes: 0 }),
    ]).typicalCleaning).toBe(184);
  });

  it('calls nothing typical until three cleans have finished', () => {
    const two = runTimeSummary([run({}), run({ durationMinutes: 383, chargeMinutes: 201, pauseMinutes: 0 })]);
    expect(two.finished).toBe(2);
    expect(two.typicalCleaning).toBeNull();
  });

  it('leaves out false starts and unconfirmed runs, and says the newest is still to come', () => {
    const pending = run({ verified: false, source: 'roombapy-prime', chargeMinutes: null, pauseMinutes: null, durationMinutes: 120, status: 'CANCELLED' });
    const s = runTimeSummary([
      pending,
      run({ durationMinutes: 2, chargeMinutes: 0, pauseMinutes: 0, status: 'CANCELLED' }),
      run({}),
    ]);
    expect(s.bars).toHaveLength(1);
    expect(s.falseStarts).toBe(1);
    expect(s.pending).toBe(pending);
    expect(runTimeSummary([run({})]).pending).toBeNull();
  });

  it('charts the newest runs up to the cap, counting only false starts among them', () => {
    const runs = [
      ...Array.from({ length: 16 }, () => run({})),
      run({ durationMinutes: 3, chargeMinutes: 0, pauseMinutes: 0 }), // older than the 14 charted
    ];
    const s = runTimeSummary(runs, 14);
    expect(s.bars).toHaveLength(14);
    expect(s.bars[13].id).toBe(runs[0].id);
    expect(s.falseStarts).toBe(0);
  });

  it('is empty with no runs, and has no typical time with nothing finished', () => {
    expect(runTimeSummary([])).toMatchObject({ bars: [], typicalCleaning: null, finished: 0, recharged: 0, falseStarts: 0, pending: null });
    expect(runTimeSummary([run({ status: 'STUCK' })]).typicalCleaning).toBeNull();
  });
});

describe('minuteTicks', () => {
  it('steps the minutes evenly to just above the tallest bar', () => {
    expect(minuteTicks(653)).toEqual([0, 120, 240, 360, 480, 600, 720]);
    expect(minuteTicks(419)).toEqual([0, 120, 240, 360, 480]);
    expect(minuteTicks(106)).toEqual([0, 30, 60, 90, 120]);
    expect(minuteTicks(40)).toEqual([0, 15, 30, 45]);
    expect(minuteTicks(0)).toEqual([0, 15]);
  });
});

describe('isRecharging', () => {
  it('is a mid-clean charge, not the end of a run', () => {
    expect(isRecharging({ phase: 'charge', cycle: 'clean' })).toBe(true);
    expect(isRecharging({ phase: 'charge', cycle: 'none' })).toBe(false);
    expect(isRecharging({ phase: 'charge', cycle: null })).toBe(false);
    expect(isRecharging({ phase: 'run', cycle: 'clean' })).toBe(false);
    expect(isRecharging(null)).toBe(false);
  });
});
