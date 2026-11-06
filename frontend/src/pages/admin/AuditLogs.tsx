import { useQuery } from '@tanstack/react-query';
import { fetchAllUsers, fetchGuestSessions } from '../../api/auth';
import { fetchThermostatActivity } from '../../api/climate';
import { useMemo } from 'react';
import VirtualizedList from '../../components/VirtualizedList';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { activityText } from '../../utils/thermostat';

const LOG_ROW_HEIGHT = 52;
/** Phones: badge and time on one line, the description under them. */
const LOG_ROW_HEIGHT_NARROW = 76;
const LOG_LIST_HEIGHT = 576; // matches the old max-h-[36rem]
/** How far back thermostat changes go in the feed. */
const THERMOSTAT_DAYS = 30;

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'login' | 'register' | 'approved' | 'disabled' | 'role_change' | 'guest_connect' | 'guest_expire' | 'denied' | 'thermostat';
  description: string;
  actor: string;
}

function useActivityLog() {
  const users = useQuery({ queryKey: ['admin-users'], queryFn: fetchAllUsers });
  const sessions = useQuery({ queryKey: ['admin-guest-sessions'], queryFn: fetchGuestSessions });
  const thermostats = useQuery({
    queryKey: ['thermostat-activity', THERMOSTAT_DAYS],
    queryFn: () => fetchThermostatActivity(THERMOSTAT_DAYS),
    refetchInterval: 60_000,
  });

  const logs = useMemo(() => {
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

    for (const a of (thermostats.data ?? [])) {
      logs.push({
        id: `thermostat-${a.thermostatId}-${a.change.at}`,
        timestamp: a.change.at,
        type: 'thermostat',
        description: activityText(a),
        actor: a.change.by,
      });
    }

    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [users.data, sessions.data, thermostats.data]);

  return { logs, loading: users.isLoading };
}

const typeColors: Record<string, string> = {
  login: 'border-sky-300/20 bg-sky-300/10 text-sky-200',
  register: 'border-yellow-300/20 bg-yellow-300/10 text-yellow-200',
  approved: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
  denied: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
  disabled: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
  role_change: 'border-purple-300/20 bg-purple-300/10 text-purple-200',
  guest_connect: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200',
  guest_expire: 'border-appborder bg-appinset text-apptext-muted',
  thermostat: 'border-orange-300/20 bg-orange-300/10 text-orange-200',
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
  thermostat: 'Thermostat',
};

export default function AuditLogs() {
  const { logs, loading } = useActivityLog();
  const narrow = useMediaQuery('(max-width: 639px)');
  const rowHeight = narrow ? LOG_ROW_HEIGHT_NARROW : LOG_ROW_HEIGHT;

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-2xs font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Admin
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Activity &amp; Audit Logs
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Track user logins, account events, guest activity, and administrative actions across the platform,
              plus every time someone changes a thermostat: in this app, or by hand at the thermostat or in the ecobee app.
            </p>
          </div>

          <div className="rounded-2xl border border-appborder bg-appinset p-4">
            <p className="text-2xs uppercase tracking-[0.16em] text-apptext-dim">Events</p>
            <p className="mt-2 text-lg font-semibold text-apptext">{logs.length}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">
            Activity Feed
          </p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">
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
          <VirtualizedList
            items={logs}
            height={Math.min(LOG_LIST_HEIGHT, logs.length * rowHeight)}
            itemHeight={rowHeight}
            overscan={6}
            className="pr-1"
            renderItem={(entry) => {
              const badge = (
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-3xs font-semibold uppercase tracking-[0.1em] whitespace-nowrap ${typeColors[entry.type] ?? 'border-appborder bg-appinset text-apptext-muted'}`}>
                  {typeLabels[entry.type] ?? entry.type}
                </span>
              );
              const description = (
                <span className="truncate text-sm text-apptext-soft" title={entry.description}>{entry.description}</span>
              );
              const time = (
                <span className="shrink-0 text-xs text-apptext-muted tabular-nums whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              );
              const row = 'mb-2 flex overflow-hidden rounded-2xl border border-appborder-light bg-appinset px-4 transition-colors hover:border-appborder';
              // A phone has no room for badge, text and time on one line, so the text gets its own.
              return narrow ? (
                <div key={entry.id} style={{ height: rowHeight - 8, boxSizing: 'border-box' }} className={`${row} flex-col justify-center gap-1.5 py-2`}>
                  <div className="flex items-center justify-between gap-3">{badge}{time}</div>
                  {description}
                </div>
              ) : (
                <div key={entry.id} style={{ height: rowHeight - 8, boxSizing: 'border-box' }} className={`${row} items-center justify-between gap-4 py-3`}>
                  <div className="flex min-w-0 items-center gap-3">{badge}{description}</div>
                  {time}
                </div>
              );
            }}
          />
        )}
      </section>
    </div>
  );
}
