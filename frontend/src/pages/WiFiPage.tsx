import { useState, useEffect, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { fetchGuestSessions, fetchGuestSessionCount, fetchGuestInviteCode, type GuestSession } from '../api/auth';
import OnlineDot from '../components/profile/OnlineDot';
import { useJitteredInterval } from '../hooks/useJitteredInterval';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Live countdown to a future timestamp. Updates every second. */
function useCountdown(expiresAt: string): { label: string; urgent: boolean } {
  const compute = useCallback(() => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return { label: 'Expired', urgent: true };
    const d = Math.floor(diff / 86_400_000);
    if (d > 0) return { label: `${d}d`, urgent: d <= 3 };
    const h = Math.floor(diff / 3_600_000);
    if (h > 0) return { label: `${h}h ${Math.floor((diff % 3_600_000) / 60_000)}m`, urgent: h <= 6 };
    const m = Math.floor(diff / 60_000);
    if (m > 0) return { label: `${m}m`, urgent: m <= 30 };
    const s = Math.floor(diff / 1000);
    return { label: `${s}s`, urgent: true };
  }, [expiresAt]);

  const [result, setResult] = useState(compute);

  useEffect(() => {
    setResult(compute());
    const t = setInterval(() => setResult(compute()), 1000);
    return () => clearInterval(t);
  }, [compute]);

  return result;
}

