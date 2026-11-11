import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import * as authApi from '../api/auth';
import { isoBirthday, formatBirthday } from '../components/BirthdayInput';
import { NO_MATCH, pausedFor, problemFor } from '../pages/ForgotPassword';

vi.mock('../api/auth', async () => {
  const actual = await vi.importActual('../api/auth');
  return {
    ...actual,
    fetchMe: vi.fn().mockRejectedValue(new Error('no session')),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    resetPassword: vi.fn(),
    // Password sign-in switched on (the server's emergency switch), so the form and link show.
    oidcConfig: vi.fn().mockResolvedValue({ enabled: true, passwordLogin: true }),
    oidcExchange: vi.fn(),
  };
});

/** The sign-in page and the forgot-password page, as the app routes them. Made-up people only. */
async function renderAt(path: string, state?: unknown) {
  const { default: Login } = await import('../pages/Login');
  const { default: ForgotPassword } = await import('../pages/ForgotPassword');
  const result = render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return result;
}

function pickBirthday(month: string, day: string, year: string) {
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: month } });
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: day } });
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: year } });
}

function fillForm({ username = 'robin', password = 'new-secret-1', again }: { username?: string; password?: string; again?: string } = {}) {
  again ??= password;
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  pickBirthday('7', '9', '1994');
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('New password again'), { target: { value: again } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

describe('Forgot password', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('is linked from under the sign-in form, keeping where the person was headed', async () => {
    const from = { pathname: '/cameras', search: '', hash: '' };
    await renderAt('/login', { from });
    const link = screen.getByRole('link', { name: 'Forgot password?' });
    expect(link).toHaveAttribute('href', '/forgot-password');
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
  });

  it('is not offered while password sign-in is switched off, and the page says why', async () => {
    (authApi.oidcConfig as any).mockResolvedValueOnce({ enabled: true, passwordLogin: false });
    const login = await renderAt('/login');
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument();
    login.unmount();

    (authApi.oidcConfig as any).mockResolvedValueOnce({ enabled: true, passwordLogin: false });
    await renderAt('/forgot-password');
    expect(await screen.findByText('Password reset is switched off.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it('asks for username, a month/day/year birthday and the new password twice', async () => {
    await renderAt('/forgot-password');
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByRole('group', { name: 'Birthday' })).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toHaveAttribute('autocomplete', 'bday-month');
    expect(screen.getByLabelText('Day')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('New password again')).toHaveAttribute('type', 'password');
  });

  it('sends the birthday as yyyy-MM-dd and returns to sign in with a confirmation and the username filled in', async () => {
    (authApi.resetPassword as any).mockResolvedValue(undefined);
    await renderAt('/forgot-password');
    fillForm({ username: ' robin ' });
    submit();

    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith({
      username: 'robin', birthDate: '1994-07-09', newPassword: 'new-secret-1',
    }));
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.getByText('Sign in with your new password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('robin');
  });

  it('catches mismatched or short passwords and a missing birthday before asking the server', async () => {
    await renderAt('/forgot-password');
    fillForm({ again: 'something-else' });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords don’t match.');
    expect(screen.getByText('Doesn’t match the one above')).toBeInTheDocument();

    fillForm({ password: '123', again: '123' });
    submit();
    expect(await screen.findByText('Your new password needs at least 6 characters.')).toBeInTheDocument();

    fillForm();
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1995' } });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '29' } }); // no Feb 29 in 1995
    submit();
    expect(await screen.findByText('Enter your username and your full birthday.')).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it('shows one plain message for any no-match, whatever the reason was', async () => {
    (authApi.resetPassword as any).mockRejectedValue({
      response: { status: 401, data: { error: "That didn't match. Check your username and birthday, or ask Bryan." } },
    });
    await renderAt('/forgot-password');
    fillForm();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That didn’t match. Check your username and birthday, or ask Bryan.',
    );
    expect(screen.queryByText('Password changed.')).not.toBeInTheDocument();
  });

  it('says plainly when resets are paused, and for how long', async () => {
    (authApi.resetPassword as any).mockRejectedValue({
      response: { status: 429, data: { error: 'Too many tries.', retryAfterSeconds: 3600 } },
    });
    await renderAt('/forgot-password');
    fillForm();
    submit();
    expect(await screen.findByText('Too many tries for now.')).toBeInTheDocument();
    expect(screen.getByText(/paused for about an hour\. Try again then, or ask Bryan\./)).toBeInTheDocument();
  });
});

describe('Forgot password helpers', () => {
  it('builds yyyy-MM-dd only for real dates', () => {
    expect(isoBirthday('1994', '7', '9')).toBe('1994-07-09');
    expect(isoBirthday('2000', '2', '29')).toBe('2000-02-29');
    expect(isoBirthday('1995', '2', '29')).toBe('');
    expect(isoBirthday('1994', '', '9')).toBe('');
  });

  it('writes a stored birthday out without a timezone shifting the day', () => {
    expect(formatBirthday('1994-07-09')).toBe('July 9, 1994');
    expect(formatBirthday('2001-01-01')).toBe('January 1, 2001');
  });

  it('turns the pause into words', () => {
    expect(pausedFor(3600)).toBe('about an hour');
    expect(pausedFor(86400)).toBe('about a day');
    expect(pausedFor(7200)).toBe('about 2 hours');
    expect(pausedFor(600)).toBe('about 10 minutes');
    expect(pausedFor(30)).toBe('about 1 minute');
    expect(pausedFor(undefined)).toBe('about an hour');
  });

  it('maps every server answer to something a person can act on', () => {
    expect(problemFor({ response: { status: 401, data: {} } }).title).toBe(NO_MATCH);
    expect(problemFor({ response: { status: 400, data: { error: 'Password must be at least 6 characters.' } } }).title)
      .toBe('Password must be at least 6 characters.');
    expect(problemFor({ response: { status: 403, data: {} } }).title).toBe('Password reset is switched off.');
    expect(problemFor({ response: { status: 503, data: {} } }).title).toBe('Password reset isn’t available right now.');
    expect(problemFor(new Error('Network Error')).title).toBe('Couldn’t reach the home server.');
  });
});
