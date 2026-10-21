import api from './client';

export interface Notification {
  id: number;
  userId: number;
  category: 'ELECTRICAL' | 'GAS' | 'WATER' | 'ROOMBA' | 'CAMERA' | 'WIFI';
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export async function fetchNotifications(params?: {
  category?: string;
  severity?: string;
  unread?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  const { data } = await api.get('/notifications', { params });
  return data;
}

export async function fetchUnreadCount(): Promise<number> {
  const { data } = await api.get('/notifications/unread-count');
  return data.count;
}

export async function markRead(id: number): Promise<{ updated: number; unread: number }> {
  const { data } = await api.post(`/notifications/${id}/read`);
  return data;
}

export async function markAllRead(): Promise<{ updated: number; unread: number }> {
  const { data } = await api.post('/notifications/read-all');
  return data;
}

export async function seedNotifications(): Promise<void> {
  await api.post('/notifications/seed');
}

/** One alert type and whether this member gets it in Alerts (`inApp`) and on their phone (`push`). */
export interface AlertTypePreference {
  type: string;
  category: Notification['category'];
  label: string;
  description: string;
  inApp: boolean;
  push: boolean;
  defaultInApp: boolean;
  defaultPush: boolean;
}

/** Every alert type with this member's settings (members only). */
export async function fetchAlertPreferences(): Promise<AlertTypePreference[]> {
  const res = await api.get<AlertTypePreference[]>('/notifications/preferences');
  return Array.isArray(res.data) ? res.data : [];
}

export async function setAlertPreference(type: string, inApp: boolean, push: boolean): Promise<AlertTypePreference> {
  const res = await api.put<AlertTypePreference>(`/notifications/preferences/${encodeURIComponent(type)}`, { inApp, push });
  return res.data;
}

export async function resetAlertPreferences(): Promise<AlertTypePreference[]> {
  const res = await api.post<AlertTypePreference[]>('/notifications/preferences/reset');
  return Array.isArray(res.data) ? res.data : [];
}
