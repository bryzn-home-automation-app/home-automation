import type { CoservBill, DailyUsagePoint, ForecastDailyPoint, ForecastSnapshot } from '../types';
import { COMPLETE_DAY_MIN_HOURS } from './usageSummary';

/**
 * Projected electric charge for the CURRENT CoServ billing cycle.
 *
 * Billing cycle, not calendar month: a CoServ bill runs meter read to meter read
 * (e.g. Aug 6 → Sep 8), so that is the number that will actually land on the
 * statement. The current cycle starts on the last bill's end date and is assumed
 * to end one month later (CoServ reads meters on a monthly schedule).
 *
 * kWh = complete metered days so far (hourly smart-meter data, back-filled for
 * the odd missing hour) + the forecast for today, every remaining day, and any
 * past day not posted yet. Checked against the real bills: counting the start
 * day and excluding the end day reproduces the billed kWh within ~2%
 * (599.7 vs 589 on the partial Jul 24 → Aug 6 bill, 2,080 vs 2,087 on Aug 6 → Sep 8).
 *
 * $ = fixed + rate × kWh, calibrated on recent full-length bills: the rate is
 * the configured energy rate and "fixed" is what that leaves over on those bills
 * (customer charge, fees). A projection at last cycle's usage therefore
 * reproduces last cycle's electric charge exactly, and different usage moves it
 * by rate × the difference.
 */

/** Bills shorter than this are partial cycles (move-in / first bill): their
 *  charges carry one-time fees and prorations, so they never calibrate pricing. */
export const FULL_CYCLE_MIN_DAYS = 25;

/** Keep projecting a cycle for this long past its estimated meter read (its bill
 *  just hasn't synced yet) before rolling on to the next cycle. */
export const BILL_GRACE_DAYS = 10;

/** A fitted fixed charge above this share of a typical bill means the configured
 *  rate doesn't describe the bills; fall back to their average $/kWh instead. */
const MAX_FIXED_SHARE = 0.35;

/** How many of the most recent full bills calibrate pricing (median). */
const CALIBRATION_BILLS = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface BillingCycle {
  /** First day of the cycle, inclusive — the previous meter read. */
  start: string;
  /** Next meter read, exclusive — the date the next bill's period ends. */
  end: string;
  /** `bill-cycle` when derived from a synced bill; `calendar-month` before any bill exists. */
  basis: 'bill-cycle' | 'calendar-month';
}

export interface BillPricing {
  /** $ per bill that doesn't scale with kWh (customer charge, fees). */
  fixedCharge: number;
  /** $ per kWh for the usage-driven part. */
  energyRate: number;
  /**
   * `calibrated`     — configured rate + the fixed part left over on recent full bills.
   * `effective-rate` — those bills' average $/kWh (the fixed part couldn't be separated).
   * `energy-only`    — no full bill yet: configured rate, no fixed charges.
   */
  method: 'calibrated' | 'effective-rate' | 'energy-only';
}

export interface BillProjection {
  cycle: BillingCycle;
  pricing: BillPricing;
  daysTotal: number;
  /** Days of the cycle before today. */
  daysElapsed: number;
  /** Days from today to the next meter read (0 once the cycle has ended). */
  daysLeft: number;
  /** kWh from complete metered days. */
  meteredKwh: number;
  /** kWh estimated for today, the rest of the cycle, and any day not posted yet. */
  forecastKwh: number;
  projectedKwh: number;
  projectedCost: number;
  /** Most recent full-length bill, for the "vs last bill" comparison. */
  lastBill: { start: string; end: string; kwh: number; charge: number } | null;
}

export interface BillProjectionInput {
  /** Local calendar date, YYYY-MM-DD. */
  today: string;
  bills: CoservBill[];
  /** Server-aggregated daily totals (hourly rows grouped by local date). */
  daily: DailyUsagePoint[];
  /** Live forecast days (the forecast endpoint pads past the weather horizon). */
  forecasts: ForecastDailyPoint[];
  /** Stored predictions — used for past days whose readings haven't posted. */
  snapshots: ForecastSnapshot[];
  /** Configured energy rate, $/kWh. */
  kwhRate: number;
}

