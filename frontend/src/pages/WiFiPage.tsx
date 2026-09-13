import { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { useTheme } from '../context/ThemeContext';

/** Escape SSID/password special chars per the WIFI: QR payload spec (\, ;, ,, "). */
function escapeWifiField(value: string): string {
  return value.replace(/([\\;,"])/g, '\\$1');
}

export default function WiFiPage() {
  const { theme } = useTheme();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrLargeUrl, setQrLargeUrl] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  // Read network credentials from build-time env so the real password never
  // lives in source control. Set VITE_WIFI_SSID / VITE_WIFI_PASSWORD (see .env.example).
  const ssid = import.meta.env.VITE_WIFI_SSID ?? '';
  const password = import.meta.env.VITE_WIFI_PASSWORD ?? '';

  // Native WIFI: QR payload — scanned via the phone's system Camera app (not an
  // in-app scanner), this triggers the OS "Join Network" prompt with the password
  // pre-filled, no typing required. T:WPA covers WPA/WPA2/WPA3; adjust if the
  // network ever moves to WEP or is left open.
  const wifiQrPayload = useMemo(() => {
    if (!ssid) return '';
    return `WIFI:T:WPA;S:${escapeWifiField(ssid)};P:${escapeWifiField(password)};;`;
  }, [ssid, password]);

  // Generate QR code
  useEffect(() => {
    if (!wifiQrPayload) return;
    let cancelled = false;
    const color = {
      dark: theme === 'dark' ? '#f8fafc' : '#0f172a',
      light: theme === 'dark' ? '#0f172a' : '#ffffff',
    };

    QRCode.toDataURL(wifiQrPayload, { width: 320, margin: 2, color })
      .then((url) => { if (!cancelled) setQrDataUrl(url); });

    // Big version for the modal
    QRCode.toDataURL(wifiQrPayload, { width: 800, margin: 4, color })
      .then((url) => { if (!cancelled) setQrLargeUrl(url); });

    return () => { cancelled = true; };
  }, [wifiQrPayload, theme]);

  const handleCopyNetwork = () => {
    const lines = [
      ssid && `SSID: ${ssid}`,
      password && `Password: ${password}`,
    ].filter(Boolean) as string[];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="max-w-2xl">
          <p className="text-2xs font-medium uppercase tracking-[0.22em] text-apptext-muted">
            WiFi Access
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
            Connect with a single scan.
          </h2>
          <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
            Scan the QR code with your phone&rsquo;s Camera app to join the network automatically
            &mdash; no typing the password.
          </p>
        </div>
      </section>

      {/* QR Code + Network Details */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
        {/* QR Code */}
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-8">
          <p className="text-2xs font-medium uppercase tracking-[0.22em] text-apptext-muted">
            Scan to Connect
          </p>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-apptext">
            WiFi connect QR code
          </h3>

          <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
            <div className="rounded-2xl border-2 border-appborder bg-appsurface p-3 cursor-pointer transition-transform hover:scale-105 active:scale-95" onClick={() => setQrModalOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setQrModalOpen(true); }} title="Click to enlarge QR code">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code that auto-connects to WiFi — click to enlarge"
                  className="h-56 w-56 sm:h-64 sm:w-64 pointer-events-none"
                />
              ) : (
                <div className="flex h-56 w-56 animate-pulse items-center justify-center rounded-xl bg-appinset sm:h-64 sm:w-64">
                  <span className="text-apptext-muted text-sm">
                    {ssid ? 'Generating QR…' : 'Configure VITE_WIFI_SSID to generate a QR code'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-3xs uppercase tracking-[0.16em] text-apptext-dim">Auto-connects to</p>
                <p className="mt-1 text-sm font-medium text-appaccent-text">{ssid || 'Not configured'}</p>
              </div>
              <p className="text-xs text-apptext-muted leading-5">
                Open the <strong>Camera app</strong> (or Control Center&rsquo;s QR scanner) — not a browser or
                another app&rsquo;s scanner — and point it at the code. iOS shows a &ldquo;Join Network&rdquo;
                prompt with the password already filled in; tap Join and you&rsquo;re connected, no typing.
              </p>
            </div>
          </div>
        </div>

        {/* Network Details */}
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)]">
          <p className="text-2xs font-medium uppercase tracking-[0.22em] text-apptext-muted">
            Network Details
          </p>
          <h3 className="mt-3 text-xl font-semibold text-apptext">WiFi credentials</h3>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-2xl border border-appborder bg-appinset px-4 py-3">
              <div>
                <p className="text-3xs uppercase tracking-[0.14em] text-apptext-dim">Network Name</p>
                <p className={`mt-0.5 text-base font-semibold ${ssid ? 'text-apptext' : 'text-apptext-dim'}`}>{ssid || 'Not configured'}</p>
              </div>
              <span className="text-xl">📶</span>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-appborder bg-appinset px-4 py-3">
              <div>
                <p className="text-3xs uppercase tracking-[0.14em] text-apptext-dim">Password</p>
                <p className={`mt-0.5 text-base font-mono font-semibold ${password ? 'text-apptext' : 'text-apptext-dim'}`}>{password || 'Not configured'}</p>
              </div>
              <span className="text-xl">🔒</span>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-appborder bg-appinset px-4 py-3">
              <div>
                <p className="text-3xs uppercase tracking-[0.14em] text-apptext-dim">Security</p>
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

      {/* QR Code Modal */}
      {qrModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
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

            <p className="mb-4 text-center text-2xs font-medium uppercase tracking-[0.22em] text-slate-400">
              Scan with Camera app to auto-connect
            </p>

            {qrLargeUrl ? (
              <img
                src={qrLargeUrl}
                alt="QR code that auto-connects to WiFi — large"
                className="h-[min(70vh,70vw)] w-[min(70vh,70vw)] max-h-[28rem] max-w-[28rem]"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center">
                <span className="text-slate-400">Loading&hellip;</span>
              </div>
            )}

            <p className="mt-4 text-center text-sm text-slate-300">
              {ssid || 'Not configured'}
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
