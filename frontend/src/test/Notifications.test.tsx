import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as notificationsApi from '../api/notifications';
import type { Notification } from '../api/notifications';

vi.mock('../api/notifications', () => ({
  fetchNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

const ROOMBA_NOTIFS: Notification[] = [
  {
    id: 1,
    userId: 1,
    category: 'ROOMBA',
    severity: 'SUCCESS',
    title: 'Cleaning complete — #42',
    message: 'Cleaned 250 sq ft in 42 min.',
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    userId: 1,
    category: 'ROOMBA',
    severity: 'CRITICAL',
    title: 'Roomba error — Roomba is stuck',
    message: 'The robot reported: Roomba is stuck. It may be stuck and need a hand to continue.',
    isRead: false,
    createdAt: new Date().toISOString(),
  },
];

const ELECTRIC_NOTIF: Notification = {
  id: 3,
  userId: 1,
  category: 'ELECTRICAL',
  severity: 'INFO',
  title: 'Daily usage report for 08/22/2026',
  message: '35.0 kWh from 24 hourly readings.',
  isRead: false,
  createdAt: new Date().toISOString(),
};

async function renderNotifications() {
  const { default: Notifications } = await import('../pages/Notifications');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <Notifications />
    </QueryClientProvider>,
  );
}

describe('Notifications page — Roomba', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Roomba notifications with the 🤖 category label and severities', async () => {
    (notificationsApi.fetchNotifications as any).mockResolvedValue([...ROOMBA_NOTIFS, ELECTRIC_NOTIF]);
    await renderNotifications();

    await waitFor(() => expect(screen.getByText('Cleaning complete — #42')).toBeInTheDocument());
    expect(screen.getByText('Cleaned 250 sq ft in 42 min.')).toBeInTheDocument();
    expect(screen.getByText('Roomba error — Roomba is stuck')).toBeInTheDocument();
    // Roomba category label is shown on each Roomba row.
    expect(screen.getAllByText(/Roomba/).length).toBeGreaterThan(0);
    // SUCCESS + CRITICAL severity chips render for the Roomba rows.
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });

  it('filters to only Roomba notifications when the Roomba category pill is clicked', async () => {
    (notificationsApi.fetchNotifications as any).mockImplementation((params?: { category?: string }) =>
      Promise.resolve(
        params?.category === 'ROOMBA'
          ? ROOMBA_NOTIFS
          : [...ROOMBA_NOTIFS, ELECTRIC_NOTIF],
      ),
    );
    await renderNotifications();

    await waitFor(() => expect(screen.getByText('Daily usage report for 08/22/2026')).toBeInTheDocument());

    // Click the Roomba category filter pill.
    fireEvent.click(screen.getByRole('button', { name: /Roomba/i }));

    // The query re-fires scoped to the ROOMBA category.
    await waitFor(() =>
      expect(notificationsApi.fetchNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'ROOMBA' }),
      ),
    );
    // Electric notification is gone; Roomba ones remain.
    await waitFor(() =>
      expect(screen.queryByText('Daily usage report for 08/22/2026')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Cleaning complete — #42')).toBeInTheDocument();
  });
});