// ── Calendar helpers (pure UTC arithmetic on YYYY-MM-DD — no local-TZ shifts) ──

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  return new Date(utcMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Same day-of-month `n` months later, clamped to the month's last day. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / DAY_MS);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ── Cycle + pricing ─────────────────────────────────────────────

/** Full-length bills with usable electric numbers, newest first. */
function fullBills(bills: CoservBill[]) {
  return bills
    .map((b) => ({
      start: (b.billingPeriodStart ?? '').slice(0, 10),
      end: (b.billingPeriodEnd ?? '').slice(0, 10),
      kwh: Number(b.electricUsageKwh),
      charge: Number(b.electricCharge),
    }))
    .filter(
      (b) =>
        ISO_DATE.test(b.start) &&
        ISO_DATE.test(b.end) &&
        daysBetween(b.start, b.end) >= FULL_CYCLE_MIN_DAYS &&
        b.kwh > 0 &&
        b.charge > 0
    )
    .sort((a, b) => b.end.localeCompare(a.end));
}

export function currentBillingCycle(bills: CoservBill[], today: string): BillingCycle {
  const ends = bills
    .map((b) => (b.billingPeriodEnd ?? '').slice(0, 10))
    .filter((e) => ISO_DATE.test(e))
    .sort();
  if (ends.length === 0) {
    const start = `${today.slice(0, 7)}-01`;
    return { start, end: addMonths(start, 1), basis: 'calendar-month' };
  }
  let start = ends[ends.length - 1];
  let end = addMonths(start, 1);
  // The bill for an ended cycle normally syncs within days; if it still hasn't
  // after the grace period, stop projecting a cycle that's long over.
  for (let i = 0; i < 24 && daysBetween(end, today) > BILL_GRACE_DAYS; i++) {
    start = end;
    end = addMonths(start, 1);
  }
  return { start, end, basis: 'bill-cycle' };
}

export function calibratePricing(bills: CoservBill[], kwhRate: number): BillPricing {
  const rate = Number.isFinite(kwhRate) && kwhRate > 0 ? kwhRate : 0;
  const recent = fullBills(bills).slice(0, CALIBRATION_BILLS);
  if (recent.length === 0) return { fixedCharge: 0, energyRate: rate, method: 'energy-only' };
  if (rate > 0) {
    const fixed = median(recent.map((b) => b.charge - rate * b.kwh));
    const typicalCharge = median(recent.map((b) => b.charge));
    if (fixed >= 0 && fixed <= MAX_FIXED_SHARE * typicalCharge) {
      return { fixedCharge: fixed, energyRate: rate, method: 'calibrated' };
    }
  }
  return { fixedCharge: 0, energyRate: median(recent.map((b) => b.charge / b.kwh)), method: 'effective-rate' };
}

// ── Usage ───────────────────────────────────────────────────────

/** A day's metered kWh; complete days missing a few hourly rows are scaled to 24h. */
function meteredDay(p: DailyUsagePoint | undefined): { kwh: number; complete: boolean } | null {
  if (!p) return null;
  const kwh = Number(p.totalKwh);
  const hours = Number(p.readingCount);
  if (!Number.isFinite(kwh) || kwh < 0) return null;
  if (Number.isFinite(hours) && hours >= COMPLETE_DAY_MIN_HOURS) {
    return { kwh: hours < 24 ? (kwh * 24) / hours : kwh, complete: true };
  }
  return { kwh, complete: false };
}

/** Mean of the last `days` complete metered days before today (0 when none). */
function recentMeteredAverage(daily: DailyUsagePoint[], today: string, days = 7): number {
  const values = [...daily]
    .filter((p) => typeof p?.date === 'string' && p.date.slice(0, 10) < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(meteredDay)
    .filter((m): m is { kwh: number; complete: boolean } => !!m && m.complete)
    .slice(0, days)
    .map((m) => m.kwh);
  return values.length ? mean(values) : 0;
}

export function projectElectricBill(input: BillProjectionInput): BillProjection | null {
  const { today, bills, daily, forecasts, snapshots, kwhRate } = input;
  if (!ISO_DATE.test(today)) return null;

  const cycle = currentBillingCycle(bills, today);
  const pricing = calibratePricing(bills, kwhRate);
  if (!(pricing.energyRate > 0)) return null;

  const dailyByDate = new Map<string, DailyUsagePoint>();
  for (const p of daily) {
    if (p && typeof p.date === 'string') dailyByDate.set(p.date.slice(0, 10), p);
  }
  const liveByDate = new Map<string, number>();
  for (const f of forecasts) {
    if (f && typeof f.date === 'string' && Number.isFinite(f.predictedKwh) && f.predictedKwh >= 0) {
      liveByDate.set(f.date.slice(0, 10), f.predictedKwh);
    }
  }
  const snapByDate = new Map<string, number>();
  for (const s of snapshots) {
    if (s && typeof s.targetDate === 'string' && Number.isFinite(s.predictedKwh) && s.predictedKwh >= 0) {
      snapByDate.set(s.targetDate.slice(0, 10), s.predictedKwh);
    }
  }

  // For any day the forecast doesn't reach: its own average going forward, else
  // the recent metered average.
  const upcoming = [...liveByDate.entries()].filter(([d]) => d >= today).map(([, v]) => v);
  const rawFallback = upcoming.length ? mean(upcoming) : recentMeteredAverage(daily, today);
  const fallback = Number.isFinite(rawFallback) && rawFallback > 0 ? rawFallback : 0;

  let meteredKwh = 0;
  let forecastKwh = 0;
  let meteredDays = 0;
  for (let d = cycle.start; d < cycle.end; d = addDays(d, 1)) {
    const m = meteredDay(dailyByDate.get(d));
    if (d < today && m?.complete) {
      meteredKwh += m.kwh;
      meteredDays++;
      continue;
    }
    // Past day not (fully) posted: what the model said at the time, else the
    // live estimate. Today onward: the live forecast.
    const predicted = (d < today ? snapByDate.get(d) ?? liveByDate.get(d) : liveByDate.get(d)) ?? fallback;
    // A partially-posted day is at least what has posted so far.
    forecastKwh += Math.max(predicted, m?.kwh ?? 0);
  }
  if (meteredDays === 0 && forecastKwh === 0) return null;

  const daysTotal = daysBetween(cycle.start, cycle.end);
  const clampDays = (n: number) => Math.min(daysTotal, Math.max(0, n));
  const projectedKwh = meteredKwh + forecastKwh;
  const last = fullBills(bills)[0];

  return {
    cycle,
    pricing,
    daysTotal,
    daysElapsed: clampDays(daysBetween(cycle.start, today)),
    daysLeft: clampDays(daysBetween(today, cycle.end)),
    meteredKwh,
    forecastKwh,
    projectedKwh,
    projectedCost: pricing.fixedCharge + pricing.energyRate * projectedKwh,
    lastBill: last ? { start: last.start, end: last.end, kwh: last.kwh, charge: last.charge } : null,
  };
}

// ── Presentation ────────────────────────────────────────────────

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Sep 8 – Oct 8" (meter read to meter read); calendar months show their last day. */
export function formatCycleRange(cycle: BillingCycle): string {
  const shownEnd = cycle.basis === 'calendar-month' ? addDays(cycle.end, -1) : cycle.end;
  return `${shortDate(cycle.start)} – ${shortDate(shownEnd)}`;
}

/** One-paragraph explanation of how the number was built (tile tooltip). */
export function describeBillProjection(p: BillProjection): string {
  const kwh = (n: number) => Math.round(n).toLocaleString('en-US');
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const period = p.cycle.basis === 'bill-cycle' ? 'billing cycle' : 'month';
  const rest = p.daysLeft > 0
    ? `${kwh(p.forecastKwh)} kWh forecast for the remaining ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`
    : `${kwh(p.forecastKwh)} kWh estimated for days not posted yet`;
  const pricing =
    p.pricing.method === 'calibrated'
      ? `priced like your last full bill (${usd(p.pricing.fixedCharge)} fixed + $${p.pricing.energyRate.toFixed(4)}/kWh)`
      : p.pricing.method === 'effective-rate'
        ? `at your recent bills' average of $${p.pricing.energyRate.toFixed(4)}/kWh`
        : `at the configured $${p.pricing.energyRate.toFixed(4)}/kWh energy rate (no bill synced yet, so fixed charges aren't included)`;
  return (
    `Electric charge projected for the ${formatCycleRange(p.cycle)} ${period}: ` +
    `${kwh(p.meteredKwh)} kWh metered so far + ${rest} = ${kwh(p.projectedKwh)} kWh, ${pricing}. ` +
    'Gas is billed separately on the same CoServ statement.'
  );
}
