import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonths,
  calibratePricing,
  currentBillingCycle,
  describeBillProjection,
  formatCycleRange,
  projectElectricBill,
} from '../utils/billProjection';
import type { CoservBill, DailyUsagePoint, ForecastDailyPoint, ForecastSnapshot } from '../types';

// The two real CoServ bills: a partial first cycle (13 days, one-time fees) and
// the first full one.
function bill(start: string, end: string, kwh: number, charge: number): CoservBill {
  return {
    id: 0, billingPeriodStart: start, billingPeriodEnd: end,
    electricUsageKwh: kwh, electricCharge: charge, totalDue: charge,
    source: 'test', sourceProvider: 'test', ingestionBatchId: 'x', processingVersion: '1.0', createdAt: '',
  };
}
const PARTIAL = bill('2026-07-24', '2026-08-06', 589, 124.12);
const FULL = bill('2026-08-06', '2026-09-08', 2087, 277.57);
const RATE = 0.1171;

function day(date: string, totalKwh: number, readingCount = 24): DailyUsagePoint {
  return { date, totalKwh, readingCount, sourceProvider: 'coserv' };
}
function days(from: string, count: number, kwh: number, readings = 24): DailyUsagePoint[] {
  return Array.from({ length: count }, (_, i) => day(addDays(from, i), kwh, readings));
}
function fc(date: string, predictedKwh: number): ForecastDailyPoint {
  return {
    date, predictedKwh, predictedCost: 0, lowerBound: 0, upperBound: 0,
    weatherHigh: null, weatherLow: null, weatherAvg: null, cdd: null, hdd: null, confidencePct: 80,
  };
}
function fcs(from: string, count: number, kwh: number): ForecastDailyPoint[] {
  return Array.from({ length: count }, (_, i) => fc(addDays(from, i), kwh));
}
function snap(targetDate: string, predictedKwh: number): ForecastSnapshot {
  return { targetDate, predictedKwh, actualKwh: null, predictedCost: 0, actualCost: null };
}

