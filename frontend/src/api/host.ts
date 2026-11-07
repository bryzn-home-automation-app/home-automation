import api from './client';
import type { HostHealth, HostHistory, HostRange } from '../types';

/** Admins: the NUC's health right now. */
export async function fetchHostHealth(): Promise<HostHealth> {
  const res = await api.get<HostHealth>('/admin/host');
  return {
    status: res.data?.status ?? 'NOT_SET_UP',
    lastReportAt: res.data?.lastReportAt ?? null,
    now: res.data?.now ?? new Date().toISOString(),
    latest: res.data?.latest ?? null,
    checks: Array.isArray(res.data?.checks) ? res.data.checks : [],
    app: res.data?.app ?? null,
  };
}

/** Admins: the NUC's health over the last day, week or month. */
export async function fetchHostHistory(range: HostRange): Promise<HostHistory> {
  const res = await api.get<HostHistory>('/admin/host/history', { params: { range } });
  return {
    ...res.data,
    points: Array.isArray(res.data?.points) ? res.data.points : [],
    gaps: Array.isArray(res.data?.gaps) ? res.data.gaps : [],
  };
}
