/**
 * Parses a date. A date-only string (YYYY-MM-DD) is a calendar day, so it becomes local midnight;
 * `new Date('2026-11-04')` is UTC midnight, which shows as the previous day in US time zones.
 */
export function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}
