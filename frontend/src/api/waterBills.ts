import api from './client';
import type { WaterBill } from '../types';

export async function fetchWaterBills(): Promise<WaterBill[]> {
  const { data } = await api.get('/water-bills');
  return data;
}
