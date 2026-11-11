import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, sessionRetryDelay } from '../context/AuthContext';
import { ProtectedRoute, AdminRoute } from '../components/Guard';
import * as authApi from '../api/auth';

// Mock fetchMe
vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return {
    ...actual,
    fetchMe: vi.fn(),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  };
});

function renderWithAuth(initialRoute: string, element: React.ReactNode) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>{element}</Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should show loading state while checking auth', () => {
    localStorage.setItem('auth_token', 'stale-token');
    (authApi.fetchMe as any).mockReturnValue(new Promise(() => {})); // never resolves

    renderWithAuth('/', (
      <Route element={<ProtectedRoute />}>
        <Route index element={<div>Dashboard</div>} />
      </Route>
    ));

    expect(screen.getByText(/verifying session/i)).toBeInTheDocument();
  });

  it('should redirect to /login when not authenticated', () => {
    renderWithAuth('/', (
      <Route element={<ProtectedRoute />}>
        <Route index element={<div>Dashboard</div>} />
      </Route>
    ));

    // No token in localStorage → should redirect
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  function renderApp() {
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route index element={<div>Dashboard</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  }

  const user = { token: 't', userId: 1, username: 'bryan', displayName: 'Bryan', role: 'ADMIN' };
  const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

  it('sends a rejected token (401) to /login and forgets it', async () => {
    localStorage.setItem('auth_token', 'invalid-token');
    (authApi.fetchMe as any).mockRejectedValue(httpError(401));
    renderApp();
    expect(await screen.findByText('Login Page')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('treats 403 like 401', async () => {
    localStorage.setItem('auth_token', 'invalid-token');
    (authApi.fetchMe as any).mockRejectedValue(httpError(403));
    renderApp();
    expect(await screen.findByText('Login Page')).toBeInTheDocument();
  });

  // B-014: a hiccup while the app opens must not sign a signed-in person out.
  it('keeps the session and says the server is unreachable on a network error', async () => {
    localStorage.setItem('auth_token', 'good-token');
    (authApi.fetchMe as any).mockRejectedValue(new Error('Network Error'));
    renderApp();
    expect(await screen.findByText("Can't reach the home server")).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBe('good-token');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('keeps the session through a 502 and opens the app when Try again gets an answer', async () => {
    localStorage.setItem('auth_token', 'good-token');
    (authApi.fetchMe as any).mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce(user);
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(authApi.fetchMe).toHaveBeenCalledTimes(2);
  });

  it('retries by itself when the device comes back online', async () => {
    localStorage.setItem('auth_token', 'good-token');
    (authApi.fetchMe as any).mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(user);
    renderApp();
    await screen.findByText("Can't reach the home server");
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('retries on a timer, backing off to every 30 seconds', async () => {
    expect([1, 2, 3, 4, 5, 9].map(sessionRetryDelay)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      localStorage.setItem('auth_token', 'good-token');
      (authApi.fetchMe as any).mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(user);
      renderApp();
      await screen.findByText("Can't reach the home server");
      await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
      expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rejected token found by a retry still signs out', async () => {
    localStorage.setItem('auth_token', 'old-token');
    (authApi.fetchMe as any).mockRejectedValueOnce(httpError(502)).mockRejectedValueOnce(httpError(401));
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Login Page')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});

describe('AdminRoute', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should redirect non-admin users', () => {
    renderWithAuth('/admin/users', (
      <Route element={<AdminRoute />}>
        <Route path="/admin/users" element={<div>Admin Panel</div>} />
      </Route>
    ));

    // No token → not admin → should redirect
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
});
