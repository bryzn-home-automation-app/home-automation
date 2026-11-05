import type { RoombaRun, RoombaStatus } from '../types';

// Run-history + live-state helpers for the Roomba tab, kept free of React so they
// can be unit-tested directly (see src/test/roomba.test.ts).

/**
 * Time actually spent cleaning: the run's start-to-finish time less the stops
 * docked to recharge (a whole-house clean here is ~4 h of cleaning spread over
 * ~11 h). Null for a missing or glitched (>24 h, unconfirmed) duration.
 */
export function cleaningMinutes(run: Pick<RoombaRun, 'durationMinutes' | 'chargeMinutes' | 'verified'>): number | null {
  const total = run.durationMinutes;
  if (total == null || !Number.isFinite(total)) return null;
  // The poller's own rows once ran to 12 h when a stuck robot sat unnoticed;
  // the cloud's figures don't, so only unconfirmed rows get the guard.
  if (!run.verified && total > 1440) return null;
  return Math.max(0, total - (run.chargeMinutes ?? 0));
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
