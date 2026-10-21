import api from './client';
import type { Camera, CameraBatteryHistory } from '../types';

/** Enabled cameras by name (members only). 503 when Home Assistant isn't connected. */
export async function fetchCameras(): Promise<Camera[]> {
  const res = await api.get<Camera[]>('/home/cameras');
  return Array.isArray(res.data) ? res.data : [];
}

/** Battery readings + daylight windows for the last `hours`. */
export async function fetchCameraBattery(id: string, hours: number): Promise<CameraBatteryHistory> {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3_600_000);
  const res = await api.get<CameraBatteryHistory>(`/home/cameras/${encodeURIComponent(id)}/battery`, {
    params: { from: from.toISOString(), to: to.toISOString() },
  });
  return {
    readings: Array.isArray(res.data?.readings) ? res.data.readings : [],
    daylight: Array.isArray(res.data?.daylight) ? res.data.daylight : [],
  };
}

/**
 * The latest still as a Blob. Fetched through axios (not an <img src>) so it
 * carries the JWT; the caller turns it into an object URL.
 */
export async function fetchCameraSnapshot(id: string): Promise<Blob> {
  const res = await api.get<Blob>(`/home/cameras/${encodeURIComponent(id)}/snapshot`, {
    responseType: 'blob',
    timeout: 25_000,
  });
  return res.data;
}

/** A same-origin WebSocket path with a short-lived ticket for this camera's live view. */
export async function startCameraLive(id: string): Promise<{ url: string; expiresAt: string }> {
  const res = await api.post<{ url: string; expiresAt: string }>(`/home/cameras/${encodeURIComponent(id)}/live`);
  return res.data;
}

/** What the live player saw ~8 s in — logged by the backend to debug black tiles. Best-effort. */
export async function reportLiveDiagnostics(id: string, report: Record<string, unknown>): Promise<void> {
  await api.post(`/home/cameras/${encodeURIComponent(id)}/live/diagnostics`, report).catch(() => {});
}
