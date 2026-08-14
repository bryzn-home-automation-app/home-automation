import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { register as apiRegister } from '../api/auth';

export default function Register() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
      <div className="guest-bg flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-[32px] border border-appborder bg-appsurface-raised p-8 shadow-[0_20px_60px_var(--appshadow-lg)]">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-appwarning-soft text-4xl">
              ⏳
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-apptext">
              Registration Submitted
            </h1>
            <p className="mt-3 text-apptext-soft leading-6">
              Your account has been created and is pending approval. The admin will review your request and assign a role before you can sign in.
            </p>

            <div className="mt-6 rounded-2xl border border-appborder bg-appinset p-4 text-left">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Status</p>
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-apptext-muted">Username</span>
                  <span className="font-medium text-apptext-soft">{username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-apptext-muted">Status</span>
                  <span className="font-medium text-appwarning">Pending Approval</span>
                </div>
              </div>
            </div>

            <Link
              to="/login"
              className="mt-6 inline-flex w-full items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft px-4 py-3.5 text-sm font-semibold text-appaccent-text transition-all hover:border-appaccent"
            >
              Return to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-[32px] border border-appborder bg-appsurface-raised p-8 shadow-[0_20px_60px_var(--appshadow-lg)]">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft text-3xl">
              🏠
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-apptext">
              Create Account
            </h1>
            <p className="mt-2 text-sm text-apptext-soft leading-6">
              Register for access to the home dashboard. All accounts require admin approval.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                required
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            <div>
              <label htmlFor="regUsername" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Username
              </label>
              <input
                id="regUsername"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); if (error) setError(''); }}
                placeholder="johndoe"
                autoComplete="username"
                required
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            <div>
              <label htmlFor="displayName" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Display Name <span className="text-apptext-dim">(optional)</span>
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="John Doe"
                autoComplete="name"
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            <div>
              <label htmlFor="regPassword" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Password
              </label>
              <input
                id="regPassword"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
                required
                minLength={6}
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type your password"
                autoComplete="new-password"
                required
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
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-apptext-muted">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-appaccent-text hover:text-appaccent">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
