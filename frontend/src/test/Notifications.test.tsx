import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as notificationsApi from '../api/notifications';
import type { Notification } from '../api/notifications';

vi.mock('../api/notifications', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
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
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Notifications />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Notifications page — Roomba', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (notificationsApi.fetchUnreadCount as any).mockResolvedValue(3);
    (notificationsApi.markRead as any).mockResolvedValue({ updated: 1, unread: 2 });
  });

  it('renders Roomba notifications with their category and plain severity words', async () => {
    (notificationsApi.fetchNotifications as any).mockResolvedValue([...ROOMBA_NOTIFS, ELECTRIC_NOTIF]);
    await renderNotifications();

    await waitFor(() => expect(screen.getByText('Cleaning complete — #42')).toBeInTheDocument());
    expect(screen.getByText('Roomba error — Roomba is stuck')).toBeInTheDocument();
    // Roomba category label is shown on each Roomba row.
    expect(screen.getAllByText(/Roomba/).length).toBeGreaterThan(0);
    // SUCCESS + CRITICAL read as words people use, not enum names.
    expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Problem').length).toBeGreaterThan(0);
    expect(screen.queryByText('SUCCESS')).toBeNull();
  });

  it('opens an alert to read its whole message, and marks it read (B-025)', async () => {
    (notificationsApi.fetchNotifications as any).mockResolvedValue(ROOMBA_NOTIFS);
    await renderNotifications();

    const row = await screen.findByRole('button', { name: /Cleaning complete — #42/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Cleaned 250 sq ft in 42 min.')).not.toBeVisible();
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Cleaned 250 sq ft in 42 min.')).toBeVisible();
    await waitFor(() => expect(notificationsApi.markRead).toHaveBeenCalledWith(1));
  });

  it('counts every unread alert, not just the filtered page (B-026)', async () => {
    (notificationsApi.fetchNotifications as any).mockResolvedValue([ELECTRIC_NOTIF]);
    (notificationsApi.fetchUnreadCount as any).mockResolvedValue(7);
    await renderNotifications();

    expect(await screen.findByRole('button', { name: 'Mark all 7 read' })).toBeEnabled();
    expect(screen.getByText('7 unread alerts.')).toBeInTheDocument();
  });

  it('says nothing matches, with a way back, when a filter empties the list (B-004)', async () => {
    (notificationsApi.fetchNotifications as any).mockImplementation((params?: { category?: string }) =>
      Promise.resolve(params?.category === 'WEATHER' ? [] : ROOMBA_NOTIFS),
    );
    await renderNotifications();
    await screen.findByText('Cleaning complete — #42');

    fireEvent.click(screen.getByRole('button', { name: /^\S*\s*Weather$/ }));
    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument();
    expect(screen.queryByText('No alerts yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Cleaning complete — #42')).toBeInTheDocument();
  });

  it('says the load failed instead of claiming there are no alerts (B-005)', async () => {
    (notificationsApi.fetchNotifications as any).mockRejectedValue(new Error('down'));
    await renderNotifications();
    expect(await screen.findByText("Couldn't load your alerts")).toBeInTheDocument();
    expect(screen.queryByText('No alerts yet')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: /^\S*\s*Roomba$/ }));

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
