import api from './client';
import type { CoservBill } from '../types';

export async function fetchCoservBills(): Promise<CoservBill[]> {
  const { data } = await api.get('/coserv-bills');
  return data;
}

/**
 * A stored bill PDF (CoServ or water) by its `pdfPath`. Fetched through the API
 * so it carries the member's session — the files aren't publicly served.
 */
export async function fetchBillPdf(pdfPath: string): Promise<ArrayBuffer> {
  const res = await api.get<ArrayBuffer>('/bills/file', {
    params: { path: pdfPath },
    responseType: 'arraybuffer',
    timeout: 60_000,
  });
  return res.data;
}
