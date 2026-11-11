import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as authApi from '../api/auth';
import { copyText, escapeWifiField, wifiPayload, QR_COLOURS } from '../pages/wifi/wifiCode';
import { returnPathFromState, safeReturnPath } from '../pages/door/returnPath';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return { ...actual, oidcConfig: vi.fn(), register: vi.fn() };
});

describe('Wi-Fi join code', () => {
  it('escapes the special characters and builds the WIFI: payload', () => {
    expect(escapeWifiField('a;b,c"d\\e')).toBe('a\\;b\\,c\\"d\\\\e');
    expect(wifiPayload('Maple;Guest', 'pw,1')).toBe('WIFI:T:WPA;S:Maple\\;Guest;P:pw\\,1;;');
    expect(wifiPayload('', 'pw')).toBe('');
  });

  it('is always dark modules on the white plate, whatever the theme (B-156)', () => {
    expect(QR_COLOURS).toEqual({ dark: '#111111ff', light: '#00000000' });
  });
});

describe('copyText (B-155)', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as any).clipboard;
  });

  it('is false without a clipboard (the plain-http LAN address)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(await copyText('x')).toBe(false);
  });

  it('is false when the copy is refused, true when it lands', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('x')).toBe(false);
    expect(await copyText('x')).toBe(true);
  });

  it('the page says so when copying fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    vi.stubEnv('VITE_WIFI_SSID', 'MapleHouse-Guest');
    vi.stubEnv('VITE_WIFI_PASSWORD', 'sunny-otter-482');
    const { default: WiFiPage } = await import('../pages/WiFiPage');
    render(<MemoryRouter><WiFiPage /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy name and password/i })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t copy');
    vi.unstubAllEnvs();
  });
});

describe('Wi-Fi page', () => {
  it('opens the big code in a kit dialog from a real button, and Escape closes it (B-043)', async () => {
    vi.stubEnv('VITE_WIFI_SSID', 'MapleHouse-Guest');
    vi.stubEnv('VITE_WIFI_PASSWORD', 'sunny-otter-482');
    const { default: WiFiPage } = await import('../pages/WiFiPage');
    render(<MemoryRouter><WiFiPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Wi-Fi code for MapleHouse-Guest/ }));
    const dialog = screen.getByRole('dialog', { name: 'Scan to join' });
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('hides and shows the password', async () => {
    vi.stubEnv('VITE_WIFI_SSID', 'MapleHouse-Guest');
    vi.stubEnv('VITE_WIFI_PASSWORD', 'sunny-otter-482');
    const { default: WiFiPage } = await import('../pages/WiFiPage');
    render(<MemoryRouter><WiFiPage /></MemoryRouter>);
    expect(screen.getAllByText('sunny-otter-482').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.queryByText('sunny-otter-482')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getAllByText('sunny-otter-482').length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });
});

describe('Return path after sign-in (B-058)', () => {
  it('accepts app paths only', () => {
    expect(safeReturnPath('/cameras?view=recordings')).toBe('/cameras?view=recordings');
    expect(safeReturnPath('//evil.example')).toBeNull();
    expect(safeReturnPath('https://evil.example')).toBeNull();
    expect(safeReturnPath('/\\evil')).toBeNull();
    expect(safeReturnPath('/login')).toBeNull();
    expect(safeReturnPath('/guest/home')).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
  });

  it('reads the guard’s state.from', () => {
    expect(returnPathFromState({ from: { pathname: '/notifications', search: '?id=3', hash: '' } })).toBe('/notifications?id=3');
    expect(returnPathFromState(null)).toBeNull();
  });
});

describe('Create account', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says accounts come from the admin while password sign-in is off (B-059)', async () => {
    (authApi.oidcConfig as any).mockResolvedValue({ enabled: true, passwordLogin: false });
    const { default: Register } = await import('../pages/Register');
    render(<MemoryRouter><Register /></MemoryRouter>);
    expect(await screen.findByText('Accounts are added by the admin.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('shows the form while it is on, and announces a mismatch (B-060)', async () => {
    (authApi.oidcConfig as any).mockResolvedValue({ enabled: true, passwordLogin: true });
    const { default: Register } = await import('../pages/Register');
    render(<MemoryRouter><Register /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Password again'), { target: { value: 'secret2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('sends the request and shows the waiting state', async () => {
    (authApi.oidcConfig as any).mockResolvedValue({ enabled: true, passwordLogin: true });
    (authApi.register as any).mockResolvedValue({});
    const { default: Register } = await import('../pages/Register');
    render(<MemoryRouter><Register /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Password again'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Your account is waiting for approval.')).toBeInTheDocument();
    expect(authApi.register).toHaveBeenCalledWith({ email: 'a@b.c', username: 'sam', password: 'secret1', displayName: undefined });
  });
});
