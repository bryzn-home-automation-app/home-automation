import api from './client';
import type { DeviceType, Presence } from '../types';

/** Admins: who's home, from the devices on the home Wi-Fi. */
export async function fetchPresence(): Promise<Presence> {
  const res = await api.get<Presence>('/admin/presence');
  return {
    scanner: res.data?.scanner ?? { lastScanAt: null, online: false, devicesInLastScan: 0 },
    awayAfterMinutes: res.data?.awayAfterMinutes ?? 15,
    people: Array.isArray(res.data?.people) ? res.data.people : [],
    devices: Array.isArray(res.data?.devices) ? res.data.devices : [],
    members: Array.isArray(res.data?.members) ? res.data.members : [],
  };
}

/** Name a device, set its type and its owner (a member's id); blank/null clears each. */
export async function labelDevice(id: number, name: string, type: DeviceType | null, ownerUserId: number | null): Promise<void> {
  await api.patch(`/admin/presence/devices/${id}`, { name, type, ownerUserId });
}