export default function WiFiPage() {
  const { theme } = useTheme();
  const { isAdmin, isGuest, user } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrLargeUrl, setQrLargeUrl] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  const guestUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/guest`;
  }, []);

  // Members/admins can fetch the shared invite code so the QR carries it.
  const inviteCodeQuery = useQuery({
    queryKey: ['guest-invite-code'],
    queryFn: fetchGuestInviteCode,
    staleTime: 300_000,
    enabled: !!user && !isGuest,
  });

  const guestInviteUrl = useMemo(() => {
    const code = inviteCodeQuery.data;
    if (!code) return guestUrl;
    return `${guestUrl}?code=${encodeURIComponent(code)}`;
  }, [guestUrl, inviteCodeQuery.data]);

  // Read network credentials from build-time env so the real password never
  // lives in source control. Set VITE_WIFI_SSID / VITE_WIFI_PASSWORD (see .env.example).
  const ssid = import.meta.env.VITE_WIFI_SSID ?? '';
  const password = import.meta.env.VITE_WIFI_PASSWORD ?? '';

  const guestSessionsInterval = useJitteredInterval(30_000);
  const guestCountInterval = useJitteredInterval(30_000);

  const guestSessions = useQuery({
    queryKey: ['guest-sessions'],
    queryFn: fetchGuestSessions,
    staleTime: 30_000,
    refetchInterval: guestSessionsInterval,
    refetchIntervalInBackground: false,
    enabled: isAdmin,
  });

  const guestCount = useQuery({
    queryKey: ['guest-session-count'],
    queryFn: fetchGuestSessionCount,
    staleTime: 30_000,
    refetchInterval: guestCountInterval,
    refetchIntervalInBackground: false,
    enabled: !isAdmin,
  });

  const sessions: GuestSession[] = isAdmin ? (guestSessions.data ?? []) : [];
  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE');
  const activeCount = isAdmin ? activeSessions.length : (guestCount.data ?? 0);

  // Generate QR code
  useEffect(() => {
    let cancelled = false;
    const color = {
      dark: theme === 'dark' ? '#f8fafc' : '#0f172a',
      light: theme === 'dark' ? '#0f172a' : '#ffffff',
    };

    QRCode.toDataURL(guestInviteUrl, { width: 320, margin: 2, color })
      .then((url) => { if (!cancelled) setQrDataUrl(url); });

    // Big version for the modal
    QRCode.toDataURL(guestInviteUrl, { width: 800, margin: 4, color })
      .then((url) => { if (!cancelled) setQrLargeUrl(url); });

    return () => { cancelled = true; };
  }, [guestInviteUrl, theme]);

  const handleCopyNetwork = () => {
    const lines = [
      ssid && `SSID: ${ssid}`,
      password && `Password: ${password}`,
      `Guest URL: ${guestInviteUrl}`,
    ].filter(Boolean) as string[];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              WiFi &amp; Guest Access
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Connect guests with a single scan.
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Visitors scan the QR code, enter their name, and they&rsquo;re connected. No app install needed.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Active Guests</p>
              <p className="mt-2 text-lg font-semibold text-apptext">{activeCount}</p>
            </div>
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Guest Portal</p>
              <p className="mt-2 text-sm font-semibold text-apptext">Name-based entry</p>
              <p className="mt-1 text-xs text-apptext-muted">Auto-expires 30 days</p>
            </div>
          </div>
        </div>
      </section>

      {/* QR Code + Network Details */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
        {/* QR Code */}
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
            Scan to Connect
          </p>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-apptext">
            Guest login QR code
          </h3>

          <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
            <div className="rounded-2xl border-2 border-appborder bg-appsurface p-3 cursor-pointer transition-transform hover:scale-105 active:scale-95" onClick={() => setQrModalOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setQrModalOpen(true); }} title="Click to enlarge QR code">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code for guest WiFi login — click to enlarge"
                  className="h-56 w-56 sm:h-64 sm:w-64 pointer-events-none"
                />
              ) : (
                <div className="flex h-56 w-56 animate-pulse items-center justify-center rounded-xl bg-appinset sm:h-64 sm:w-64">
                  <span className="text-apptext-muted text-sm">Generating QR&hellip;</span>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-apptext-dim">Guest Portal URL</p>
                <code className="mt-1 block break-all text-sm font-medium text-appaccent-text select-all">
                  {guestInviteUrl}
                </code>
              </div>
              <p className="text-xs text-apptext-muted leading-5">
                Point any phone camera at the QR code. The guest login page opens directly in their browser.
              </p>
            </div>
          </div>
        </div>

        {/* Network Details */}
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)]">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
            Network Details
          </p>
          <h3 className="mt-3 text-lg font-semibold text-apptext">WiFi credentials</h3>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-2xl border border-appborder bg-appinset px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Network Name</p>
                <p className={`mt-0.5 text-base font-semibold ${ssid ? 'text-apptext' : 'text-apptext-dim'}`}>{ssid || 'Not configured'}</p>
              </div>
              <span className="text-xl">📶</span>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-appborder bg-appinset px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Password</p>
                <p className={`mt-0.5 text-base font-mono font-semibold ${password ? 'text-apptext' : 'text-apptext-dim'}`}>{password || 'Not configured'}</p>
              </div>
              <span className="text-xl">🔒</span>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-appborder bg-appinset px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Security</p>
                <p className="mt-0.5 text-sm text-apptext-soft">WPA2-Personal</p>
              </div>
              <span className="text-sm font-medium text-appsuccess">Secure</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyNetwork}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-appaccent-border bg-appaccent-soft px-4 py-3 text-sm font-semibold text-appaccent-text transition-all hover:border-appaccent hover:bg-appaccent-soft/80 active:scale-[0.98]"
          >
            {copySuccess ? '✓ Copied to clipboard' : '📋 Copy network details'}
          </button>
        </div>
      </section>

      {/* Connected Guests — one card per user */}
      {isAdmin && (
        <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Connected Guests
              </p>
              <h3 className="mt-2 text-lg font-semibold text-apptext">
                {activeCount} online
              </h3>
            </div>
          </div>

          {guestSessions.isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 rounded-2xl bg-appinset" />
              ))}
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-apptext-muted">
              No guests connected. Share the QR code to let visitors join.
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((s) => (
                <GuestRow key={s.id} session={s} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* QR Code Modal */}
      {qrModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setQrModalOpen(false)}
          role="dialog"
          aria-label="Enlarged QR code"
        >
          <div
            className="relative rounded-[32px] border border-white/20 bg-slate-900 p-6 shadow-[0_0_80px_rgba(0,0,0,0.5)] sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setQrModalOpen(false)}
              className="absolute -top-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-slate-800 text-white text-lg shadow-lg transition-colors hover:bg-slate-700"
              aria-label="Close"
            >
              ✕
            </button>

            <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
              Scan to join
            </p>

            {qrLargeUrl ? (
              <img
                src={qrLargeUrl}
                alt="QR code for guest WiFi login — large"
                className="h-[min(70vh,70vw)] w-[min(70vh,70vw)] max-h-[28rem] max-w-[28rem]"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center">
                <span className="text-slate-400">Loading&hellip;</span>
              </div>
            )}

            <p className="mt-4 text-center text-sm text-slate-300">
              {guestInviteUrl}
            </p>
            <p className="mt-2 text-center text-xs text-slate-500">
              Click outside or press ✕ to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Single guest row with live expiry countdown. */
function GuestRow({ session }: { session: GuestSession }) {
  const countdown = useCountdown(session.expiresAt);

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-appborder bg-appinset px-5 py-4 transition-colors hover:border-appborder-hover">
      {/* Online dot + name */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <OnlineDot />
        <span className="text-base font-semibold text-apptext truncate">{session.guestName}</span>
      </div>

      {/* Visits count */}
      <div className="shrink-0 text-right">
        <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Visits</p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums text-apptext-soft">
          {session.connectionCount}
        </p>
      </div>

      {/* Expiry countdown */}
      <div className="hidden text-right sm:block shrink-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Kicked off in</p>
        <p className={`mt-0.5 text-sm font-semibold tabular-nums ${countdown.urgent ? 'text-appwarning' : 'text-apptext-soft'}`}>
          {countdown.label}
        </p>
      </div>

      {/* Connected time */}
      <div className="hidden text-right md:block shrink-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Connected</p>
        <p className="mt-0.5 text-sm tabular-nums text-apptext-soft">{timeAgo(session.connectedAt)}</p>
      </div>

      {/* Device */}
      <div className="hidden text-right lg:block shrink-0 max-w-[12rem]">
        <p className="text-[10px] uppercase tracking-[0.12em] text-apptext-dim">Device</p>
        <p className="mt-0.5 text-sm text-apptext-muted truncate">{session.userAgent || 'Unknown'}</p>
      </div>
    </div>
  );
}
