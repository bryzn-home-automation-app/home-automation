import { describe, expect, it } from 'vitest';
import { niceTicks } from '../pages/utility/parts';

describe('niceTicks (Utilities chart axes)', () => {
  it('reads in round, even steps from zero (B-097: no "5k / 9k / 14k")', () => {
    expect(niceTicks([9800, 13200, 16900, 11400], { floorZero: true })).toEqual([0, 5000, 10000, 15000, 20000]);
  });

  it('covers a temperature range without forcing zero', () => {
    const ticks = niceTicks([43.2, 72.8], { pad: 1 })!;
    expect(ticks[0]).toBeLessThanOrEqual(42.2);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(73.8);
    const steps = new Set(ticks.slice(1).map((v, i) => v - ticks[i]));
    expect(steps.size).toBe(1);
  });

  it('has nothing to say about no values', () => {
    expect(niceTicks([null, undefined])).toBeUndefined();
  });
});
