import type { UseQueryResult } from '@tanstack/react-query';
import { SkelPanel, type QueryLike } from '../../components/ui';

/*
 * Small pieces the three Utilities views share: round axis ticks, the deferred-chart placeholder
 * and the meter gate for the electric usage queries. (ChartLegend, TooltipCard and ShowMore
 * started here and are in the kit now.)
 */

/**
 * Round, evenly spaced y ticks (steps of 1, 2, 2.5 or 5 × a power of ten) covering the
 * values, about `count` of them, so an axis reads 0 / 5k / 10k / 15k rather than 5k / 9k / 14k.
 */
export function niceTicks(values: ReadonlyArray<number | null | undefined>, opts: { count?: number; floorZero?: boolean; pad?: number } = {}): number[] | undefined {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return undefined;
  const { count = 5, floorZero = false, pad = 0 } = opts;
  let lo = Math.min(...nums) - pad;
  let hi = Math.max(...nums) + pad;
  if (floorZero && lo > 0) lo = 0;
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; ticks.length < 50; v += step) {
    ticks.push(Number(v.toFixed(6)));
    if (v >= hi - step * 1e-6) break;
  }
  return ticks;
}

/** A panel-shaped placeholder for DeferredRender (the kit's skeleton, not the old card). */
export const DEFERRED_CHART = <SkelPanel chart />;

/**
 * The electric usage queries only run once the meters list names an electric meter, so on
 * their own a failed meters request would leave them disabled and the page on a skeleton
 * forever. This folds the meters query in: its failure is the usage's failure (with its
 * retry), and "no electric meter" is loaded-and-empty rather than loading.
 */
export function meterGated<T>(
  meters: UseQueryResult<unknown>,
  hasMeter: boolean,
  query: UseQueryResult<T[]>,
): QueryLike<T[]> {
  if (!hasMeter) {
    if (meters.data === undefined) {
      return { data: undefined, isError: meters.isError, isFetching: meters.isFetching, refetch: meters.refetch };
    }
    return { data: [], isError: false, refetch: meters.refetch };
  }
  return query;
}
