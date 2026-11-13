import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUser, GuestSession } from '../api/auth';
import { deviceLabel } from '../pages/admin/guestDevice';
import { buildActivityLog } from '../pages/admin/activityLog';
import { coverageState, tablePreset } from '../pages/admin/diagnostics';

/*
 * The admin pages' bug fixes that are logic, plus the two pages whose fixes are about what the
 * page says after an action (Guests' "Clear inactive guests", Diagnostics' query console and
 * sync keys).
 */

const user = (over: Partial<AdminUser>): AdminUser => ({
  id: 1, email: 'm@x', username: 'mai', displayName: 'Mai', role: 'USER', status: 'ACTIVE', lastLoginAt: null,
  loginCount: 0, createdAt: '2026-10-01 09:00:00', approvedAt: null, isOnline: false, avatarUrl: null, accentColor: null,
  lastActiveAt: null, ...over,
});

describe('Activity log rows (B-034, B-169)', () => {
  it('stamps an approval at the moment it happened, not at registration', () => {
    const logs = buildActivityLog([user({ approvedAt: '2026-10-03 18:30:00' })], [], []);
    const reg = logs.find((l) => l.id === 'register-1')!;
    const ok = logs.find((l) => l.id === 'approved-1')!;
    expect(reg).toMatchObject({ kind: 'register', timestamp: '2026-10-01 09:00:00', description: 'Mai registered' });
    expect(ok).toMatchObject({ kind: 'approved', timestamp: '2026-10-03 18:30:00', description: 'Mai was approved' });
  });

  it('never calls a guest, an unapproved or a disabled account approved', () => {
    const logs = buildActivityLog([
      user({ id: 2, displayName: 'Alex', role: 'GUEST' }),
      user({ id: 3, displayName: 'Danny', status: 'PENDING_APPROVAL' }),
      user({ id: 4, displayName: 'Old', status: 'DISABLED' }),
    ], [], []);
    expect(logs.filter((l) => l.kind === 'approved')).toHaveLength(0);
    expect(logs.map((l) => l.description)).toEqual(expect.arrayContaining(['Alex joined as a guest', 'Danny asked to join', 'Old registered']));
  });

  it('sorts newest first', () => {
    const logs = buildActivityLog([user({ lastLoginAt: '2026-11-09 08:00:00', approvedAt: '2026-10-03 18:30:00' })], [], []);
    expect(logs.map((l) => l.kind)).toEqual(['login', 'approved', 'register']);
  });
});

describe('Guest devices (B-177)', () => {
  it('names the device and browser instead of the raw string', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toBe('Android phone · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Windows · Edge');
    expect(deviceLabel('')).toBe('Unknown device');
  });
});

describe('Diagnostics helpers', () => {
  it('orders each table shortcut by a column the table has (B-176)', () => {
    expect(tablePreset('notifications')).toBe('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
    expect(tablePreset('weather_observations')).toContain('ORDER BY observation_date DESC');
    expect(tablePreset('guest_sessions')).toContain('ORDER BY connected_at DESC');
    expect(tablePreset('roomba_runs')).toContain('ORDER BY started_at DESC');
    expect(tablePreset('app_events')).toContain('ORDER BY timestamp DESC');
    expect(tablePreset('users')).toBe('SELECT * FROM users ORDER BY 1 DESC LIMIT 20');
  });

  it('reads a coverage day as complete, partial, missing or not yet', () => {
    const day = (date: string, nonZero: number, complete = false) =>
      ({ date, dailyPresent: true, hourlyRows: 24, hourlyNonZero: nonZero, hourlyComplete: complete, weatherPresent: true });
    expect(coverageState(day('2026-11-08', 24, true), '2026-11-09')).toBe('ok');
    expect(coverageState(day('2026-10-28', 9), '2026-11-09')).toBe('warn');
    expect(coverageState(day('2026-10-28', 0), '2026-11-09')).toBe('problem');
    expect(coverageState(day('2026-11-09', 5), '2026-11-09')).toBe('off');
  });
});

// ── Guests ───────────────────────────────────────────────────

vi.mock('../api/auth', async (orig) => ({
  ...(await orig<typeof import('../api/auth')>()),
  fetchGuestSessions: vi.fn(),
  expireGuestSessions: vi.fn(),
}));

import * as authApi from '../api/auth';
import GuestManagement from '../pages/admin/GuestManagement';

const session = (over: Partial<GuestSession>): GuestSession => ({
  id: 1, userId: 9, guestName: 'Alex', ipAddress: '192.168.1.57',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Version/26.1 Mobile/15E148 Safari/604.1',
  connectedAt: new Date(Date.now() - 3_600_000).toISOString(), lastSeenAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 29.5 * 86_400_000).toISOString(), status: 'ACTIVE', connectionCount: 3,
  ...over,
});

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('Guests: clear inactive guests (B-037)', () => {
  beforeEach(() => {
    vi.mocked(authApi.fetchGuestSessions).mockReset().mockResolvedValue([session({})]);
    vi.mocked(authApi.expireGuestSessions).mockReset().mockResolvedValue(undefined);
  });

  it('says what it does, asks first, and says nothing was cleared when nobody was idle', async () => {
    renderWithClient(<GuestManagement />);
    expect(await screen.findByText('Alex is the only guest with access.')).toBeInTheDocument();
    expect(screen.getByText('iPhone · Safari', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear inactive guests' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent("hasn't been seen for 30 days");
    expect(authApi.expireGuestSessions).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear inactive guests' }));
    expect(await screen.findByText('Nothing to clear.')).toBeInTheDocument();
    expect(authApi.expireGuestSessions).toHaveBeenCalledTimes(1);
  });

  it('names who lost access, and says so when the request fails', async () => {
    renderWithClient(<GuestManagement />);
    await screen.findByText('Alex is the only guest with access.');
    vi.mocked(authApi.fetchGuestSessions).mockResolvedValue([session({ status: 'EXPIRED' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear inactive guests' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear inactive guests' }));
    expect(await screen.findByText('Ended access for Alex.')).toBeInTheDocument();

    vi.mocked(authApi.expireGuestSessions).mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear inactive guests' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear inactive guests' }));
    expect(await screen.findByText("Couldn't clear inactive guests.")).toBeInTheDocument();
  });

  it('says a failed first load failed, not "no guests" (B-005)', async () => {
    vi.mocked(authApi.fetchGuestSessions).mockRejectedValue(new Error('offline'));
    renderWithClient(<GuestManagement />);
    expect(await screen.findByText("Couldn't load the guests")).toBeInTheDocument();
    expect(screen.queryByText('No guests have access right now.')).not.toBeInTheDocument();
  });
});

