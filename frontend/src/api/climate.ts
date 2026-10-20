import axios from 'axios';
import api from './client';
import type { Thermostat, ThermostatReading } from '../types';

/** All enabled thermostats, by name. 503 when Home Assistant isn't connected. */
export async function fetchThermostats(): Promise<Thermostat[]> {
  const res = await api.get<Thermostat[]>('/home/thermostats');
  return Array.isArray(res.data) ? res.data : [];
}

/** Stored readings for the last `hours`, oldest first (backend caps the range). */
export async function fetchThermostatHistory(id: string, hours: number): Promise<ThermostatReading[]> {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3_600_000);
  const res = await api.get<ThermostatReading[]>(`/home/thermostats/${encodeURIComponent(id)}/history`, {
    params: { from: from.toISOString(), to: to.toISOString() },
  });
  return Array.isArray(res.data) ? res.data : [];
}

// Commands (USER/ADMIN). Each returns the stored state, which can trail the real
// thermostat by a few seconds — the WebSocket ingest updates it once HA reports
// the change, so callers refetch shortly after instead of trusting the response.

export async function setThermostatMode(id: string, mode: string): Promise<Thermostat> {
  const res = await api.post<Thermostat>(`/home/thermostats/${encodeURIComponent(id)}/mode`, { mode });
  return res.data;
}

/** Either a single `temperature` (heat/cool) or a `low`/`high` range (heat_cool). */
export async function setThermostatTemperature(
  id: string,
  target: { temperature: number } | { low: number; high: number },
): Promise<Thermostat> {
  const res = await api.post<Thermostat>(`/home/thermostats/${encodeURIComponent(id)}/temperature`, target);
  return res.data;
}

/** Hold a comfort setting (one of the thermostat's presetModes). */
export async function holdThermostat(id: string, preset: string): Promise<Thermostat> {
  const res = await api.post<Thermostat>(`/home/thermostats/${encodeURIComponent(id)}/hold`, { preset });
  return res.data;
}

/** Cancel any hold and go back to the thermostat's schedule. */
export async function resumeThermostat(id: string): Promise<Thermostat> {
  const res = await api.post<Thermostat>(`/home/thermostats/${encodeURIComponent(id)}/resume`);
  return res.data;
}

/** Re-scan Home Assistant for thermostats/cameras (ADMIN only). */
export async function discoverHomeDevices(): Promise<void> {
  await api.post('/admin/home/discover');
}

/** HTTP status of a failed request, or null for network errors / non-axios errors. */
export function errorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? err.response?.status ?? null : null;
}

/** The backend's `{ error }` message when present, else a generic fallback. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: unknown } | undefined;
    if (body && typeof body.error === 'string' && body.error) return body.error;
    if (!err.response) return 'Network error — is the server reachable?';
  }
  return fallback;
}
