import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import * as authApi from '../api/auth';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return {
    ...actual,
    fetchMe: vi.fn().mockRejectedValue(new Error('no session')),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    oidcConfig: vi.fn().mockResolvedValue({ enabled: true }),
    oidcExchange: vi.fn(),
  };
});

// Dynamic import to go through Vite
async function renderLogin(path = '/login') {
  const { default: Login } = await import('../pages/Login');
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Login />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Login page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should render login form', async () => {
    await renderLogin();

    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should show link to register page', async () => {
    await renderLogin();
    expect(screen.getByText('Create one')).toHaveAttribute('href', '/register');
  });

  it('should show link to guest login', async () => {
    await renderLogin();
    expect(screen.getByText(/sign in as a guest/i)).toHaveAttribute('href', '/guest');
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
      await waitFor(() => expect(screen.getByLabelText('Username')).toBeInTheDocument());
      expect(authApi.oidcConfig).not.toHaveBeenCalled();
      expect(screen.queryByText('Sign in with Home')).not.toBeInTheDocument();
    });
  });
});
