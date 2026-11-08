import type { CoservBill, GasLineItem, WeatherDay } from '../types';

/**
 * Gas comes only from CoServ bills: the meter is read once a billing cycle, so a
 * cycle (its dates, CCF and gas charge) is the finest grain there is. Cycles
 * share their boundary date (one ends on the day the next starts), so a cycle
 * covers [start, end).
 */
export interface GasCycle {
  id: number;
  start: string;
  end: string;
  days: number;
  ccf: number;
  charge: number;
  perDay: number;
  items: GasLineItem[] | null;
  split: GasSplit | null;
  billingDate?: string;
}

/** A gas charge by what drives it (see GasLineItem.kind). */
export interface GasSplit {
  fixed: number;
  usage: number;
  taxes: number;
}

const DAY_MS = 86_400_000;
const noonUtc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const cents = (n: number) => Math.round(n * 100) / 100;

export const daysBetween = (from: string, to: string) => Math.round((noonUtc(to) - noonUtc(from)) / DAY_MS);

export function addDays(iso: string, days: number): string {
  return new Date(noonUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "Oct 7" */
export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A bill goes by the month its meter read falls in, as CoServ dates it: "Oct ’26". */
export function billMonth(cycle: GasCycle): string {
  const d = new Date(`${cycle.end}T12:00:00`);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ’${String(d.getFullYear()).slice(2)}`;
}

export function splitCharges(items: GasLineItem[] | null | undefined): GasSplit | null {
  if (!items?.length) return null;
  const split = { fixed: 0, usage: 0, taxes: 0 };
  for (const item of items) split[item.kind] += item.amount;
  return { fixed: cents(split.fixed), usage: cents(split.usage), taxes: cents(split.taxes) };
}

/** Bills that carry gas service, oldest first. */
export function gasCycles(bills: CoservBill[]): GasCycle[] {
  return bills
    .filter((b) => b.gasUsageCcf != null && b.gasCharge != null)
    .map((b) => {
      const days = Math.max(1, daysBetween(b.billingPeriodStart, b.billingPeriodEnd));
      const ccf = Number(b.gasUsageCcf);
      const items = b.gasLineItems ?? null;
      return {
        id: b.id,
        start: b.billingPeriodStart,
        end: b.billingPeriodEnd,
        days,
        ccf,
        charge: Number(b.gasCharge),
        perDay: ccf / days,
        items,
        split: splitCharges(items),
        billingDate: b.billingDate,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * When the next meter read and bill should come: the last read plus a typical
 * cycle (the average of full-length ones, else 30 days), plus the usual wait
 * from read to bill (else 5 days).
 */
export function nextGasBill(cycles: GasCycle[]): { read: string; bill: string } | null {
  const last = cycles[cycles.length - 1];
  if (!last) return null;
  const full = cycles.filter((c) => c.days >= 25).map((c) => c.days);
  const length = full.length ? Math.round(full.reduce((s, d) => s + d, 0) / full.length) : 30;
  const waits = cycles.filter((c) => c.billingDate).map((c) => daysBetween(c.end, c.billingDate!));
  const wait = waits.length ? Math.round(waits.reduce((s, d) => s + d, 0) / waits.length) : 5;
  const read = addDays(last.end, length);
  return { read, bill: addDays(read, wait) };
}

/**
 * What one more CCF would have added to a bill, and what the bill would have
 * been with no gas used. Taxes and the city fee are a share of everything else,
 * so they're spread over both at the bill's own rate.
 */
export function gasPricing(cycle: GasCycle): { perCcf: number; withoutGas: number } | null {
  const { split, items } = cycle;
  if (!split || !items) return null;
  const base = split.fixed + split.usage;
  if (base <= 0) return null;
  const taxRate = split.taxes / base;
  const rate = items.filter((i) => i.kind === 'usage').reduce((s, i) => s + (i.rate ?? 0), 0);
  return { perCcf: rate * (1 + taxRate), withoutGas: split.fixed * (1 + taxRate) };
}

/** The average daily mean temperature over a cycle's days, or null without weather for them. */
export function cycleTemperature(cycle: GasCycle, days: WeatherDay[]): number | null {
  const temps = days
    .filter((d) => d.date >= cycle.start && d.date < cycle.end && Number.isFinite(d.meanTemperature))
    .map((d) => d.meanTemperature);
  return temps.length ? temps.reduce((s, t) => s + t, 0) / temps.length : null;
}
