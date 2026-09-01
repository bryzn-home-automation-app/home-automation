import type { DailyUsagePoint, EnergyUsage, UsageRangeSummary } from '../types';

/**
 * A day is only "complete" enough to trust its total once it has most of its
 * 24 hourly rows. The current day (still syncing) and any day CoServ under-posted
 * fall below this and must be excluded from trend/average math, or they read as
 * artificial dips. Matches the >=18 guard used by the daily usage-log table.
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

function formatIso(value: Date) {
  return value.toISOString().slice(0, 19);
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
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const matching = points.filter(
    (p) => p.readingCount >= minReadings && p.date >= threshold
  );
  if (!matching.length) return 0;
  return matching.reduce((sum, p) => sum + Number(p.totalKwh), 0) / matching.length;
}

export function formatSummaryDate(timestamp?: string | null) {
  if (!timestamp) {
    return 'No data';
  }

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatPeriodRange(start: string, end: string) {
  const formatDisplay = (value: string) => {
    if (value === 'Today') {
      return value;
    }

    const isoDateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = isoDateOnlyMatch
      ? new Date(
          Number(isoDateOnlyMatch[1]),
          Number(isoDateOnlyMatch[2]) - 1,
          Number(isoDateOnlyMatch[3])
        )
      : new Date(value);

    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return `${formatDisplay(start)} - ${formatDisplay(end)}`;
}