describe('calendar helpers', () => {
  it('adds months with month-end clamping', () => {
    expect(addMonths('2026-09-08', 1)).toBe('2026-10-08');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('currentBillingCycle', () => {
  it('starts at the last bill end and runs one month', () => {
    expect(currentBillingCycle([PARTIAL, FULL], '2026-09-28')).toEqual({
      start: '2026-09-08', end: '2026-10-08', basis: 'bill-cycle',
    });
  });

  it('keeps the ended cycle while its bill is pending, then rolls on', () => {
    expect(currentBillingCycle([FULL], '2026-10-15').start).toBe('2026-09-08');
    expect(currentBillingCycle([FULL], '2026-10-25')).toEqual({
      start: '2026-10-08', end: '2026-11-08', basis: 'bill-cycle',
    });
  });

  it('falls back to the calendar month before any bill exists', () => {
    expect(currentBillingCycle([], '2026-09-28')).toEqual({
      start: '2026-09-01', end: '2026-10-01', basis: 'calendar-month',
    });
  });
});

describe('calibratePricing', () => {
  it('splits the last full bill into the configured rate + a fixed part, ignoring partial bills', () => {
    const p = calibratePricing([PARTIAL, FULL], RATE);
    expect(p.method).toBe('calibrated');
    expect(p.energyRate).toBe(RATE);
    expect(p.fixedCharge).toBeCloseTo(277.57 - RATE * 2087, 6); // 33.18
  });

  it('uses the bills’ average $/kWh when the configured rate is above it', () => {
    const p = calibratePricing([FULL], 0.2);
    expect(p.method).toBe('effective-rate');
    expect(p.fixedCharge).toBe(0);
    expect(p.energyRate).toBeCloseTo(277.57 / 2087, 6);
  });

  it('is energy-only with no full-length bill', () => {
    expect(calibratePricing([PARTIAL], RATE)).toEqual({ fixedCharge: 0, energyRate: RATE, method: 'energy-only' });
  });
});

describe('projectElectricBill', () => {
  const today = '2026-09-28';

  it('adds metered days to the forecast and prices it like the last full bill', () => {
    const p = projectElectricBill({
      today,
      bills: [PARTIAL, FULL],
      daily: days('2026-09-08', 20, 60), // Sep 8 – Sep 27
      forecasts: fcs('2026-09-27', 16, 55), // yesterday → Oct 12, like the endpoint
      snapshots: [],
      kwhRate: RATE,
    })!;
    expect(p.cycle).toEqual({ start: '2026-09-08', end: '2026-10-08', basis: 'bill-cycle' });
    expect(p.daysTotal).toBe(30);
    expect(p.daysElapsed).toBe(20);
    expect(p.daysLeft).toBe(10);
    expect(p.meteredKwh).toBeCloseTo(1200, 6);
    expect(p.forecastKwh).toBeCloseTo(550, 6); // Sep 28 – Oct 7
    expect(p.projectedKwh).toBeCloseTo(1750, 6);
    expect(p.projectedCost).toBeCloseTo(277.57 + RATE * (1750 - 2087), 6);
    expect(p.lastBill).toEqual({ start: '2026-08-06', end: '2026-09-08', kwh: 2087, charge: 277.57 });
  });

  it('reproduces the last bill exactly at the same usage', () => {
    // 30 metered days summing to 2,087 kWh, cycle already over (bill pending).
    const p = projectElectricBill({
      today: '2026-10-09',
      bills: [FULL],
      daily: days('2026-09-08', 30, 2087 / 30),
      forecasts: [],
      snapshots: [],
      kwhRate: RATE,
    })!;
    expect(p.daysLeft).toBe(0);
    expect(p.projectedCost).toBeCloseTo(277.57, 6);
  });

  it('back-fills a complete day that is missing a few hourly rows', () => {
    const p = projectElectricBill({
      today: '2026-09-10',
      bills: [FULL],
      daily: [day('2026-09-08', 52.5, 21), day('2026-09-09', 60)],
      forecasts: fcs('2026-09-09', 40, 0),
      snapshots: [],
      kwhRate: RATE,
    })!;
    expect(p.meteredKwh).toBeCloseTo(60 + 60, 6);
  });

  it('estimates a past day that has not posted yet, and never below what has posted', () => {
    const p = projectElectricBill({
      today,
      bills: [FULL],
      daily: [
        ...days('2026-09-08', 18, 60), // through Sep 25
        day('2026-09-26', 10, 6), // partially posted, below its prediction
        // Sep 27: not posted at all
      ],
      forecasts: fcs('2026-09-27', 16, 50),
      snapshots: [snap('2026-09-26', 58), snap('2026-09-27', 62)],
      kwhRate: RATE,
    })!;
    expect(p.meteredKwh).toBeCloseTo(18 * 60, 6);
    // Sep 26 → snapshot 58, Sep 27 → snapshot 62 (not the live 50), then 10 days × 50.
    expect(p.forecastKwh).toBeCloseTo(58 + 62 + 10 * 50, 6);
  });

  it('extends past the forecast horizon with the forecast’s own average', () => {
    const p = projectElectricBill({
      today: '2026-09-09',
      bills: [FULL],
      daily: [day('2026-09-08', 60)],
      forecasts: [...fcs('2026-09-09', 7, 40), ...fcs('2026-09-16', 7, 60)], // 14 days, mean 50
      snapshots: [],
      kwhRate: RATE,
    })!;
    // Sep 9 – Oct 7 = 29 forecast days: 7×40 + 7×60 + 15×50.
    expect(p.forecastKwh).toBeCloseTo(7 * 40 + 7 * 60 + 15 * 50, 6);
  });

  it('uses the recent metered average when there is no forecast at all', () => {
    const p = projectElectricBill({
      today,
      bills: [FULL],
      daily: days('2026-09-08', 20, 60),
      forecasts: [],
      snapshots: [],
      kwhRate: RATE,
    })!;
    expect(p.forecastKwh).toBeCloseTo(10 * 60, 6);
  });

  it('prices a calendar month at the energy rate when no bill has synced', () => {
    const p = projectElectricBill({
      today,
      bills: [],
      daily: days('2026-09-01', 27, 60),
      forecasts: fcs('2026-09-27', 16, 55),
      snapshots: [],
      kwhRate: RATE,
    })!;
    expect(p.cycle.basis).toBe('calendar-month');
    expect(p.pricing.method).toBe('energy-only');
    expect(p.projectedKwh).toBeCloseTo(27 * 60 + 3 * 55, 6);
    expect(p.projectedCost).toBeCloseTo(RATE * (27 * 60 + 3 * 55), 6);
    expect(p.lastBill).toBeNull();
    expect(formatCycleRange(p.cycle)).toBe('Sep 1 – Sep 30');
  });

  it('returns null when there is nothing to project from', () => {
    expect(projectElectricBill({ today, bills: [FULL], daily: [], forecasts: [], snapshots: [], kwhRate: RATE })).toBeNull();
  });

  it('explains itself for the tile tooltip', () => {
    const p = projectElectricBill({
      today,
      bills: [PARTIAL, FULL],
      daily: days('2026-09-08', 20, 60),
      forecasts: fcs('2026-09-27', 16, 55),
      snapshots: [],
      kwhRate: RATE,
    })!;
    expect(formatCycleRange(p.cycle)).toBe('Sep 8 – Oct 8');
    const text = describeBillProjection(p);
    expect(text).toContain('Sep 8 – Oct 8 billing cycle');
    expect(text).toContain('1,200 kWh metered so far + 550 kWh forecast for the remaining 10 days = 1,750 kWh');
    expect(text).toContain('$33.18 fixed + $0.1171/kWh');
  });
});
