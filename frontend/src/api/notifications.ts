import api from './client';

export interface Notification {
  id: number;
  userId: number;
  category: 'ELECTRICAL' | 'GAS' | 'WATER' | 'ROOMBA' | 'WIFI';
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
