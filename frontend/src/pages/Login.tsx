import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { login as apiLogin, oidcConfig, oidcExchange } from '../api/auth';

/** Why home SSO sent the browser back without signing in (OidcController's sso_error codes). */
const SSO_ERRORS: Record<string, string> = {
  off: 'Sign in with Home isn’t turned on.',
  unavailable: 'Home sign-in is unavailable right now. Use your password instead.',
  expired: 'That sign-in took too long or was started elsewhere. Please try again.',
  denied: 'Sign-in was cancelled.',
  failed: 'Home sign-in didn’t go through. Please try again.',
};

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const ssoReturn = searchParams.has('sso');
  const ssoError = searchParams.get('sso_error');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(ssoError ? SSO_ERRORS[ssoError] ?? SSO_ERRORS.failed : '');
  const [loading, setLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [finishingSso, setFinishingSso] = useState(ssoReturn);
  const exchanged = useRef(false);

  // Home SSO needs the HTTPS (Tailscale) address: its cookies are Secure. On the plain-http LAN
  // address only the password form is offered.
  useEffect(() => {
    if (window.location.protocol !== 'https:') return;
    oidcConfig().then((c) => setSsoEnabled(c.enabled)).catch(() => {});
  }, []);

  // Back from home SSO: swap the one-time code (an HttpOnly cookie) for a session. The ref keeps
  // React's dev double-effect from spending the code twice.
  useEffect(() => {
    if (!ssoReturn || exchanged.current) return;
    exchanged.current = true;
    oidcExchange()
      .then((resp) => {
        login(resp.token, resp);
        navigate('/', { replace: true });
      })
      .catch((err: any) => {
        setError(err.response?.data?.error || 'Home sign-in didn’t go through. Please try again.');
        setFinishingSso(false);
        setSearchParams({}, { replace: true });
      });
  }, [ssoReturn, login, navigate, setSearchParams]);

  if (finishingSso) {
    return (
      <div className="guest-bg flex min-h-dvh items-center justify-center px-4">
        <p className="text-sm text-apptext-soft" role="status">Signing you in…</p>
      </div>
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
      navigate('/', { replace: true });
    } catch (err: any) {
      const detail = err.response?.data?.error || err.message || 'Login failed';
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="guest-bg flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-[32px] border border-appborder bg-appsurface-raised p-8 shadow-[0_20px_60px_var(--appshadow-lg)]">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft text-3xl">
              🏠
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-apptext">
              Welcome Back
            </h1>
            <p className="mt-2 text-sm text-apptext-soft leading-6">
              Sign in to your home automation dashboard.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); if (error) setError(''); }}
                placeholder="bryzncode"
                autoComplete="username"
                autoFocus
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-appdanger/30 bg-appdanger/10 px-4 py-3 text-sm text-apptext-danger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-appaccent px-4 py-3.5 text-sm font-semibold text-appaccent-fg shadow-[0_8px_24px_var(--appaccent-soft)] transition-all hover:brightness-110 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {ssoEnabled && (
            <>
              <div className="my-5 flex items-center gap-3 text-2xs uppercase tracking-[0.18em] text-apptext-muted">
                <span className="h-px flex-1 bg-appborder" />
                or
                <span className="h-px flex-1 bg-appborder" />
              </div>
              {/* A full-page navigation, not fetch: the server redirects to the home sign-in page. */}
              <a
                href="/api/auth/oidc/start"
                className="block w-full rounded-2xl border border-appaccent-border bg-appaccent-soft px-4 py-3.5 text-center text-sm font-semibold text-appaccent-text transition-all hover:brightness-110 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2"
              >
                Sign in with Home
              </a>
            </>
          )}

          <p className="mt-6 text-center text-sm text-apptext-muted">
            Don&rsquo;t have an account?{' '}
            <Link to="/register" className="font-medium text-appaccent-text hover:text-appaccent">
              Create one
            </Link>
          </p>

          <p className="mt-4 text-center text-xs text-apptext-muted">
            <Link to="/guest" className="hover:text-appaccent-text transition-colors">
              Just visiting? Sign in as a guest →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
