import api from './client';

export interface MaintenanceRecord {
  id: number;
  title: string;
  description: string;
  category: string;
  area: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  scheduledDate: string | null;
  startedDate: string | null;
  completedDate: string | null;
  cost: number | null;
  requestedBy: string | null;
  completedBy: string | null;
  contractorName: string | null;
  company: string | null;
  receiptNumber: string | null;
  warrantyExpiration: string | null;
  photosBefore: string | null;
  photosDuring: string | null;
  photosAfter: string | null;
  documents: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRequest {
  title?: string;
  description?: string;
  category?: string;
  area?: string;
  priority?: string;
  status?: string;
  scheduledDate?: string;
  startedDate?: string;
  completedDate?: string;
  cost?: number;
  requestedBy?: string;
  completedBy?: string;
  contractorName?: string;
  company?: string;
  receiptNumber?: string;
  warrantyExpiration?: string;
  photosBefore?: string;
  photosDuring?: string;
  photosAfter?: string;
  documents?: string;
  notes?: string;
}

export interface MaintenanceAnalytics {
  openCount: number;
  scheduledCount: number;
  completedCount: number;
  totalLifetimeCost: number;
  thisYearCost: number;
  averageMonthlyCost: number;
  lastActivity: string;
  lastActivityDate: string;
  costByYear: { year: number; cost: number }[];
  costByCategory: { category: string; cost: number }[];
  topExpensive: { id: number; title: string; cost: number; date: string }[];
}

export async function fetchMaintenanceRecords(params?: {
  category?: string; area?: string; status?: string;
  priority?: string; search?: string; year?: number; limit?: number;
}): Promise<MaintenanceRecord[]> {
  const { data } = await api.get('/maintenance', { params });
  return data;
}

export async function fetchMaintenanceAnalytics(): Promise<MaintenanceAnalytics> {
  const { data } = await api.get('/maintenance/analytics');
  return data;
}

export async function createMaintenanceRecord(req: MaintenanceRequest): Promise<MaintenanceRecord> {
  const { data } = await api.post('/maintenance', req);
  return data;
}

export async function updateMaintenanceRecord(id: number, req: MaintenanceRequest): Promise<MaintenanceRecord> {
  const { data } = await api.put(`/maintenance/${id}`, req);
  return data;
}

export async function deleteMaintenanceRecord(id: number): Promise<void> {
  await api.delete(`/maintenance/${id}`);
}

export async function seedMaintenanceRecords(): Promise<void> {
  await api.post('/maintenance/seed');
}

export async function uploadMaintenanceFile(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/maintenance/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
