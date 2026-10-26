import api from './client';
import type { Presence } from '../types';

/** Admins: who's home, from the devices on the home Wi-Fi. */
export async function fetchPresence(): Promise<Presence> {
  const res = await api.get<Presence>('/admin/presence');
  return {
    scanner: res.data?.scanner ?? { lastScanAt: null, online: false, devicesInLastScan: 0 },
    awayAfterMinutes: res.data?.awayAfterMinutes ?? 15,
    people: Array.isArray(res.data?.people) ? res.data.people : [],
    devices: Array.isArray(res.data?.devices) ? res.data.devices : [],
  };
}

/** Name a device and say whose it is; blank clears either. */
export async function labelDevice(id: number, label: string, person: string): Promise<void> {
  await api.patch(`/admin/presence/devices/${id}`, { label, person });
}
