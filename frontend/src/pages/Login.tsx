import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, SIGNED_OUT_KEY } from '../context/AuthContext';
import { login as apiLogin, oidcConfig, oidcExchange, startHomeSso } from '../api/auth';
import { SECURE_APP_URL } from '../components/PushSettings';
import { Button, Disclosure, Field, Icon, Input, Lamp, List, Notice, Panel, Row, Stack, buttonClass } from '../components/ui';
import DoorFrame from './door/DoorFrame';
import { rememberReturnPath, returnPathFromState, takeReturnPath } from './door/returnPath';

/** Why home SSO sent the browser back without signing in (OidcController's sso_error codes). */
const SSO_ERRORS: Record<string, string> = {
  off: 'Sign in with Home isn’t turned on.',
  unavailable: 'Home sign-in is unavailable right now. Please try again in a minute.',
  expired: 'That sign-in took too long or was started elsewhere. Please try again.',
  denied: 'Sign-in was cancelled.',
  failed: 'Home sign-in didn’t go through. Please try again.',
};

const AUTO_SSO_KEY = 'sso_auto_started_at';
const AUTO_SSO_COOLDOWN_MS = 2 * 60 * 1000;

/** True if this device signed out on purpose and hasn't signed in since. */
function signedOutOnPurpose(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/** True at most once per two minutes per tab; false if storage is unavailable (no loop risk). */
function claimAutoSso(): boolean {
  try {
    const last = Number(sessionStorage.getItem(AUTO_SSO_KEY) ?? 0);
    if (Date.now() - last < AUTO_SSO_COOLDOWN_MS) return false;
    sessionStorage.setItem(AUTO_SSO_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

type Options = { sso: boolean; password: boolean; reset: boolean; unreachable?: boolean };

/*
 * The front door: one large key, "Sign in with Home", set in a recessed bezel on a bare
 * faceplate. The retired password form appears only while the server's emergency switch is on
 * (behind "Use a password instead" when Home sign-in is offered too), then the other ways in.
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const ssoReturn = searchParams.has('sso');
  const ssoError = searchParams.get('sso_error');
  // Back from "Forgot password?" with a new Home password: say so, and wait for a tap on Sign in
  // with Home rather than going straight there, so they see it.
  const resetDone = (location.state as { passwordReset?: unknown } | null)?.passwordReset === true;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(ssoError ? SSO_ERRORS[ssoError] ?? SSO_ERRORS.failed : '');
  const [loading, setLoading] = useState(false);
  // What this page offers, from the server: null until known, so neither the form nor the
  // button flashes up and disappears.
  const [options, setOptions] = useState<Options | null>(null);
  const [checking, setChecking] = useState(false);
  const [finishingSso, setFinishingSso] = useState(ssoReturn);
  const exchanged = useRef(false);
  const [signedOut] = useState(signedOutOnPurpose);
  // Home SSO needs the HTTPS (Tailscale) address: its cookies are Secure.
  const isHttps = window.location.protocol === 'https:';
  // The page (or alert) the person was opening when the guard sent them here (B-058).
  const returnTo = returnPathFromState(location.state);

  // Family accounts sign in with "Sign in with Home" only. The password form shows only while the
  // server's emergency switch (PASSWORD_LOGIN_ENABLED) is on.
  const loadOptions = useCallback(() => {
    setChecking(true);
    oidcConfig()
      .then((c) => setOptions({ sso: c.enabled && isHttps, password: c.passwordLogin, reset: c.passwordReset === true }))
      // The server didn't answer (a restart, weak Wi-Fi): still offer the key, but say so, and
      // don't bounce to home SSO by itself, which would land on a bare 502 page (B-014).
      .catch(() => setOptions({ sso: isHttps, password: false, reset: false, unreachable: true }))
      .finally(() => setChecking(false));
  }, [isHttps]);
  useEffect(loadOptions, [loadOptions]);

  // "Sign in with Home" is the only way in, so go straight there: someone already signed in to home
  // SSO lands in the app without a tap. Not after Sign out (that would sign straight back in), not
  // after an SSO error, not while the server isn't answering, not right after a password reset, and
  // not twice within two minutes, so pressing Back on the sign-in page shows this page instead of
  // bouncing forward again.
  useEffect(() => {
    if (!options?.sso || options.password || options.unreachable || ssoReturn || ssoError || signedOut || resetDone || !claimAutoSso()) return;
    setFinishingSso(true);
    rememberReturnPath(returnTo);
    startHomeSso();
  }, [options, ssoReturn, ssoError, signedOut, resetDone, returnTo]);

  // Back from home SSO: swap the one-time code (an HttpOnly cookie) for a session. The ref keeps
  // React's dev double-effect from spending the code twice.
  useEffect(() => {
    if (!ssoReturn || exchanged.current) return;
    exchanged.current = true;
    oidcExchange()
      .then((resp) => {
        login(resp.token, resp);
        navigate(takeReturnPath() ?? '/', { replace: true });
      })
      .catch((err: any) => {
        setError(err.response?.data?.error || 'Home sign-in didn’t go through. Please try again.');
        setFinishingSso(false);
        setSearchParams({}, { replace: true });
      });
  }, [ssoReturn, login, navigate, setSearchParams]);

  if (finishingSso) {
    return (
      <DoorFrame center>
        <p className="fp-panel flex items-center gap-3 text-apptext-muted" role="status">
          <Lamp tone="info" pulse />
          Signing you in…
        </p>
      </DoorFrame>
    );
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read the fields themselves: iOS Safari autofill (Face ID passwords) fills
    // them without firing change events, so React state can still be empty.
    const fields = new FormData(e.currentTarget);
    const user = String(fields.get('username') ?? username).trim();
    const pass = String(fields.get('password') ?? password);
    if (!user || !pass) {
      setError('Enter your username and password.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const resp = await apiLogin({ username: user, password: pass });
      login(resp.token, resp);
      navigate(returnTo ?? '/', { replace: true });
    } catch (err: any) {
      const detail = err.response?.data?.error || err.message || 'Login failed';
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  const passwordForm = options?.password ? (
    <form onSubmit={handleSubmit} noValidate>
      <Stack>
        <Field label="Username">
          <Input
            name="username"
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (error) setError(''); }}
            placeholder="Your username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={!options.sso}
          />
        </Field>
        <Field label="Password">
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
            autoComplete="current-password"
          />
        </Field>
        <Button type="submit" variant={options.sso ? 'secondary' : 'primary'} size={options.sso ? 'md' : 'lg'} block icon="log-in" busy={loading} busyLabel="Signing in…">
          Sign in
        </Button>
      </Stack>
    </form>
  ) : null;

  return (
    <DoorFrame center>
      <Panel className="flex w-[min(100%,440px)] flex-col gap-5 [--apppanel-pad:24px] lg:w-[460px] lg:gap-[22px] lg:[--apppanel-pad:32px]">
        {resetDone && !error ? (
          <Notice tone="ok" title="Home password changed." live="polite">
            Tap Sign in with Home and use your new password. It’s the same one for every home app.
          </Notice>
        ) : signedOut && options?.sso && !error && (
          <Notice tone="ok" title="You’re signed out." live="polite">Sign in again whenever you like.</Notice>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="fp-label">Front door</p>
          <h1 className="text-title font-semibold leading-tight tracking-[-.01em] text-apptext lg:text-3xl">Welcome home.</h1>
          <p className="fp-muted">Sign in with your household account to see the house.</p>
        </div>

        {/* Announced the moment it appears (B-060). */}
        {error && <Notice tone="problem" title={error} live="assertive" />}

        {options?.unreachable && (
          <Notice
            tone="headsup"
            title="Can’t reach the home server right now."
            action={<Button size="sm" icon="refresh" busy={checking} busyLabel="Checking…" onClick={loadOptions}>Try again</Button>}
          >
            It may be restarting. Try again in a minute.
          </Notice>
        )}

        {options?.sso && (
          <>
            <div className="rounded-[calc(var(--appradius-panel)+6px)] bg-appinset p-1.5 shadow-[var(--appwell-shadow)]">
              {/* A full-page navigation, not fetch: the server redirects to the home sign-in page. */}
              <a
                href="/api/auth/oidc/start"
                onClick={() => rememberReturnPath(returnTo)}
                className={buttonClass({ variant: 'primary', size: 'lg', block: true }, 'min-h-16 text-[17.5px]')}
              >
                <Icon name="home" />
                Sign in with Home
              </a>
            </div>
            {!options.unreachable && (
              <p className="-mt-2 flex items-center justify-center gap-2">
                <Lamp tone="ok" size="s" />
                <span className="fp-small fp-muted">The home server is on</span>
              </p>
            )}
            {/* A new Home password by birthday (members only; the server checks). Carries where
                they were headed through the detour. */}
            {options.reset && (
              <p className="-mt-2 fp-small fp-t-center">
                <Link className="fp-link text-apptext-muted" to="/forgot-password" state={location.state}>Forgot password?</Link>
              </p>
            )}
          </>
        )}

        {options && !isHttps && !options.password && (
          <p className="fp-small fp-muted fp-t-center">
            Sign in at the secure address:{' '}
            <a className="fp-link text-apptext" href={`${SECURE_APP_URL}/login`}>
              {SECURE_APP_URL.replace('https://', '')}
            </a>
          </p>
        )}

        {passwordForm && options?.sso ? (
          <Disclosure summary="Use a password instead" openSummary="Hide the password form" className="-mt-1.5">
            <Stack className="mt-2">
              <p className="fp-small fp-muted">Only works while password sign-in is switched on at the home server.</p>
              {passwordForm}
            </Stack>
          </Disclosure>
        ) : (
          passwordForm
        )}

        <OtherWays>
          {options?.password && (
            <Row to="/register" icon="user" title="New to the house?" meta="Request an account. The admin approves it" />
          )}
          <Row to="/guest" icon="door" title="Just visiting?" meta="Sign in as a guest with an invite code" />
        </OtherWays>
      </Panel>
    </DoorFrame>
  );
}

/** The other ways in, as rows under a hairline that runs to the plate's edges. */
function OtherWays({ children }: { children: ReactNode }) {
  return (
    <List aria-label="Other ways in" className="border-t border-appborder">
      {children}
    </List>
  );
}
