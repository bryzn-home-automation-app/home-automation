import api from './client';
import type {
  GeoFeatureCollection,
  RoombaCommand,
  RoombaDevice,
  RoombaMap,
  RoombaPosition,
  RoombaRun,
  RoombaStatus,
} from '../types';

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

/**
 * Live robot position for the map dot, or null when there's no fresh fix
 * (204 = none/stale). Poll this only while the robot is running.
 */
export async function fetchRoombaPosition(): Promise<RoombaPosition | null> {
  const res = await api.get<RoombaPosition | ''>('/roomba/position');
  if (isNoContent(res.status, res.data)) return null;
  return res.data as RoombaPosition;
}

/** Live cleaning-coverage for the map overlay. Features carry an operatingModes
 *  property ("vacuuming" = cleaned, "traveling" = passed through). Null when
 *  stale/none (204). Poll only while the robot is running. */
export interface RoombaCoverage {
  robotId: string;
  missionId: string | null;
  coverage: GeoFeatureCollection;
  updatedAt: string;
}
export async function fetchRoombaCoverage(): Promise<RoombaCoverage | null> {
  const res = await api.get<RoombaCoverage | ''>('/roomba/coverage');
  if (isNoContent(res.status, res.data)) return null;
  return res.data as RoombaCoverage;
}

/** Static device identity + firmware, or null until the poller syncs it. */
export async function fetchRoombaDevice(): Promise<RoombaDevice | null> {
  const res = await api.get<RoombaDevice | ''>('/roomba/device');
  if (isNoContent(res.status, res.data)) return null;
  return res.data as RoombaDevice;
}

/** Enqueue a control command (ADMIN only). `arg` carries the favorite id. */
export async function sendRoombaCommand(command: string, arg?: string): Promise<RoombaCommand> {
  const res = await api.post<RoombaCommand>('/admin/roomba/command', { command, arg });
  return res.data;
}

/** Recent control commands + their status (ADMIN only). */
export async function fetchRoombaCommands(): Promise<RoombaCommand[]> {
  const res = await api.get<RoombaCommand[]>('/admin/roomba/commands');
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Rename a mapped room, optionally setting its category (ADMIN only). Queued for
 * the poller to apply via the robot's map-edit API — the floor plan updates once
 * the poller re-fetches the map bundle (within ~a minute). Returns the queued command.
 */
export async function renameRoombaRoom(
  roomId: string,
  name?: string,
  roomType?: string,
): Promise<RoombaCommand> {
  const res = await api.post<RoombaCommand>('/admin/roomba/rooms/rename', {
    roomId,
    name,
    roomType,
  });
  return res.data;
}

/**
 * Divide a mapped room in two along a line (ADMIN only). `points` are [x, y]
 * pairs in the map's meter space (the endpoints of the divide line). EXPERIMENTAL
 * — never validated on hardware and not cleanly reversible; the caller confirms first.
 */
export async function splitRoombaRoom(
  roomId: string,
  points: number[][],
): Promise<RoombaCommand> {
  const res = await api.post<RoombaCommand>('/admin/roomba/rooms/split', {
    roomId,
    points,
  });
  return res.data;
}

/**
 * Combine two or more mapped rooms into one (ADMIN only) — the inverse of a
 * divide. EXPERIMENTAL / not cleanly reversible; the caller confirms first.
 */
export async function mergeRoombaRooms(roomIds: string[]): Promise<RoombaCommand> {
  const res = await api.post<RoombaCommand>('/admin/roomba/rooms/merge', { roomIds });
  return res.data;
}

/**
 * Clean one specific room (ADMIN only), with optional suction level
 * (low|medium|high|turbo), passes (one|two), and operating mode
 * (vacuum|mop|vacmop, Combo only). Confirmed working on the Combo 105.
 */
export async function cleanRoombaRoom(
  roomId: string,
  suction?: string,
  passes?: string,
  mode?: string,
): Promise<RoombaCommand> {
  const res = await api.post<RoombaCommand>('/admin/roomba/rooms/clean', {
    roomId,
    suction,
    passes,
    mode,
  });
  return res.data;
}

/**
 * Clean a set of rooms (ADMIN only) with optional suction/passes/mode — pass
 * every mapped room id to clean everything, or a subset to clean a selection.
 * Same confirmed region-clean mechanism as {@link cleanRoombaRoom}, over N rooms.
 */
export async function cleanRoombaRooms(
  roomIds: string[],
  suction?: string,
  passes?: string,
  mode?: string,
): Promise<RoombaCommand> {
  const res = await api.post<RoombaCommand>('/admin/roomba/clean', {
    roomIds,
    suction,
    passes,
    mode,
  });
  return res.data;
}
