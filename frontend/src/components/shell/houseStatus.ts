/**
 * The strip's "House" lamp, from the shell's /api/health query.
 *
 * It used to read only `data.status === 'UP'`, so it said Offline while the first
 * check was still in flight, and once the server had answered it kept saying
 * Healthy through an outage: a failed refetch keeps the last good data (B-011).
 * So the query's own state decides first, then the answer. The backend answers
 * `{ status: 'UP', database: 'connected' | 'disconnected' }`; an UP server whose
 * database is gone can't load any page, so that counts as a problem too.
 */

export type HouseStatus = 'checking' | 'ok' | 'problem' | 'offline';

export interface HealthQueryLike {
  isPending: boolean;
  isError: boolean;
  data?: { status?: string; database?: string } | null;
}

export function houseStatus(q: HealthQueryLike): HouseStatus {
  if (q.isError) return 'offline';
  if (q.isPending || !q.data) return 'checking';
  if (q.data.status !== 'UP') return 'offline';
  if (q.data.database === 'disconnected') return 'problem';
  return 'ok';
}

/** Lamp, the word on the plate, and the sentence a screen reader hears. */
export const HOUSE_STATUS: Record<HouseStatus, { lamp: string; word: string; spoken: string }> = {
  checking: { lamp: 'fp-lamp', word: 'Checking', spoken: 'checking the home server' },
  ok: { lamp: 'fp-lamp fp-lamp--ok', word: 'OK', spoken: 'OK, the home server is answering' },
  problem: { lamp: 'fp-lamp fp-lamp--problem', word: 'Problem', spoken: "problem, the home server can't reach its database" },
  offline: { lamp: 'fp-lamp fp-lamp--problem', word: 'Offline', spoken: "offline, the home server isn't answering" },
};
