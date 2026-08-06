import { useState, type FormEvent } from 'react';
import { guestLogin } from '../api/auth';

export default function GuestLogin() {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    setError('');

    if (!trimmed) {
      setError('Please enter your name to continue.');
      return;
    }
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }

    setLoading(true);
    try {
      const resp = await guestLogin({ displayName: trimmed });
      sessionStorage.setItem('guestName', resp.displayName);
      sessionStorage.setItem('guestToken', resp.token);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="guest-bg flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-[32px] border border-appborder bg-appsurface-raised p-8 shadow-[0_20px_60px_var(--appshadow-lg)]">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-appaccent-soft text-4xl">
              ✅
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-apptext">
              Welcome, {name.trim()}!
            </h1>
            <p className="mt-3 text-apptext-soft leading-6">
              You&rsquo;re now connected as a guest. Your session is active and the homeowner has been notified.
            </p>

            <div className="mt-6 rounded-2xl border border-appborder bg-appinset p-4 text-left">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Session Info</p>
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-apptext-muted">Status</span>
                  <span className="font-medium text-appsuccess">Active</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-apptext-muted">Connected at</span>
                  <span className="text-apptext-soft">{new Date().toLocaleTimeString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-apptext-muted">Expires</span>
                  <span className="text-apptext-soft">
                    {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            </div>

            <p className="mt-6 text-xs text-apptext-muted">
              You can close this page. Guest access auto-expires in 30 days.
            </p>
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
              Guest Access
            </h1>
            <p className="mt-2 text-sm text-apptext-soft leading-6">
              Welcome to the home automation portal. Enter your name below to connect as a guest.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="guestName" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Your Name
              </label>
              <input
                id="guestName"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(''); }}
                placeholder="e.g. Sarah or Mike"
                autoComplete="name"
                autoFocus
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
              {error && (
                <p className="mt-2 text-sm text-appdanger flex items-center gap-1.5">
                  <span>⚠</span> {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-appaccent px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] transition-all hover:brightness-110 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {loading ? 'Connecting...' : 'Connect as Guest'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-apptext-dim leading-5">
            By connecting, you agree to the home&rsquo;s guest access policy.
            <br />
            Your session is temporary and expires after 30 days.
          </p>

          <div className="mt-6 flex items-center justify-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-appaccent opacity-60" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-apptext-dim">Secure Connection</span>
            <span className="inline-flex h-2 w-2 rounded-full bg-appaccent opacity-60" />
          </div>
        </div>
      </div>
    </div>
  );
}
