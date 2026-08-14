import { useQuery } from '@tanstack/react-query';
import { fetchAllUsers, fetchGuestSessions } from '../../api/auth';
import { useMemo } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'login' | 'register' | 'approved' | 'disabled' | 'role_change' | 'guest_connect' | 'guest_expire' | 'denied';
  description: string;
  actor: string;
}

function useActivityLog() {
  const users = useQuery({ queryKey: ['admin-users'], queryFn: fetchAllUsers });
  const sessions = useQuery({ queryKey: ['admin-guest-sessions'], queryFn: fetchGuestSessions });

  return useMemo(() => {
    const logs: LogEntry[] = [];

    for (const u of (users.data ?? [])) {
      if (u.lastLoginAt) {
        logs.push({
          id: `login-${u.id}`,
          timestamp: u.lastLoginAt,
          type: 'login',
          description: `${u.displayName || u.username} signed in`,
          actor: u.username,
        });
      }

      logs.push({
        id: `register-${u.id}`,
        timestamp: u.createdAt,
        type: u.status === 'PENDING_APPROVAL' ? 'register' : 'approved',
        description: u.status === 'PENDING_APPROVAL'
          ? `${u.displayName || u.username} registered — awaiting approval`
          : `${u.displayName || u.username} was approved as ${u.role}`,
        actor: u.username,
      });
    }

    for (const s of (sessions.data ?? [])) {
      logs.push({
        id: `connect-${s.id}`,
        timestamp: s.connectedAt,
        type: 'guest_connect',
        description: `${s.guestName} connected from ${s.ipAddress}`,
        actor: s.guestName,
      });
    }

    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [users.data, sessions.data]);
}

const typeColors: Record<string, string> = {
  login: 'border-appinfo-border bg-appinfo-soft text-appinfo',
  register: 'border-appwarning-border bg-appwarning-soft text-appwarning',
  approved: 'border-appaccent-border bg-appaccent-soft text-appaccent',
  denied: 'border-appdanger-border bg-appdanger-soft text-appdanger',
  disabled: 'border-appdanger-border bg-appdanger-soft text-appdanger',
  role_change: 'border-appneutral-border bg-appneutral-soft text-apptext-soft',
  guest_connect: 'border-appinfo-border bg-appinfo-soft text-appinfo',
  guest_expire: 'border-appneutral-border bg-appneutral-soft text-apptext-soft',
};

const typeLabels: Record<string, string> = {
  login: 'Sign In',
  register: 'Registered',
  approved: 'Approved',
  denied: 'Denied',
  disabled: 'Disabled',
  role_change: 'Role Changed',
  guest_connect: 'Guest Joined',
  guest_expire: 'Guest Expired',
};

export default function AuditLogs() {
  const logs = useActivityLog();
  const usersLoading = useQuery({ queryKey: ['admin-users'], queryFn: fetchAllUsers }).isLoading;
  const loading = usersLoading;

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Admin
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Activity &amp; Audit Logs
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Track user logins, account events, guest activity, and administrative actions across the platform.
            </p>
          </div>

          <div className="rounded-2xl border border-appborder bg-appinset p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Events</p>
            <p className="mt-2 text-lg font-semibold text-apptext">{logs.length}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
            Activity Feed
          </p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">
            All Events
          </h3>
        </div>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-2xl bg-appinset" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-apptext-muted">
            No activity recorded yet. Events will appear here as users log in and interact with the platform.
          </div>
        ) : (
          <div className="max-h-[36rem] overflow-y-auto space-y-2 pr-1">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-appborder-light bg-appinset px-4 py-3 transition-colors hover:border-appborder"
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap ${typeColors[entry.type] ?? 'border-white/10 bg-white/5 text-slate-300'}`}>
                    {typeLabels[entry.type] ?? entry.type}
                  </span>
                  <span className="text-sm text-apptext-soft">{entry.description}</span>
                </div>
                <span className="text-xs text-apptext-muted tabular-nums whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
