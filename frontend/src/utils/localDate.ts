/**
 * Today's date as YYYY-MM-DD in the browser's local timezone.
 *
 * `new Date().toISOString().slice(0, 10)` looks equivalent but isn't —
 * `toISOString()` converts to UTC first. For a user in US Central time,
 * that means anytime after ~7-8pm local the UTC date has already rolled
 * to tomorrow, so "today" silently reports the wrong calendar day (e.g. a
 * forecast chart's "Today" marker landing one day ahead of the real date).
 */
export function localTodayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parses a date. A date-only string (YYYY-MM-DD) is a calendar day, so it becomes local midnight;
 * `new Date('2026-11-04')` is UTC midnight, which shows as the previous day in US time zones.
 */
export function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}
