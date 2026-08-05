import api from './client';
import type { Meter } from '../types';

export async function fetchMeters(): Promise<Meter[]> {
  const { data } = await api.get('/meters');
  return data;
}
