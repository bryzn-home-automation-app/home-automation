import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { oidcConfig, resetPassword } from '../api/auth';
import BirthdayInput from '../components/BirthdayInput';
import { Button, Field, Input, LinkButton, Notice, Panel, Stack } from '../components/ui';
import DoorFrame from './door/DoorFrame';

/** Every kind of no-match gets this one answer from the server; the page says it the same way. */
export const NO_MATCH = 'That didn’t match. Check your username and birthday, or ask Bryan.';

type Problem = { tone: 'problem' | 'headsup'; title: string; body?: string };

/** "about 15 minutes", "about an hour", "about 3 hours", "about a day": how long resets stay paused. */
export function pausedFor(seconds: number | undefined): string {
  const s = seconds && seconds > 0 ? seconds : 3600;
  if (s >= 20 * 3600) return 'about a day';
  if (s >= 100 * 60) return `about ${Math.round(s / 3600)} hours`;
  if (s >= 45 * 60) return 'about an hour';
  const min = Math.max(1, Math.ceil(s / 60));
  return `about ${min} minute${min === 1 ? '' : 's'}`;
}

/** What to show for a failed reset, from the server's answer. */
export function problemFor(err: unknown): Problem {
  const e = err as { response?: { status?: number; data?: { error?: string; retryAfterSeconds?: number } } };
  const status = e?.response?.status;
  const data = e?.response?.data;
  switch (status) {
    case 401:
      return { tone: 'problem', title: NO_MATCH };
    case 429:
      return {
        tone: 'headsup',
        title: 'Too many tries for now.',
        body: `To keep accounts safe, password reset is paused for ${pausedFor(data?.retryAfterSeconds)}. Try again then, or ask Bryan.`,
      };
    case 400:
      return { tone: 'problem', title: data?.error || 'Check the form and try again.' };
    case 403:
      return { tone: 'headsup', title: 'Password reset is switched off.', body: 'Use Sign in with Home, or ask Bryan.' };
    case undefined:
      return { tone: 'problem', title: 'Couldn’t reach the home server.', body: 'Check your connection and try again in a minute.' };
    default:
      return { tone: 'problem', title: 'Password reset isn’t available right now.', body: 'Try again later, or ask Bryan.' };
  }
}

/*
 * "Forgot password?" for household members: username, the birthday the admin saved for them, and a
 * new password. It exists only while the server's password sign-in switch is on (otherwise there's
 * no password to reset, and the page says so up front, like Create account).
 */
export default function ForgotPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  // Whether password sign-in is on: null until the server answers. If it can't be asked, the
  // form shows and the server has the last word.
  const [open, setOpen] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    oidcConfig()
      .then((c) => setOpen(c.passwordLogin))
      .catch(() => setOpen(true));
  }, []);

  const clear = () => {
    if (problem) setProblem(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read the username field itself: iOS autofill can fill it without a change event.
    const user = String(new FormData(e.currentTarget).get('username') ?? username).trim();
    setMismatch(false);
    if (!user || !birthDate) {
      setProblem({ tone: 'problem', title: 'Enter your username and your full birthday.' });
      return;
    }
    if (password.length < 6) {
      setProblem({ tone: 'problem', title: 'Your new password needs at least 6 characters.' });
      return;
    }
    if (password !== confirm) {
      setMismatch(true);
      setProblem({ tone: 'problem', title: 'The two passwords don’t match.' });
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await resetPassword({ username: user, birthDate, newPassword: password });
      // Back to sign in, with where they were headed (if anywhere) and a confirmation.
      const prior = (location.state && typeof location.state === 'object' ? location.state : {}) as Record<string, unknown>;
      navigate('/login', { replace: true, state: { ...prior, passwordReset: true, username: user } });
    } catch (err) {
      setProblem(problemFor(err));
      setBusy(false);
    }
  };

  if (open === null) {
    return (
      <Plate>
        <p className="fp-muted" role="status">Checking…</p>
      </Plate>
    );
  }

  if (!open) {
    return (
      <Plate>
        <Notice tone="neutral" title="Password reset is switched off.">
          Family accounts use Sign in with Home now. If you can’t get in, ask Bryan.
        </Notice>
        <LinkButton to="/login" state={location.state} variant="primary" block icon="home">Go to sign in</LinkButton>
      </Plate>
    );
  }

  return (
    <Plate lead="Choose a new one with your username and the birthday saved for your account.">
      <form onSubmit={handleSubmit} noValidate>
        <Stack>
          <Field label="Username">
            <Input
              name="username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); clear(); }}
              placeholder="Your username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </Field>
          <BirthdayInput onChange={(iso) => { setBirthDate(iso); clear(); }} disabled={busy} />
          <Field label="New password" help="At least 6 characters">
            <Input
              name="new-password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clear(); }}
              autoComplete="new-password"
            />
          </Field>
          <Field label="New password again" error={mismatch ? 'Doesn’t match the one above' : undefined}>
            <Input
              name="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setMismatch(false); clear(); }}
              placeholder="Type it once more"
              autoComplete="new-password"
            />
          </Field>

          {/* Announced the moment it appears (B-060). */}
          {problem && (
            <Notice tone={problem.tone} title={problem.title} live="assertive">
              {problem.body}
            </Notice>
          )}

          <Button type="submit" variant="primary" size="lg" block icon="key" busy={busy} busyLabel="Checking…">
            Set new password
          </Button>
          <p className="fp-small fp-muted fp-t-center">
            Remembered it? <LinkButton to="/login" state={location.state} variant="quiet" size="sm">Sign in</LinkButton>
          </p>
        </Stack>
      </form>
    </Plate>
  );
}

/** The bare faceplate every state of this page sits on (as on Create account). */
function Plate({ lead, children }: { lead?: string; children: ReactNode }) {
  return (
    <DoorFrame center>
      <Panel className="flex w-[min(100%,480px)] flex-col gap-5 [--apppanel-pad:24px] lg:[--apppanel-pad:32px]">
        <div className="flex flex-col gap-1.5">
          <p className="fp-label">Front door</p>
          <h1 className="text-title font-semibold leading-tight tracking-[-.01em] text-apptext lg:text-3xl">Forgot your password?</h1>
          {lead && <p className="fp-muted">{lead}</p>}
        </div>
        {children}
      </Panel>
    </DoorFrame>
  );
}
