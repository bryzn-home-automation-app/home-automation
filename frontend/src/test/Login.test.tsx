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
  };
});

// Dynamic import to go through Vite
async function renderLogin() {
  const { default: Login } = await import('../pages/Login');
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
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
});
