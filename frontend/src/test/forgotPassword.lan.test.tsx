// @vitest-environment-options {"url": "http://192.168.4.228/forgot-password"}
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as authApi from '../api/auth';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return { ...actual, oidcConfig: vi.fn(), resetPassword: vi.fn() };
});

/** On the plain-http LAN address a new password would cross the Wi-Fi unencrypted. */
describe('Forgot password on the LAN address', () => {
  it('sends the person to the secure address instead of showing the form', async () => {
    (authApi.oidcConfig as any).mockResolvedValue({ enabled: true, passwordLogin: false, passwordReset: true, passwordMinLength: 8 });
    const { default: ForgotPassword } = await import('../pages/ForgotPassword');
    render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });

    expect(await screen.findByText('Use the secure address for this.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nuc.tailf10ac4.ts.net/forgot-password' }))
      .toHaveAttribute('href', 'https://nuc.tailf10ac4.ts.net/forgot-password');
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
