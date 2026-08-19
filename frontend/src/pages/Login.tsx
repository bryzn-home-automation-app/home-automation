import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { login as apiLogin } from '../api/auth';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const resp = await apiLogin({ username: username.trim(), password });
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
                className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted"
              >
                Username
              </label>
              <input
                id="username"
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
                className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-appdanger/30 bg-appdanger/10 px-4 py-3 text-sm text-appdanger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-appaccent px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] transition-all hover:brightness-110 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

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
