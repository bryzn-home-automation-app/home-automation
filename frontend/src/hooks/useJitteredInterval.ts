import { useMemo } from 'react';

/**
 * Returns a randomized interval in milliseconds, jittered within
 * `[base, base + windowMs)`.
 *
 * Use this to spread out multiple React Query refetches that share the same
 * base cadence so they don't stampede the network at minute boundaries.
 *
 * IMPORTANT: this re-rolls a fresh random number on every call. React Query v5
 * compares each new `refetchInterval` value against the current one in
 * `QueryObserver.setOptions`, so passing a *new* number on every render clears
 * and restarts the poll timer each render — defeating the stagger and making
 * the cadence unstable on components that re-render often. Do NOT call this
 * inline in a `refetchInterval` field inside a component. Either:
 *   - inside a component/hook, use {@link useJitteredInterval} (memoized once
 *     per query lifecycle), or
 *   - at module top-level (evaluated once), call `jitteredInterval` directly.
 */
export function jitteredInterval(base: number, windowMs = 5_000): number {
  return base + Math.floor(Math.random() * windowMs);
}

/**
 * Hook form of {@link jitteredInterval}. Computes the jittered value once per
 * query lifecycle (memoized), so the React Query poll timer is set once and not
 * reset on every render. Safe to call inline in a `refetchInterval` field:
 *
 *   refetchInterval: useJitteredInterval(600_000),
 */
export function useJitteredInterval(base: number, windowMs = 5_000): number {
  return useMemo(() => jitteredInterval(base, windowMs), [base, windowMs]);
}
