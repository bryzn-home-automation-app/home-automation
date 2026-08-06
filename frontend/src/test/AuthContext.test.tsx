import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import api from '../api/client';
import type { LoginResponse } from '../api/auth';

const mockUser: LoginResponse = {
  token: 'test-jwt-token',
  userId: 1,
  username: 'bryzncode',
  displayName: 'Bryan',
  role: 'ADMIN',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should start with null user and loading state', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it('should login and set user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.login(mockUser.token, mockUser);
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.username).toBe('bryzncode');
    expect(result.current.token).toBe('test-jwt-token');
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isUser).toBe(false);
    expect(result.current.isGuest).toBe(false);
  });

  it('should persist token to localStorage on login', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.login('my-token', mockUser);
    });

    expect(localStorage.getItem('auth_token')).toBe('my-token');
  });

  it('should clear auth on logout', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.login(mockUser.token, mockUser);
    });
    await act(async () => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('should detect USER role correctly', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.login('token', { ...mockUser, role: 'USER' });
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isUser).toBe(true);
  });

  it('should detect GUEST role correctly', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      result.current.login('token', { ...mockUser, role: 'GUEST' });
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isGuest).toBe(true);
  });

  it('should attach Bearer token to axios requests', async () => {
    const spy = vi.spyOn(api.interceptors.request, 'use');

    renderHook(() => useAuth(), { wrapper });

    // The interceptor was registered
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
