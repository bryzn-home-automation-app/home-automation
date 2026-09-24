import type { ForecastSnapshot } from '../types';

/**
 * Predicted value to plot for one calendar day on the trend chart.
 *
 * Future days (today onward) use the live forecast. Past days use the stored
 * snapshot — what the model actually said at the time — EXCEPT when a
 * still-ungraded snapshot would sit beside an actual that is probably partial
 * (the day is still syncing): that would draw a phantom miss, so the live
 * value is used instead, matching the Forecast tab. A past day with no actual
 * row at all keeps its stored snapshot so it doesn't jump when the rows land.
 */
export function pickPredicted(args: {
  date: string;
  today: string;
  snapshot: ForecastSnapshot | undefined;
  hasActual: boolean;
  live: number | undefined;
}): number | null {
  const { date, today, snapshot, hasActual, live } = args;
  if (date >= today) return live ?? null;
  if (snapshot) {
    const graded = snapshot.actualKwh != null;
    if (graded || !hasActual) return snapshot.predictedKwh;
  }
  return live ?? null;
}
