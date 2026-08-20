import api from './client';
import type { RoombaMap, RoombaRun, RoombaStatus } from '../types';

/**
 * A 204 (No Content) comes back from axios with a 204 status and an empty
 * body (`''`). Treat both as "nothing yet" → null so callers can render an
 * empty state instead of guessing from a falsy body.
 */
function isNoContent(status: number, data: unknown): boolean {
  return status === 204 || data === '' || data == null;
}

/** Latest live snapshot, or null when the poller hasn't written a row yet. */
export async function fetchRoombaStatus(): Promise<RoombaStatus | null> {
  const res = await api.get<RoombaStatus | ''>('/roomba/status');
  if (isNoContent(res.status, res.data)) return null;
  return res.data as RoombaStatus;
}

/** Completed missions, newest first. Empty array for a brand-new robot. */
export async function fetchRoombaRuns(limit = 50): Promise<RoombaRun[]> {
  const res = await api.get<RoombaRun[]>('/roomba/runs', { params: { limit } });
  return Array.isArray(res.data) ? res.data : [];
}

/** Floor-plan map bundle, or null until the robot has built a map. */
export async function fetchRoombaMap(): Promise<RoombaMap | null> {
  const res = await api.get<RoombaMap | ''>('/roomba/map');
  if (isNoContent(res.status, res.data)) return null;
  return res.data as RoombaMap;
}
