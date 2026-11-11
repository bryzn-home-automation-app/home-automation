import type { DailyUsagePoint, EnergyUsage, UsageRangeSummary } from '../types';
import { homeToday } from './format';

/**
 * A day is only "complete" enough to trust its total once it has most of its
 * 24 hourly rows. The current day (still syncing) and any day CoServ under-posted
 * fall below this and must be excluded from trend/average math, or they read as
 * artificial dips. The Electric tab's last reading and readings log use the same
 * rule, so Home and the Electric tab name the same latest day (B-081).
 */
export const COMPLETE_DAY_MIN_HOURS = 18;

export interface UsagePeriodDefinition {
  key: 'month' | 'quarter' | 'year' | 'lifetime';
  label: string;
  start: string;
  end: string;
  displayStart: string;
  displayEnd: string;
}

// Local wall-clock fields, formatted directly — NOT toISOString(), which
// converts to UTC first. The backend parses this as a zone-less
// LocalDateTime and compares it against naive local-wall-clock timestamp
// columns, so a UTC-shifted string silently shifts every period boundary
// (month/quarter/year/lifetime) by the local UTC offset (5-6h for US
// Central), cutting off the first few hours of "today" and pulling in a
// few hours it shouldn't.
function formatIso(value: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function formatDateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseStartDate(value?: string) {
  if (!value) {
    return new Date(new Date().getFullYear(), 0, 1);
  }

  const slashParts = value.split('/');
  if (slashParts.length === 3) {
    const [month, day, year] = slashParts.map(Number);
    return new Date(year, month - 1, day);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(new Date().getFullYear(), 0, 1) : date;
}

function maxDate(left: Date, right: Date) {
  return left.getTime() >= right.getTime() ? left : right;
}

export function buildUsagePeriods(lifetimeStart?: string, now = new Date()): UsagePeriodDefinition[] {
  const end = new Date(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const dataStart = parseStartDate(lifetimeStart);
  const smartYearStart = maxDate(yearStart, dataStart);
  const lifetime = dataStart;

  return [
    {
      key: 'month',
      label: 'Current Month',
      start: formatIso(monthStart),
      end: formatIso(end),
      displayStart: formatDateOnly(monthStart),
      displayEnd: formatDateOnly(monthEnd),
    },
    {
      key: 'quarter',
      label: 'Current Quarter',
      start: formatIso(quarterStart),
      end: formatIso(end),
      displayStart: formatDateOnly(quarterStart),
      displayEnd: formatDateOnly(quarterEnd),
    },
    {
      key: 'year',
      label: 'Current Year',
      start: formatIso(smartYearStart),
      end: formatIso(end),
      displayStart: formatDateOnly(smartYearStart),
      displayEnd: formatDateOnly(yearEnd),
    },
    {
      key: 'lifetime',
      label: 'Lifetime',
      start: formatIso(lifetime),
      end: formatIso(end),
      displayStart: formatDateOnly(lifetime),
      displayEnd: 'Today',
    },
  ];
}

export function createEmptyUsageSummary(meterId: number, start: string, end: string): UsageRangeSummary {
  return {
    meterId,
    start,
    end,
    totalKwh: 0,
    averageKwh: 0,
    readingCount: 0,
    highest: null,
    lowest: null,
  };
}

export function summarizeUsageRange(
  meterId: number,
  records: EnergyUsage[],
  start: string,
  end: string
): UsageRangeSummary {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const filtered = records.filter((record) => {
    const timestamp = new Date(record.timestamp).getTime();
    return timestamp >= startMs && timestamp <= endMs;
  });

  if (!filtered.length) {
    return createEmptyUsageSummary(meterId, start, end);
  }

  const totalKwh = filtered.reduce((sum, record) => sum + Number(record.usageKwh), 0);
  const sorted = [...filtered].sort((left, right) => Number(left.usageKwh) - Number(right.usageKwh));
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];

  return {
    meterId,
    start,
    end,
    totalKwh,
    averageKwh: totalKwh / filtered.length,
    readingCount: filtered.length,
    highest: {
      timestamp: highest.timestamp,
      usageKwh: Number(highest.usageKwh),
    },
    lowest: {
      timestamp: lowest.timestamp,
      usageKwh: Number(lowest.usageKwh),
    },
  };
}

/**
 * Server-pre-aggregated daily points -> the `{ date, kWh }` series the daily
 * trend chart plots. Uses the authoritative per-day total (COALESCE(SUM(...)) of
 * hourly rows, computed in one GROUP BY on the backend) directly — no client-side
 * summation and, crucially, no point-cap downsampling that would understate each
 * day's total. Sorted ascending by date so the line reads left-to-right.
 */
export function dailyTrendSeries(
  points: DailyUsagePoint[]
): Array<{ date: string; kWh: number }> {
  return [...points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, kWh: Math.round(Number(p.totalKwh) * 100) / 100 }));
}

/**
 * Average of daily totals over the trailing `days` window, counting only days
 * that are complete (>= `minReadings` hourly rows). Excluding partial days — the
 * still-syncing current day especially — stops the 7/30-day averages from being
 * dragged down by a day that only has a handful of hours so far.
 */
export function averageCompleteDailyKwh(
  points: DailyUsagePoint[],
  days: number,
  minReadings = COMPLETE_DAY_MIN_HOURS,
  now = new Date()
): number {
  // The window is counted in the home's calendar days. It used to subtract 24h
  // multiples and read the result in UTC, so from 6 PM Central (7 PM in summer)
  // the cutoff jumped a day ahead and the 7-day average quietly averaged 6 (B-076).
  const [y, m, d] = homeToday(now).split('-').map(Number);
  const threshold = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  const matching = points.filter(
    (p) => p.readingCount >= minReadings && p.date >= threshold
  );
  if (!matching.length) return 0;
  return matching.reduce((sum, p) => sum + Number(p.totalKwh), 0) / matching.length;
}
