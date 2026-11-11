import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUser } from '../api/auth';
import * as authApi from '../api/auth';

const state = { isAdmin: true, userId: 1 };
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAdmin: state.isAdmin, isGuest: false, user: { userId: state.userId, role: state.isAdmin ? 'ADMIN' : 'USER' } }),
}));
vi.mock('../api/auth', () => ({
  fetchAllUsers: vi.fn(),
  fetchPendingUsers: vi.fn(),
  approveUser: vi.fn(),
  denyUser: vi.fn(),
  updateUserRole: vi.fn(),
  disableUser: vi.fn(),
  reactivateUser: vi.fn(),
  fetchBirthdays: vi.fn(),
  setBirthday: vi.fn(),
  oidcConfig: vi.fn(),
}));

import UserManagement, { householdOf, visibleEmail } from '../pages/admin/UserManagement';

function user(over: Partial<AdminUser>): AdminUser {
  return {
    id: 1, email: 'bryan@example.com', username: 'bryan', displayName: 'Bryan', role: 'ADMIN', status: 'ACTIVE',
    lastLoginAt: null, loginCount: 3, createdAt: '2026-08-22T10:00:00Z', approvedAt: null, isOnline: true,
    avatarUrl: null, accentColor: null, ...over,
  };
}

const USERS: AdminUser[] = [
  user({}),
  user({ id: 2, email: 'mai@example.com', username: 'mai', displayName: 'Mai', role: 'USER' }),
  user({ id: 3, email: 'guest_alex@guest.local', username: 'guest_alex', displayName: 'Alex', role: 'GUEST' }),
  user({ id: 4, email: 'kim@example.com', username: 'kim', displayName: 'Kim', role: 'USER', status: 'DISABLED', isOnline: false }),
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <UserManagement />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('People helpers', () => {
  it('counts only active members and admins as the household (B-184)', () => {
    expect(householdOf(USERS).map((u) => u.displayName)).toEqual(['Bryan', 'Mai']);
  });

  it('shows email to admins only, and never the guest placeholder (B-182)', () => {
    expect(visibleEmail(USERS[1], true)).toBe('mai@example.com');
    expect(visibleEmail(USERS[1], false)).toBeNull();
    expect(visibleEmail(USERS[2], true)).toBeNull();
  });
});

describe('People page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isAdmin = true;
    (authApi.fetchAllUsers as any).mockResolvedValue(USERS);
    (authApi.fetchPendingUsers as any).mockResolvedValue([]);
    (authApi.updateUserRole as any).mockResolvedValue(USERS[1]);
    (authApi.fetchBirthdays as any).mockResolvedValue([]);
    (authApi.oidcConfig as any).mockResolvedValue({ enabled: true, passwordLogin: false, passwordReset: true, passwordMinLength: 8 });
  });

  it('never offers an admin the controls for their own account (B-181)', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Manage Mai' });
    expect(screen.queryByRole('button', { name: 'Manage Bryan' })).toBeNull();
  });

  it('a role change waits for Save, and making an admin asks first', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Mai' }));
    const dialog = await screen.findByRole('dialog', { name: 'Manage Mai' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Admin' }));
    expect(authApi.updateUserRole).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Make Mai an admin?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Make admin' }));
    await waitFor(() => expect(authApi.updateUserRole).toHaveBeenCalledWith(2, 'ADMIN'));
  });

  it('turning an account off is confirmed first', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Mai' }));
    fireEvent.click(await screen.findByRole('button', { name: "Turn off Mai's account" }));
    expect(await screen.findByRole('alertdialog', { name: "Turn off Mai's account?" })).toBeInTheDocument();
    expect(authApi.disableUser).not.toHaveBeenCalled();
  });

  it('members see no emails, no manage keys and no sign-up inbox', async () => {
    state.isAdmin = false;
    renderPage();
    await screen.findAllByText('Mai');
    expect(screen.queryByText(/mai@example\.com/)).toBeNull();
    expect(screen.queryByText(/guest\.local/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Manage / })).toBeNull();
    expect(screen.queryByText('Asked to join')).toBeNull();
  });

  describe('Forgot-password birthdays (made-up dates)', () => {
    it("an admin saves a member's birthday from month/day/year pickers", async () => {
      (authApi.setBirthday as any).mockResolvedValue({ userId: 2, birthDate: '1990-03-04' });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Manage Mai' }));
      const dialog = await screen.findByRole('dialog', { name: 'Manage Mai' });
      expect(within(dialog).getByText(/Save Mai's birthday so they can choose a new Home password/)).toBeInTheDocument();
      expect(within(dialog).queryByText('Password reset is switched off.')).toBeNull();
      const save = within(dialog).getByRole('button', { name: 'Save birthday' });
      expect(save).toBeDisabled();

      fireEvent.change(within(dialog).getByLabelText('Month'), { target: { value: '3' } });
      fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '4' } });
      fireEvent.change(within(dialog).getByLabelText('Year'), { target: { value: '1990' } });
      fireEvent.click(save);
      await waitFor(() => expect(authApi.setBirthday).toHaveBeenCalledWith(2, '1990-03-04'));
      expect(await within(dialog).findByText('Saved.')).toBeInTheDocument();
    });

    it('shows a stored birthday to the admin, marks the member in the roster, and clears it', async () => {
      (authApi.fetchBirthdays as any).mockResolvedValue([{ userId: 2, birthDate: '1990-03-04' }]);
      (authApi.setBirthday as any).mockResolvedValue({ userId: 2, birthDate: null });
      renderPage();
      expect(await screen.findByText(/birthday reset on/)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Manage Mai' }));
      const dialog = await screen.findByRole('dialog', { name: 'Manage Mai' });
      expect(within(dialog).getByText(/with their username and birthday, March 4, 1990/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
      await waitFor(() => expect(authApi.setBirthday).toHaveBeenCalledWith(2, null));
    });

    it('offers no birthday for an admin or guest account', async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      (authApi.fetchAllUsers as any).mockResolvedValue([
        ...USERS,
        user({ id: 5, username: 'pat', displayName: 'Pat', role: 'ADMIN', email: 'pat@example.com' }),
      ]);
      render(<MemoryRouter><QueryClientProvider client={qc}><UserManagement /></QueryClientProvider></MemoryRouter>);
      fireEvent.click(await screen.findByRole('button', { name: 'Manage Pat' }));
      const dialog = await screen.findByRole('dialog', { name: 'Manage Pat' });
      expect(within(dialog).queryByText('Forgot password')).toBeNull();
      expect(within(dialog).queryByLabelText('Month')).toBeNull();
    });

    it('tells the admin when the server has reset switched off, so the link is hidden', async () => {
      (authApi.oidcConfig as any).mockResolvedValue({ enabled: true, passwordLogin: false, passwordReset: false, passwordMinLength: 8 });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Manage Mai' }));
      const dialog = await screen.findByRole('dialog', { name: 'Manage Mai' });
      expect(await within(dialog).findByText('Password reset is switched off.')).toBeInTheDocument();
      expect(within(dialog).getByText(/AUTHELIA_USERS_FILE/)).toBeInTheDocument();
    });

    it('members never load anyone’s birthday', async () => {
      state.isAdmin = false;
      renderPage();
      await screen.findAllByText('Mai');
      expect(authApi.fetchBirthdays).not.toHaveBeenCalled();
      expect(screen.queryByText(/birthday reset on/)).toBeNull();
    });
  });

  it('says the load failed instead of "no users" (B-005)', async () => {
    (authApi.fetchAllUsers as any).mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText("Couldn't load the household.")).toBeInTheDocument();
  });
});
