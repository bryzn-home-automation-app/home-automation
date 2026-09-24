import { describe, it, expect } from 'vitest';
import { pickPredicted } from '../utils/forecastSeries';
import type { ForecastSnapshot } from '../types';

const snap = (predictedKwh: number, actualKwh: number | null): ForecastSnapshot => ({
  targetDate: '2026-09-23',
  predictedKwh,
  actualKwh,
  predictedCost: 0,
  actualCost: null,
});

const base = { today: '2026-09-24', live: 49 };

describe('pickPredicted', () => {
  it('uses the live forecast from today onward', () => {
    expect(pickPredicted({ ...base, date: '2026-09-24', snapshot: snap(54.1, null), hasActual: true })).toBe(49);
    expect(pickPredicted({ ...base, date: '2026-09-30', snapshot: undefined, hasActual: false })).toBe(49);
  });

  it('uses the stored prediction for a graded past day', () => {
    expect(pickPredicted({ ...base, date: '2026-09-23', snapshot: snap(54.1, 50), hasActual: true })).toBe(54.1);
  });

  it('avoids a phantom miss: ungraded snapshot beside a (partial) actual falls back to live', () => {
    expect(pickPredicted({ ...base, date: '2026-09-23', snapshot: snap(54.1, null), hasActual: true })).toBe(49);
  });

  it('keeps the stored prediction for a past day with no actual row yet (no jump later)', () => {
    expect(pickPredicted({ ...base, date: '2026-09-23', snapshot: snap(54.1, null), hasActual: false })).toBe(54.1);
  });

  it('is null when a past day has neither a snapshot nor a live value', () => {
    expect(pickPredicted({ today: '2026-09-24', date: '2026-09-10', snapshot: undefined, hasActual: true, live: undefined })).toBeNull();
  });
});
