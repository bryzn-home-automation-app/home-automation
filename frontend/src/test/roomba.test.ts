import { describe, expect, it } from 'vitest';
import { cleaningMinutes, isRecharging, roomsSummary } from '../utils/roomba';

describe('cleaningMinutes', () => {
  it('takes the recharge stops out of a confirmed run', () => {
    expect(cleaningMinutes({ durationMinutes: 653, chargeMinutes: 390, verified: true })).toBe(263);
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

describe('isRecharging', () => {
  it('is a mid-clean charge, not the end of a run', () => {
    expect(isRecharging({ phase: 'charge', cycle: 'clean' })).toBe(true);
    expect(isRecharging({ phase: 'charge', cycle: 'none' })).toBe(false);
    expect(isRecharging({ phase: 'charge', cycle: null })).toBe(false);
    expect(isRecharging({ phase: 'run', cycle: 'clean' })).toBe(false);
    expect(isRecharging(null)).toBe(false);
  });
});
