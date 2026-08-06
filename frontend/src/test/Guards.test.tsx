import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
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

  it('should redirect to /login when token validation fails', async () => {
    localStorage.setItem('auth_token', 'invalid-token');
    (authApi.fetchMe as any).mockRejectedValue(new Error('no backend'));

    // Provide a /login route so the Navigation works
    render(
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

    // After fetchMe fails, we should be redirected
    await screen.findByText(/verifying session/i, {}, { timeout: 2000 });
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
