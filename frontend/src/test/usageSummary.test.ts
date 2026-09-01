import { describe, it, expect } from 'vitest';
import {
  dailyTrendSeries,
  averageCompleteDailyKwh,
  COMPLETE_DAY_MIN_HOURS,
} from '../utils/usageSummary';
import type { DailyUsagePoint } from '../types';

const day = (
  date: string,
  totalKwh: number,
  readingCount: number
): DailyUsagePoint => ({ date, totalKwh, readingCount, sourceProvider: 'coserv' });

describe('dailyTrendSeries', () => {
  it('plots the authoritative per-day total, not a downsampled fraction', () => {
    // Regression: the old trend chart summed point-capped hourly rows and showed
    // ~1/3 of each day's real kWh. The series must carry the full daily total.
    const series = dailyTrendSeries([day('2026-08-20', 30, 24)]);
    expect(series).toEqual([{ date: '2026-08-20', kWh: 30 }]);
  });

  it('sorts ascending by date and rounds to 2 decimals', () => {
    const series = dailyTrendSeries([
      day('2026-08-22', 12.005, 24),
      day('2026-08-20', 9.1, 24),
      day('2026-08-21', 10, 24),
    ]);
    expect(series.map((p) => p.date)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(series[2].kWh).toBe(12.01);
  });

  it('is empty for no points', () => {
    expect(dailyTrendSeries([])).toEqual([]);
  });
});

describe('averageCompleteDailyKwh', () => {
  const now = new Date('2026-08-31T12:00:00Z');

  it('excludes the still-syncing partial current day', () => {
    const points = [
      day('2026-08-29', 30, 24), // complete
      day('2026-08-30', 30, 24), // complete
      day('2026-08-31', 5, 4),   // today, partial — must be ignored
    ];
    // Average of the two complete days, not dragged down by today's 5 kWh.
    expect(averageCompleteDailyKwh(points, 7, COMPLETE_DAY_MIN_HOURS, now)).toBe(30);
  });

  it('excludes days below the completeness threshold', () => {
    const points = [
      day('2026-08-28', 20, 24),
      day('2026-08-29', 40, 10), // under-posted — excluded
    ];
    expect(averageCompleteDailyKwh(points, 7, COMPLETE_DAY_MIN_HOURS, now)).toBe(20);
  });

  it('excludes days outside the trailing window', () => {
    const points = [
      day('2026-08-10', 100, 24), // > 7 days before now — excluded
      day('2026-08-30', 25, 24),
    ];
    expect(averageCompleteDailyKwh(points, 7, COMPLETE_DAY_MIN_HOURS, now)).toBe(25);
  });

  it('returns 0 when no complete days fall in the window', () => {
    expect(averageCompleteDailyKwh([day('2026-08-31', 5, 3)], 7, COMPLETE_DAY_MIN_HOURS, now)).toBe(0);
    expect(averageCompleteDailyKwh([], 30, COMPLETE_DAY_MIN_HOURS, now)).toBe(0);
  });
});
