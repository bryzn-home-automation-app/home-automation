import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { ReactNode } from 'react';
import * as authApi from '../api/auth';
import type { AdminUser } from '../api/auth';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return { ...actual, guestLogin: vi.fn(), uploadAvatar: vi.fn() };
});

function wrap(ui: ReactNode, path = '/guest') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function user(id: number, name: string, role: string, isOnline: boolean): AdminUser {
  return {
    id, email: `${name.toLowerCase()}@home`, username: name.toLowerCase(), displayName: name, role,
    status: 'ACTIVE', lastLoginAt: null, loginCount: 1, createdAt: '2026-01-01', approvedAt: null,
    isOnline, avatarUrl: null, accentColor: '#34d399', lastActiveAt: null,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // jsdom has no object URLs.
  (URL as any).createObjectURL = vi.fn(() => 'blob:preview');
  (URL as any).revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('Guest sign-in', () => {
  it('checks in, then uploads the picked photo with the new guest token (B-033)', async () => {
    (authApi.guestLogin as any).mockResolvedValue({ token: 'GUEST-T', displayName: 'Alex', userId: 9, username: 'alex', role: 'GUEST' });
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { avatarUrl: '/uploads/a.png' } });
    const put = vi.spyOn(axios, 'put').mockResolvedValue({ data: {} });
    const { default: GuestLogin } = await import('../pages/GuestLogin');
    const { container } = wrap(<GuestLogin />);

    const file = new File(['x'], 'me.png', { type: 'image/png' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    // Nothing is uploaded before there is a session.
    expect(post).not.toHaveBeenCalled();
    expect(authApi.uploadAvatar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }));

    expect(await screen.findByText(/You’re in, Alex/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/upload/avatar', expect.any(FormData), expect.objectContaining({ headers: { Authorization: 'Bearer GUEST-T' } }));
    expect(put).toHaveBeenCalledWith('/api/auth/profile', { avatarUrl: '/uploads/a.png' }, expect.objectContaining({ headers: { Authorization: 'Bearer GUEST-T' } }));
    expect(sessionStorage.getItem('guestAvatar')).toBe('/uploads/a.png');
    // The shared sign-in key is never written by the guest flow.
    expect(localStorage.getItem('auth_token')).toBeNull();
    // No false promise that the homeowner was notified (B-168).
    expect(screen.queryByText(/has been notified/)).not.toBeInTheDocument();
  });

  it('lets the same photo be picked again (B-161) and names the photo key (B-160)', async () => {
    const { default: GuestLogin } = await import('../pages/GuestLogin');
    const { container } = wrap(<GuestLogin />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
  });

  it('announces a bad invite code (B-060)', async () => {
    (authApi.guestLogin as any).mockRejectedValue({ response: { data: { error: 'That invite code is not valid.' } } });
    const { default: GuestLogin } = await import('../pages/GuestLogin');
    wrap(<GuestLogin />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That invite code is not valid.');
  });

  it('colours are a named group of toggles, and the key stays ink whatever colour is picked (B-160, B-167)', async () => {
    const { default: GuestLogin } = await import('../pages/GuestLogin');
    wrap(<GuestLogin />);
    const group = screen.getByRole('group', { name: 'Your colour' });
    fireEvent.click(within(group).getByRole('button', { name: 'Lime' }));
    expect(within(group).getByRole('button', { name: 'Lime' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Check in' }).getAttribute('style')).toBeNull();
  });
});

describe('Guest lobby', () => {
  it('shows only real people, with the guest token on its own request (B-032, B-165)', async () => {
    sessionStorage.setItem('guestToken', 'GUEST-T');
    sessionStorage.setItem('guestName', 'Alex');
    localStorage.setItem('auth_token', 'ADMIN-T');
    const get = vi.spyOn(axios, 'get').mockResolvedValue({
      data: [user(1, 'Bryan', 'ADMIN', true), user(2, 'Mai', 'USER', false), user(9, 'Alex', 'GUEST', true)],
    });
    const { default: GuestHome } = await import('../pages/GuestHome');
    wrap(<GuestHome />, '/guest/home');

    const list = await screen.findByRole('list', { name: 'People at the house' });
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText(/Guest \d+/)).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/auth/users', expect.objectContaining({ headers: { Authorization: 'Bearer GUEST-T' } }));
    expect(localStorage.getItem('auth_token')).toBe('ADMIN-T');
    // No developer tools or dead keys for visitors (B-030, B-164).
    for (const name of [/move animals/i, /snapshot/i, /invite/i, /settings/i, /join house/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('opens a person in a dialog (B-031)', async () => {
    sessionStorage.setItem('guestToken', 'GUEST-T');
    vi.spyOn(axios, 'get').mockResolvedValue({ data: [user(1, 'Bryan', 'ADMIN', true)] });
    const { default: GuestHome } = await import('../pages/GuestHome');
    wrap(<GuestHome />, '/guest/home');
    fireEvent.click(await screen.findByRole('button', { name: /Bryan/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Bryan' });
    expect(within(dialog).getByText('Admin')).toBeInTheDocument();
    expect(within(dialog).getByText('Online now')).toBeInTheDocument();
  });

  it('without a guest session shows the way in, not a made-up room (B-032)', async () => {
    const get = vi.spyOn(axios, 'get');
    const { default: GuestHome } = await import('../pages/GuestHome');
    wrap(<GuestHome />, '/guest/home');
    expect(screen.getByRole('link', { name: /check in as a guest/i })).toHaveAttribute('href', '/guest');
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps Bryan as the chicken and gives everyone a different animal', async () => {
    const { lobbyAnimals } = await import('../pages/GuestHome');
    const people = [user(5, 'Mai', 'USER', true), user(1, 'Bryan', 'ADMIN', true), user(7, 'Linh', 'USER', false)];
    const map = lobbyAnimals(people);
    expect(map.get(1)?.key).toBe('chicken');
    expect(new Set([...map.values()].map((a) => a.key)).size).toBe(3);
  });

  it('says when the guest pass has ended', async () => {
    sessionStorage.setItem('guestToken', 'OLD');
    vi.spyOn(axios, 'get').mockRejectedValue({ response: { status: 401 } });
    const { default: GuestHome } = await import('../pages/GuestHome');
    wrap(<GuestHome />, '/guest/home');
    await waitFor(() => expect(screen.getAllByText('Your guest pass has ended.').length).toBeGreaterThan(0));
    expect(screen.getByRole('link', { name: /check in again/i })).toHaveAttribute('href', '/guest');
  });
});
