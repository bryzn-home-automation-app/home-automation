import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
    { userId: 1, name: 'Bryan', home: true, since: now, lastSeen: now, devices: 1 },
    { userId: 2, name: 'Kimstabun', home: false, since: null, lastSeen: hourAgo, devices: 1 },
  ],
  devices: [
    { id: 1, mac: '5e:cb:e7:41:80:1a', ip: '192.168.4.34', name: "Bryan's iPhone", type: 'MOBILE', ownerUserId: 1,
      owner: 'Bryan', privateAddress: true, home: true, firstSeen: hourAgo, lastSeen: now, presentSince: now },
    { id: 2, mac: '22:6f:c5:f4:2c:a6', ip: '192.168.4.27', name: null, type: null, ownerUserId: null, owner: null,
      privateAddress: true, home: true, firstSeen: hourAgo, lastSeen: now, presentSince: hourAgo },
    { id: 3, mac: '90:bf:d9:b1:d4:44', ip: '192.168.4.73', name: null, type: null, ownerUserId: null, owner: null,
      privateAddress: false, home: false, firstSeen: hourAgo, lastSeen: hourAgo, presentSince: hourAgo },
  ],
  members: [{ id: 1, name: 'Bryan' }, { id: 2, name: 'Kimstabun' }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter><WhosHome /></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}

describe("Who's home", () => {
  beforeEach(() => {
    vi.mocked(presenceApi.fetchPresence).mockResolvedValue(PRESENCE);
    vi.mocked(presenceApi.labelDevice).mockClear();
  });

  it('shows each member as home or away, in words', async () => {
    renderPage();
    expect(await screen.findByText('Bryan is home. Kimstabun is out.')).toBeInTheDocument();
    const board = screen.getByRole('list', { name: "Who's home now" });
    expect(board).toHaveTextContent(/Bryan\s*Home\s*Since/);
    expect(board).toHaveTextContent(/Kimstabun\s*Away\s*Last seen 1 hr ago/);
    expect(screen.getByText(/Checked just now · 2 on Wi-Fi/)).toBeInTheDocument();
    expect(screen.getByText('· Mobile · Bryan')).toBeInTheDocument();
  });

  it('counts the unnamed devices both ways, so the heading matches the list (B-186)', async () => {
    renderPage();
    expect(await screen.findByText('Unnamed · 1 on Wi-Fi · 2 total')).toBeInTheDocument();
  });

  it('hides unlabeled devices that are off the Wi-Fi until asked', async () => {
    renderPage();
    expect(await screen.findByText('22:6f:c5:f4:2c:a6 · 192.168.4.27')).toBeInTheDocument();
    expect(screen.queryByText(/90:bf:d9:b1:d4:44/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Include ones not on Wi-Fi now'));
    expect(screen.getByText(/90:bf:d9:b1:d4:44/)).toBeInTheDocument();
  });

  it('labels a device with a name, a type and an owner picked from the members', async () => {
    renderPage();
    await screen.findByText('22:6f:c5:f4:2c:a6 · 192.168.4.27');
    fireEvent.click(screen.getAllByRole('button', { name: 'Label' })[0]);

    // A private address starts as Mobile.
    expect(screen.getByLabelText('Type')).toHaveValue('MOBILE');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: "Kim's Watch" } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'WATCH' } });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(presenceApi.labelDevice).toHaveBeenCalledWith(2, "Kim's Watch", 'WATCH', 2));
  });

  it('warns that a computer does not count toward its owner being home', async () => {
    renderPage();
    await screen.findByText('22:6f:c5:f4:2c:a6 · 192.168.4.27');
    fireEvent.click(screen.getAllByRole('button', { name: 'Label' })[0]);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'COMPUTER' } });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '1' } });
    expect(screen.getByText(/Only mobiles and watches count/)).toBeInTheDocument();
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
    expect(screen.getByText("Can't tell who's home: the Wi-Fi scanner is offline.")).toBeInTheDocument();
    expect(screen.getAllByText('Scanner offline')).toHaveLength(2);
    expect(screen.getAllByText('Unknown', { selector: '.fp-label' })).toHaveLength(2);
  });

  it('keeps the page and its last data when a refresh fails (B-187)', async () => {
    const { client } = renderPage();
    await screen.findByText('Bryan is home. Kimstabun is out.');
    vi.mocked(presenceApi.fetchPresence).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['admin-presence'] });
    });
    expect(await screen.findByText("Couldn't refresh who's home.")).toBeInTheDocument();
    expect(screen.getByText('Bryan is home. Kimstabun is out.')).toBeInTheDocument();
  });

  it('opens Edit with the device as it is now, not as it was when the page loaded (B-185)', async () => {
    const { client } = renderPage();
    await screen.findByText('Bryan is home. Kimstabun is out.');
    vi.mocked(presenceApi.fetchPresence).mockResolvedValue({
      ...PRESENCE,
      devices: PRESENCE.devices.map((d) => (d.id === 1 ? { ...d, ownerUserId: 2, owner: 'Kimstabun' } : d)),
    });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['admin-presence'] });
    });
    await waitFor(() => expect(screen.getByText('· Mobile · Kimstabun')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Owner')).toHaveValue('2');
  });
});
