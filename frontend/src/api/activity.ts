import api from './client';
import type { TabUsage } from '../types';

/** A member opened a tab ("view") or spent another active minute on it ("active"). Best-effort. */
export async function recordTab(tab: string, kind: 'view' | 'active'): Promise<void> {
  await api.post('/activity', { tab, kind }).catch(() => {});
}

/** Keep every camera's live stream running for the next ~90 s, so the Cameras tab opens live. Best-effort. */
export async function primeCameras(): Promise<void> {
  await api.post('/home/cameras/prime').catch(() => {});
}

/** Admins: which tabs members used over the last `days`. */
export async function fetchTabUsage(days: number): Promise<TabUsage> {
  const res = await api.get<TabUsage>('/admin/activity', { params: { days } });
  return {
    days: res.data?.days ?? days,
    household: Array.isArray(res.data?.household) ? res.data.household : [],
    members: Array.isArray(res.data?.members) ? res.data.members : [],
  };
}
