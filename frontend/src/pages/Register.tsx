import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { register as apiRegister, oidcConfig } from '../api/auth';
import { Badge, Button, Field, FormGrid, Input, KeyValue, KV, LinkButton, Notice, Panel, Stack, Verdict } from '../components/ui';
import DoorFrame from './door/DoorFrame';

/*
 * Create an account: a request the admin approves. It only exists while the server's password
 * switch is on; otherwise the page says so up front instead of rejecting a filled-in form (B-059).
 */
export default function Register() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Whether the server takes new accounts this way: null until it answers. If it can't be asked,
  // the form shows as it always did and the server has the last word.
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    oidcConfig()
      .then((c) => setOpen(c.passwordLogin))
      .catch(() => setOpen(true));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      await apiRegister({
        email: email.trim(),
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Plate eyebrow="Request sent" title="Waiting for approval">
        <Verdict tone="headsup" note="The admin will look at it and choose your role. You can sign in as soon as it’s approved.">
          Your account is waiting for approval.
        </Verdict>
        <KeyValue>
          <KV label="Username" value={username} mono />
          <KV label="Status" value={<Badge tone="headsup">Waiting</Badge>} />
        </KeyValue>
        <LinkButton to="/login" block>Back to sign in</LinkButton>
      </Plate>
    );
  }

  if (open === null) {
    return (
      <Plate eyebrow="Front door" title="Request an account">
        <p className="fp-muted" role="status">Checking…</p>
      </Plate>
    );
  }

  if (!open) {
    return (
      <Plate eyebrow="Front door" title="Request an account">
        <Notice tone="neutral" title="Accounts are added by the admin.">
          New accounts aren’t made on this page any more. Ask the admin to add you, then use Sign in with Home.
        </Notice>
        <LinkButton to="/login" variant="primary" block icon="home">Go to sign in</LinkButton>
      </Plate>
    );
  }

  const clear = () => { if (error) setError(''); };

  return (
    <Plate eyebrow="Front door" title="Request an account" lead="The admin approves every new account and picks its role.">
      <form onSubmit={handleSubmit}>
        <Stack>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); clear(); }} placeholder="you@example.com" autoComplete="email" autoFocus required />
          </Field>
          <FormGrid>
            <Field label="Username">
              <Input value={username} onChange={(e) => { setUsername(e.target.value); clear(); }} placeholder="johndoe" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
            </Field>
            <Field label="Name to show" optional>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="John Doe" autoComplete="name" />
            </Field>
            <Field label="Password" help="At least 6 characters">
              <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); clear(); }} autoComplete="new-password" required minLength={6} />
            </Field>
            <Field label="Password again">
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Type it once more" autoComplete="new-password" required />
            </Field>
          </FormGrid>

          {/* Announced the moment it appears (B-060). */}
          {error && <Notice tone="problem" title={error} live="assertive" />}

          <Button type="submit" variant="primary" size="lg" block busy={loading} busyLabel="Sending…">
            Send request
          </Button>
          <p className="fp-small fp-muted fp-t-center">
            Already have an account? <LinkButton to="/login" variant="quiet" size="sm">Sign in</LinkButton>
          </p>
        </Stack>
      </form>
    </Plate>
  );
}

/** The bare faceplate every state of this page sits on. */
function Plate({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <DoorFrame center>
      <Panel className="flex w-[min(100%,520px)] flex-col gap-5 [--apppanel-pad:24px] lg:[--apppanel-pad:32px]">
        <div className="flex flex-col gap-1.5">
          <p className="fp-label">{eyebrow}</p>
          <h1 className="text-title font-semibold leading-tight tracking-[-.01em] text-apptext lg:text-3xl">{title}</h1>
          {lead && <p className="fp-muted">{lead}</p>}
        </div>
        {children}
      </Panel>
    </DoorFrame>
  );
}
