import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import * as authApi from '../api/auth';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return {
    ...actual,
    fetchMe: vi.fn().mockRejectedValue(new Error('no session')),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    // Password form switched back on (the server's emergency switch), so the form tests below run.
    oidcConfig: vi.fn().mockResolvedValue({ enabled: true, passwordLogin: true }),
    oidcExchange: vi.fn(),
  };
});

// Dynamic import to go through Vite
async function renderLogin(path = '/login') {
  const { default: Login } = await import('../pages/Login');
  const result = render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Login />
      </MemoryRouter>
    </AuthProvider>
  );
  // Let the page learn what to offer (oidcConfig) before the test looks.
  await act(async () => { await Promise.resolve(); });
  return result;
}

describe('Login page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should render login form', async () => {
    await renderLogin();

    expect(screen.getByRole('heading', { name: 'Welcome home.' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should show link to register page', async () => {
    await renderLogin();
    expect(screen.getByRole('link', { name: /new to the house/i })).toHaveAttribute('href', '/register');
  });

  it('should show link to guest login', async () => {
    await renderLogin();
    expect(screen.getByRole('link', { name: /sign in as a guest/i })).toHaveAttribute('href', '/guest');
  });

  it("doesn't look pre-filled: no owner's handle or dots as placeholders (B-061)", async () => {
    await renderLogin();
    expect(screen.getByLabelText('Username')).toHaveAttribute('placeholder', 'Your username');
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('placeholder');
  });

  it('should call login API on form submit', async () => {
    (authApi.login as any).mockResolvedValue({
      token: 'jwt',
      userId: 1,
      username: 'test',
      displayName: 'Test',
      role: 'ADMIN',
    });

    await renderLogin();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith({ username: 'admin', password: 'pass' });
    });
  });

  it('uses autofilled values that never fired a change event (iOS Safari)', async () => {
    (authApi.login as any).mockResolvedValue({
      token: 'jwt', userId: 1, username: 'test', displayName: 'Test', role: 'ADMIN',
    });

    await renderLogin();

    (screen.getByLabelText('Username') as HTMLInputElement).value = 'admin';
    (screen.getByLabelText('Password') as HTMLInputElement).value = 'pass';
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith({ username: 'admin', password: 'pass' });
    });
  });

  it('asks for both fields instead of sending an empty login', async () => {
    await renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Enter your username and password.')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('should show error on failed login', async () => {
    (authApi.login as any).mockRejectedValue({
      response: { data: { error: 'Invalid credentials' } },
    });

    await renderLogin();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
    // Announced to screen readers (B-060).
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('returns to the page the guard sent you from (B-058)', async () => {
    (authApi.login as any).mockResolvedValue({ token: 'jwt', userId: 1, username: 'test', displayName: 'Test', role: 'USER' });
    const { default: Login } = await import('../pages/Login');
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/notifications', search: '?id=4', hash: '' } } }]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/notifications" element={<p>Alerts page</p>} />
            <Route path="/" element={<p>Home page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'kim' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Alerts page')).toBeInTheDocument();
  });

  describe('Sign in with Home (SSO)', () => {
    it('swaps the one-time code for a session on return from SSO', async () => {
      (authApi.oidcExchange as any).mockResolvedValue({
        token: 'sso-jwt', userId: 2, username: 'kim', displayName: 'Kim', role: 'USER',
      });

      await renderLogin('/login?sso=1');

      expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
      await waitFor(() => expect(localStorage.getItem('auth_token')).toBe('sso-jwt'));
      expect(authApi.oidcExchange).toHaveBeenCalledTimes(1);
      expect(authApi.oidcExchange).toHaveBeenCalledWith();
    });

    it("shows the server's reason when the code is refused, then the form", async () => {
      (authApi.oidcExchange as any).mockRejectedValue({
        response: { data: { error: 'No home account uses that email. Ask the admin to add you.' } },
      });

      await renderLogin('/login?sso=1');

      expect(await screen.findByText(/No home account uses that email/)).toBeInTheDocument();
      expect(screen.getByLabelText('Username')).toBeInTheDocument();
      expect(localStorage.getItem('auth_token')).toBeNull();
    });

    it('explains an sso_error from the redirect', async () => {
      await renderLogin('/login?sso_error=expired');
      expect(screen.getByText(/took too long or was started elsewhere/)).toBeInTheDocument();
    });

    it('is not offered on the plain-http LAN address', async () => {
      await renderLogin();
      expect(screen.getByLabelText('Username')).toBeInTheDocument();
      expect(screen.queryByText('Sign in with Home')).not.toBeInTheDocument();
    });

    it('with password sign-in retired, offers no form, no sign-up, and points http visitors to the secure address', async () => {
      (authApi.oidcConfig as any).mockResolvedValueOnce({ enabled: true, passwordLogin: false });
      await renderLogin();

      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /new to the house/i })).not.toBeInTheDocument();
      expect(screen.getByText('nuc.tailf10ac4.ts.net')).toHaveAttribute('href', 'https://nuc.tailf10ac4.ts.net/login');
      expect(screen.getByRole('link', { name: /sign in as a guest/i })).toHaveAttribute('href', '/guest');
    });
  });
});