// ── Diagnostics ──────────────────────────────────────────────

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import api from '../api/client';
import DebugDashboard from '../pages/admin/DebugDashboard';

const EVENTS = [
  { id: 1, timestamp: '2026-11-09 09:45:00', category: 'sync', level: 'INFO', source: 'HourlySyncScheduler', message: 'Hourly sync OK', details: null },
  { id: 2, timestamp: '2026-11-09 09:15:00', category: 'weather', level: 'INFO', source: 'WeatherService', message: 'Weather refreshed', details: null },
];

function mockGet(url: string) {
  if (url.includes('/admin/events/summary')) return Promise.resolve({ data: { total24h: 2, errors24h: 0, warns24h: 0 } });
  if (url.includes('/admin/events')) {
    const p = new URLSearchParams(url.split('?')[1]);
    const cat = p.get('category');
    const lvl = p.get('level');
    return Promise.resolve({ data: EVENTS.filter((e) => (!cat || e.category === cat) && (!lvl || e.level === lvl)) });
  }
  if (url.includes('/admin/db/tables')) return Promise.resolve({ data: [{ schema: 'public', name: 'notifications', size: '1 MB', columns: 9 }] });
  if (url.includes('/admin/db/stats')) return Promise.resolve({ data: { rowCounts: {}, dbSizePretty: '53 MB' } });
  return Promise.resolve({ data: null });
}

describe('Diagnostics fixes', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset().mockImplementation(mockGet as never);
    vi.mocked(api.post).mockReset();
  });

  it('shows why a query failed (B-036) and fills table shortcuts with a real column (B-176)', async () => {
    const err = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 500, data: { error: 'ERROR: column "timestamp" does not exist' } },
    });
    vi.mocked(api.post).mockRejectedValue(err);
    renderWithClient(<DebugDashboard />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    fireEvent.click(await screen.findByRole('button', { name: 'notifications' }));
    expect(screen.getByLabelText('SQL')).toHaveValue('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('The query failed.')).toBeInTheDocument();
  });

  it('says when a manual sync fails (B-174)', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('boom'));
    renderWithClient(<DebugDashboard />);
    fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate alerts' }));
    expect(await screen.findByText(/^Failed:/)).toBeInTheDocument();
  });

  it('names its filters, says when a filter matches nothing, and leaves the Sync tab alone (B-004, B-035, B-042)', async () => {
    renderWithClient(<DebugDashboard />);
    fireEvent.click(screen.getByRole('tab', { name: /Events/ }));
    expect(await screen.findByText('Weather refreshed')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'ERROR' } });
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toHaveValue('all');

    fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));
    expect(await screen.findByText('Hourly sync OK')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('No sync runs in the last three days')).not.toBeInTheDocument());
  });
});
