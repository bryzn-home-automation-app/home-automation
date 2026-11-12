import type { RoombaRun, RoombaStatus } from '../types';

// Run-history + live-state helpers for the Roomba tab, kept free of React so they
// can be unit-tested directly (see src/test/roomba.test.ts).

/**
 * Time actually spent cleaning: the run's start-to-finish time less the stops
 * docked to recharge and the pauses (a whole-house clean here is ~3 h of cleaning
 * spread over ~6½ h). Null for a missing or glitched (>24 h, unconfirmed) duration.
 */
export function cleaningMinutes(run: Pick<RoombaRun, 'durationMinutes' | 'chargeMinutes' | 'verified'> & { pauseMinutes?: number | null }): number | null {
  const total = run.durationMinutes;
  if (total == null || !Number.isFinite(total)) return null;
  // The poller's own rows once ran to 12 h when a stuck robot sat unnoticed;
  // the cloud's figures don't, so only unconfirmed rows get the guard.
  if (!run.verified && total > 1440) return null;
  return Math.max(0, total - (run.chargeMinutes ?? 0) - (run.pauseMinutes ?? 0));
}

/** "Living Room, Kitchen +4" for a list row; "Whole home" when no rooms were named. */
export function roomsSummary(rooms: string[] | null | undefined, max = 2): string {
  if (!rooms || rooms.length === 0) return 'Whole home';
  if (rooms.length <= max) return rooms.join(', ');
  return `${rooms.slice(0, max).join(', ')} +${rooms.length - max}`;
}

/**
 * Docked partway through a clean to recharge. The robot resumes the same mission
 * once charged; "charge" alone would read as finished, but the cycle only drops to
 * "none" at the real end.
 */
export function isRecharging(status: Pick<RoombaStatus, 'phase' | 'cycle'> | null | undefined): boolean {
  if (!status || status.phase !== 'charge') return false;
  return status.cycle != null && status.cycle !== '' && status.cycle !== 'none';
}

// ── Time per clean (the Overview chart) ────────────────────

/** How many cleans the chart shows: about three weeks at this house's pace. */
export const RUN_TIMES_SHOWN = 14;
/** Shorter than this is a false start (started and cancelled straight away), not a clean. */
export const FALSE_START_MINUTES = 5;
/** A "typical" cleaning time needs at least this many finished cleans to mean anything. */
export const TYPICAL_MIN_CLEANS = 3;

/** One clean's wall-clock time, split the way the cloud's history splits it. */
export interface RunTimeBar {
  id: number;
  startedAt: string;
  /** Start to finish less recharging and pauses: cleaning on a finished run, time off the dock on one that stopped short. */
  floor: number;
  charging: number;
  paused: number;
  total: number;
  /** COMPLETED. A stuck, stopped or incomplete run's floor time includes waiting where it stopped. */
  finished: boolean;
  status: string;
  squareFeet: number | null;
  errorText: string | null;
}

export interface RunTimeSummary {
  /** Oldest first, at most RUN_TIMES_SHOWN. */
  bars: RunTimeBar[];
  /** The median cleaning time of the finished cleans charted; null with fewer than TYPICAL_MIN_CLEANS. */
  typicalCleaning: number | null;
  finished: number;
  /** Finished cleans that docked to recharge partway. */
  recharged: number;
  /** False starts left out, among the runs the chart spans. */
  falseStarts: number;
  /** The newest run, when the cloud hasn't confirmed its times yet (it has no split to chart). */
  pending: RoombaRun | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The chart's bars from the run history (newest first). Only runs the cloud has confirmed are
 * charted: an unconfirmed row has no recharge or pause split (and is written early while the
 * robot recharges). False starts under FALSE_START_MINUTES are counted, not drawn.
 */
export function runTimeSummary(runs: readonly RoombaRun[], max = RUN_TIMES_SHOWN): RunTimeSummary {
  const bars: RunTimeBar[] = [];
  let falseStarts = 0;
  for (const run of runs) {
    if (bars.length >= max) break;
    if (!run.verified || run.durationMinutes == null || !Number.isFinite(run.durationMinutes)) continue;
    if (run.durationMinutes < FALSE_START_MINUTES) {
      falseStarts++;
      continue;
    }
    const charging = Math.max(0, run.chargeMinutes ?? 0);
    const paused = Math.max(0, run.pauseMinutes ?? 0);
    const floor = Math.max(0, run.durationMinutes - charging - paused);
    bars.push({
      id: run.id,
      startedAt: run.startedAt,
      floor,
      charging,
      paused,
      total: floor + charging + paused,
      finished: run.status === 'COMPLETED',
      status: run.status,
      squareFeet: run.squareFeet,
      errorText: run.errorText,
    });
  }
  bars.reverse();
  const done = bars.filter((b) => b.finished);
  return {
    bars,
    typicalCleaning: done.length >= TYPICAL_MIN_CLEANS ? median(done.map((b) => b.floor)) : null,
    finished: done.length,
    recharged: done.filter((b) => b.charging > 0).length,
    falseStarts,
    pending: runs[0] && !runs[0].verified ? runs[0] : null,
  };
}

/** Even y-axis steps in minutes (15 min up to 4 hr) for a tallest bar of `maxMinutes`. */
export function minuteTicks(maxMinutes: number): number[] {
  const max = Math.max(1, maxMinutes);
  const step = max <= 60 ? 15 : max <= 120 ? 30 : max <= 300 ? 60 : max <= 720 ? 120 : 240;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}
