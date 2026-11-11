import type { CellState } from '../../components/ui';
import type { Tone } from '../../utils/status';

// Diagnostics' pure helpers, kept out of the page module so tests can reach them.

export interface CoverageDay {
  date: string;
  dailyPresent: boolean;
  hourlyRows: number;
  hourlyNonZero: number;
  hourlyComplete: boolean;
  weatherPresent: boolean;
}

/**
 * Data freshness from its age. Daily/hourly data legitimately lags ~1 day (the meter posts
 * once a day), so "fresh" allows up to ~30 h before flagging.
 */
export function freshnessStatus(ageHours: number | null | undefined): { tone: Tone; label: string } {
  if (ageHours == null) return { tone: 'neutral', label: 'No data' };
  if (ageHours <= 30) return { tone: 'ok', label: 'Fresh' };
  if (ageHours <= 54) return { tone: 'headsup', label: 'Aging' };
  return { tone: 'problem', label: 'Stale' };
}

/** A coverage day as an LED: complete, partial, missing, or today (not posted yet). */
export function coverageState(d: CoverageDay, today: string): CellState {
  if (d.hourlyComplete) return 'ok';
  if (d.hourlyNonZero > 0) return d.date === today ? 'off' : 'warn';
  return d.date === today ? 'off' : 'problem';
}

// ── Date helpers (manual sync range) ────────────────────────────

/** CoServ only keeps ~2 weeks of interval data. */
export const MAX_RANGE_DAYS = 14;

/** "YYYY-MM-DD" `n` days from a home calendar day. */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** The SQL each table shortcut fills in, ordered by the table's real time column (B-176). */
const TIME_COLUMN: Record<string, string> = {
  electric_usage: 'timestamp',
  hourly_electric_usage: 'timestamp',
  gas_usage: 'timestamp',
  app_events: 'timestamp',
  weather_observations: 'observation_date',
  notifications: 'created_at',
  guest_sessions: 'connected_at',
  roomba_runs: 'started_at',
  maintenance_records: 'created_at',
};
export function tablePreset(table: string): string {
  const col = TIME_COLUMN[table];
  return col ? `SELECT * FROM ${table} ORDER BY ${col} DESC LIMIT 20` : `SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 20`;
}
