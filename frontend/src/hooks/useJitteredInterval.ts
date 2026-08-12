/**
 * Returns a randomized interval in milliseconds, jittered within
 * `[base, base + windowMs)`.
 *
 * Use this to spread out multiple React Query refetches that share the same
 * base cadence so they don't stampede the network at minute boundaries.
 *
 * The value is re-rolled on every call (i.e. every render of the consumer).
 * React Query captures the value into its internal scheduler once when the
 * observer is created / options change, so subsequent renders producing new
 * numbers do not constantly reset the timer. For a one-shot stagger per
 * query lifecycle, call once at component-init time — e.g. inline in the
 * `refetchInterval` field:
 *
 *   refetchInterval: jitteredInterval(60_000),
 *
 * Note: this is NOT a hook (no React state), so it's safe to call inline in
 * module top-level or render bodies without lint warnings.
 */
export function jitteredInterval(base: number, windowMs = 5_000): number {
  return base + Math.floor(Math.random() * windowMs);
}