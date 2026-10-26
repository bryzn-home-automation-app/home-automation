import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Presence } from '../types';

vi.mock('../api/presence', () => ({
  fetchPresence: vi.fn(),
  labelDevice: vi.fn().mockResolvedValue(undefined),
}));

import * as presenceApi from '../api/presence';
import WhosHome from '../pages/admin/WhosHome';

const now = new Date().toISOString();
const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

const PRESENCE: Presence = {
  scanner: { lastScanAt: now, online: true, devicesInLastScan: 2 },
  awayAfterMinutes: 15,
  people: [
    { name: 'Bryan', home: true, since: now, lastSeen: now, devices: 1 },
    { name: 'Alex', home: false, since: null, lastSeen: hourAgo, devices: 1 },
  ],
  devices: [
    { id: 1, mac: '5e:cb:e7:41:80:1a', ip: '192.168.4.34', label: "Bryan's iPhone", person: 'Bryan', privateAddress: true,
      home: true, firstSeen: hourAgo, lastSeen: now, presentSince: now },
    { id: 2, mac: '22:6f:c5:f4:2c:a6', ip: '192.168.4.27', label: null, person: null, privateAddress: true,
      home: true, firstSeen: hourAgo, lastSeen: now, presentSince: hourAgo },
    { id: 3, mac: '90:bf:d9:b1:d4:44', ip: '192.168.4.73', label: null, person: null, privateAddress: false,
      home: false, firstSeen: hourAgo, lastSeen: hourAgo, presentSince: hourAgo },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WhosHome /></QueryClientProvider>);
}

describe("Who's home", () => {
  beforeEach(() => {
    vi.mocked(presenceApi.fetchPresence).mockResolvedValue(PRESENCE);
    vi.mocked(presenceApi.labelDevice).mockClear();
  });

  it('shows each person as home or away, in words', async () => {
    renderPage();
    expect(await screen.findByText('Bryan')).toBeInTheDocument();
    expect(screen.getByText(/^Home since/)).toBeInTheDocument();
    expect(screen.getByText('Away · last seen 1 hr ago')).toBeInTheDocument();
    expect(screen.getByText(/Checked just now · 2 on Wi-Fi/)).toBeInTheDocument();
  });

  it('hides unlabeled devices that are off the Wi-Fi until asked', async () => {
    renderPage();
    expect(await screen.findByText('22:6f:c5:f4:2c:a6 · 192.168.4.27')).toBeInTheDocument();
    expect(screen.queryByText(/90:bf:d9:b1:d4:44/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Include ones not on Wi-Fi now'));
    expect(screen.getByText(/90:bf:d9:b1:d4:44/)).toBeInTheDocument();
  });

  it('labels a device with whose it is', async () => {
    renderPage();
    await screen.findByText('22:6f:c5:f4:2c:a6 · 192.168.4.27');
    fireEvent.click(screen.getByRole('button', { name: 'Label' }));
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: "Alex's Watch" } });
    fireEvent.change(screen.getByLabelText('Whose (counts them as home)'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(presenceApi.labelDevice).toHaveBeenCalledWith(2, "Alex's Watch", 'Alex'));
  });

  it('says presence is unknown while the scanner is offline', async () => {
    vi.mocked(presenceApi.fetchPresence).mockResolvedValue({
      ...PRESENCE,
      scanner: { lastScanAt: hourAgo, online: false, devicesInLastScan: 2 },
      people: PRESENCE.people.map((p) => ({ ...p, home: null })),
      devices: PRESENCE.devices.map((d) => ({ ...d, home: null })),
    });
    renderPage();
    expect(await screen.findByText('Scanner offline · last check 1 hr ago')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown — scanner offline')).toHaveLength(2);
  });
});
