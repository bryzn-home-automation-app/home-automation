import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchGuestSessions,
  expireGuestSessions,
} from '../../api/auth';
import { jitteredInterval } from '../../hooks/useJitteredInterval';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function GuestManagement() {
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: ['admin-guest-sessions'],
    queryFn: fetchGuestSessions,
    refetchInterval: jitteredInterval(30_000),
    refetchIntervalInBackground: false,
  });

  const expireMut = useMutation({
    mutationFn: expireGuestSessions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-guest-sessions'] }),
  });

  const data = sessions.data ?? [];
  const activeCount = data.filter((s) => s.status === 'ACTIVE').length;

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Admin
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Guest Management
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Monitor all active guest sessions. Guests auto-expire after 30 days or can be manually expired.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Active Guests</p>
              <p className="mt-2 text-lg font-semibold text-appsuccess">{activeCount}</p>
            </div>
            <button
              type="button"
              onClick={() => expireMut.mutate()}
              disabled={expireMut.isPending}
              className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-left transition-colors hover:bg-amber-300/20"
            >
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-muted">Maintenance</p>
              <p className="mt-2 text-sm font-semibold text-amber-200">
                {expireMut.isPending ? 'Expiring...' : 'Expire All'}
              </p>
            </button>
          </div>
        </div>
      </section>

      {/* Session list */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Sessions
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
              Active Guest Sessions
            </h3>
          </div>
          <span className="text-xs text-apptext-muted">Refreshes every 30s</span>
        </div>

        {sessions.isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-2xl bg-appinset" />)}
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-apptext-muted">
            No guest sessions found. Guest sessions are created when visitors join via the guest login page.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="text-sm">
              {/* 3 cols mobile, 6 cols md+ */}
              <div className="grid grid-cols-[1.5fr_0.8fr_0.8fr] md:grid-cols-[1fr_1fr_1fr_0.9fr_0.8fr_0.8fr] border-b border-appborder pb-2 text-left text-apptext-dim">
                <div className="font-medium">Guest</div>
                <div className="hidden font-medium md:block">IP / Device</div>
                <div className="text-right font-medium">Connected</div>
                <div className="hidden text-right font-medium md:block">Last Seen</div>
                <div className="text-right font-medium">Expires</div>
                <div className="hidden" />
              </div>

              {data.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1.5fr_0.8fr_0.8fr] md:grid-cols-[1fr_1fr_1fr_0.9fr_0.8fr_0.8fr] items-center border-b border-appborder-light py-3 transition-colors hover:bg-appinset"
                >
                  <div className="flex items-center gap-3">
                    {s.status === 'ACTIVE' && (
                      <span className="inline-flex h-2 w-2 rounded-full bg-appsuccess shadow-[0_0_10px_var(--appsuccess)]" />
                    )}
                    <span className="font-medium text-apptext truncate">{s.guestName}</span>
                  </div>
                  <div className="hidden md:block">
                    <div className="font-mono text-xs text-apptext-muted">{s.ipAddress}</div>
                    <div className="text-apptext-soft text-xs truncate max-w-[10rem]" title={s.userAgent}>
                      {s.userAgent || 'Unknown'}
                    </div>
                  </div>
                  <div className="text-right tabular-nums text-apptext-soft text-xs">
                    {formatDate(s.connectedAt)}
                  </div>
                  <div className="hidden text-right tabular-nums text-apptext-muted md:block">
                    {timeAgo(s.lastSeenAt)}
                  </div>
                  <div className="text-right">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      s.status === 'ACTIVE'
                        ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
                        : 'border-appborder bg-appinset text-apptext-muted'
                    }`}>
                      {s.status === 'ACTIVE'
                        ? formatDate(s.expiresAt)
                        : s.status}
                    </span>
                  </div>
                  <div className="hidden md:block" />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
