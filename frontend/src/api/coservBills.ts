import api from './client';
import type { CoservBill } from '../types';

export async function fetchCoservBills(): Promise<CoservBill[]> {
  const { data } = await api.get('/coserv-bills');
  return data;
}
