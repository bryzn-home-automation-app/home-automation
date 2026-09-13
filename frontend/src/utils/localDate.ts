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
