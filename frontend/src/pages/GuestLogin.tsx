import { useState, useRef, type FormEvent, type ChangeEvent } from 'react';
import { guestLogin, uploadAvatar } from '../api/auth';
import Avatar from '../components/profile/Avatar';
import ColorPicker from '../components/profile/ColorPicker';

export default function GuestLogin() {
  const [name, setName] = useState('');
  const [code, setCode] = useState(() =>
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('code') ?? ''
      : ''
  );
  const [accentColor, setAccentColor] = useState('#A855F7');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submittedName, setSubmittedName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { avatarUrl: url } = await uploadAvatar(file);
      setAvatarUrl(url);
    } catch {
      setError('Photo upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  };

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
      const resp = await guestLogin({
        displayName: trimmed,
        accentColor,
        avatarUrl: avatarUrl || undefined,
      }, code.trim());
      sessionStorage.setItem('guestName', resp.displayName);
      sessionStorage.setItem('guestToken', resp.token);
      sessionStorage.setItem('guestAccent', accentColor);
      sessionStorage.setItem('guestAvatar', avatarUrl || '');
      setSubmittedName(trimmed);
      setSubmittedName(trimmed);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="guest-bg flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-[32px] border border-appborder bg-appsurface-raised p-8 shadow-[0_20px_60px_var(--appshadow-lg)]">
            {/* Avatar preview on success */}
            <div className="mx-auto mb-5 flex justify-center">
              <Avatar displayName={submittedName} avatarUrl={avatarUrl} accentColor={accentColor} size={80} />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-apptext">
              Welcome, {submittedName}!
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

            <button
              type="button"
              onClick={() => { window.location.href = '/guest/home'; }}
              className="mt-6 w-full rounded-2xl px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: accentColor }}
            >
              See Who&rsquo;s Here →
            </button>

            <p className="mt-4 text-xs text-apptext-muted">
              Guest access auto-expires after 30 days.
            </p>

            {/* bryzncode trademark */}
            <div className="mt-4 flex items-center justify-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-apptext-dim">
                powered by
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-appwarning/90">
                bryzncode
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-bg flex min-h-dvh items-center justify-center px-4">
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
              Welcome! Enter your name, pick a color, and optionally add a photo to personalize your visit.
            </p>
          </div>

          {/* Live avatar preview */}
          <div className="mb-6 flex justify-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative"
              disabled={uploading}
            >
              <Avatar
                displayName={name || '?'}
                avatarUrl={avatarUrl}
                accentColor={accentColor}
                size={80}
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-2xl text-white">📷</span>
              </div>
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          <p className="mb-6 -mt-2 text-center text-xs text-apptext-dim">
            {avatarUrl ? 'Tap to change photo' : 'Tap avatar to add a photo'}
            {avatarUrl && (
              <button type="button" onClick={() => setAvatarUrl(null)} className="ml-1 text-appdanger hover:underline">(remove)</button>
            )}
          </p>

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
            </div>

            <div>
              <label htmlFor="guestCode" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Invite Code
              </label>
              <input
                id="guestCode"
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value); if (error) setError(''); }}
                placeholder="Provided by your host"
                autoComplete="off"
                className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3.5 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              />
            </div>

            <div>
              <label className="mb-3 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Your Color
              </label>
              <ColorPicker selected={accentColor} onChange={setAccentColor} />
            </div>

            {error && (
              <div className="rounded-2xl border border-appdanger/30 bg-appdanger/10 px-4 py-3 text-sm text-appdanger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || uploading}
              className="w-full rounded-2xl font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] transition-all hover:brightness-110 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2 disabled:opacity-60 px-4 py-3.5 text-sm"
              style={{ background: accentColor }}
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
            <span className="inline-flex h-2 w-2 rounded-full opacity-60" style={{ background: accentColor }} />
            <span className="text-[10px] uppercase tracking-[0.2em] text-apptext-dim">Secure Connection</span>
            <span className="inline-flex h-2 w-2 rounded-full opacity-60" style={{ background: accentColor }} />
          </div>

          {/* bryzncode trademark */}
          <div className="mt-4 flex items-center justify-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-apptext-dim">
              powered by
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-appwarning/90">
              bryzncode
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
