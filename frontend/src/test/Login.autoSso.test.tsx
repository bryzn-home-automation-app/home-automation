// @vitest-environment-options {"url": "https://nuc.tailf10ac4.ts.net/login"}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import * as authApi from '../api/auth';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return {
    ...actual,
    fetchMe: vi.fn().mockRejectedValue(new Error('no session')),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    oidcConfig: vi.fn().mockResolvedValue({ enabled: true, passwordLogin: false }),
    oidcExchange: vi.fn(),
    startHomeSso: vi.fn(),
  };
});

async function renderLogin(path = '/login') {
  const { default: Login } = await import('../pages/Login');
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Login />
      </MemoryRouter>
    </AuthProvider>
  );
  await act(async () => { await Promise.resolve(); });
}

/** On the HTTPS address with password sign-in retired, the login page goes straight to home SSO. */
describe('Login page: straight to Sign in with Home', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('starts home SSO without a tap', async () => {
    await renderLogin();
    expect(authApi.startHomeSso).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
  });

  it("doesn't bounce again within two minutes (Back from the sign-in page)", async () => {
    sessionStorage.setItem('sso_auto_started_at', String(Date.now() - 30_000));
    await renderLogin();
    expect(authApi.startHomeSso).not.toHaveBeenCalled();
    expect(screen.getByText('Sign in with Home')).toHaveAttribute('href', '/api/auth/oidc/start');
  });

  it('starts again once the two minutes have passed', async () => {
    sessionStorage.setItem('sso_auto_started_at', String(Date.now() - 3 * 60_000));
    await renderLogin();
    expect(authApi.startHomeSso).toHaveBeenCalledTimes(1);
  });

  it("doesn't start after an SSO error, and explains it", async () => {
    await renderLogin('/login?sso_error=denied');
    expect(authApi.startHomeSso).not.toHaveBeenCalled();
    expect(screen.getByText('Sign-in was cancelled.')).toBeInTheDocument();
  });

  it("doesn't start while the password form is switched back on", async () => {
    (authApi.oidcConfig as any).mockResolvedValueOnce({ enabled: true, passwordLogin: true });
    await renderLogin();
    expect(authApi.startHomeSso).not.toHaveBeenCalled();
  });
});
