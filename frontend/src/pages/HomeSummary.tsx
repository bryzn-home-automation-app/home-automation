import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import { getUsageLevel } from '../utils/usageColor';
import VirtualizedList from '../components/VirtualizedList';
import { fetchMaintenanceAnalytics } from '../api/maintenance';
import { fetchNotifications } from '../api/notifications';
import { fetchUnreadCount } from '../api/notifications';
import { fetchGuestSessionCount } from '../api/auth';

export default function HomeSummary() {
  const { electricUsage, gasUsage, electricTotal, gasTotal, config } = useUsageData();

  const kwhRate = config.data?.kwhRate ?? 0.1171;
  const elecKwh = electricTotal.data?.totalKwh ?? 0;
  const gasKwh = gasTotal.data?.totalKwh ?? 0;
  const totalKwh = elecKwh + gasKwh;
  const estimatedBill = totalKwh * kwhRate;

  const today = new Date().toISOString().split('T')[0];
  const todayElec = useMemo(
    () => electricUsage.data?.filter((d) => d.timestamp.startsWith(today)).reduce((sum, d) => sum + d.usageKwh, 0) ?? 0,
    [electricUsage.data, today],
  );

  const recentElectric = useMemo(
    () =>
      [...(electricUsage.data ?? [])]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 6),
    [electricUsage.data],
  );

  const lastReading = recentElectric[0];

  // ── Cross-module data ──
  const maintenance = useQuery({
    queryKey: ['maintenance-analytics'],
    queryFn: fetchMaintenanceAnalytics,
    staleTime: 60_000,
  });

  const recentNotifications = useQuery({
    queryKey: ['notifications', { limit: 5 }],
    queryFn: () => fetchNotifications({ limit: 5 }),
    staleTime: 30_000,
  });

  const unreadCount = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchUnreadCount,
    staleTime: 30_000,
  });

  const guestCount = useQuery({
    queryKey: ['guest-session-count'],
    queryFn: fetchGuestSessionCount,
    staleTime: 30_000,
  });

  const m = maintenance.data;

  const modules = [
    { label: 'Electric', detail: `${electricUsage.data?.length ?? 0} records`, route: '/electric', icon: '⚡', pill: 'Live' },
    { label: 'Gas', detail: `${gasUsage.data?.length ?? 0} records synced`, route: '/gas', icon: '🔥', pill: 'Tracking' },
    { label: 'Maintenance', detail: m ? `${m.openCount} open · ${m.completedCount} done` : 'Loading...', route: '/maintenance', icon: '🔧', pill: m ? `${m.openCount} open` : '...' },
    { label: 'Notifications', detail: `${unreadCount.data ?? 0} unread alerts`, route: '/notifications', icon: '🔔', pill: unreadCount.data ? `${unreadCount.data} new` : 'Clear' },
    { label: 'Users', detail: `${guestCount.data ?? 0} guests connected`, route: '/users', icon: '👥', pill: 'Active' },
    { label: 'WiFi', detail: `${guestCount.data ?? 0} guests online`, route: '/wifi', icon: '📶', pill: guestCount.data ? `${guestCount.data} on` : 'Ready' },
  ];

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Hero row */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.8fr)]">
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">Home</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
            {totalKwh.toFixed(0)} kWh
          </h2>
          <p className="mt-2 text-sm text-apptext-soft">Combined 60-day usage · ~${estimatedBill.toFixed(0)} estimated bill</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-appborder bg-appinset p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Today</p>
              <p className="mt-1 text-sm font-semibold text-apptext">{todayElec.toFixed(1)} kWh</p>
            </div>
            <div className="rounded-xl border border-appborder bg-appinset p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Last Reading</p>
              <p className="mt-1 text-sm font-semibold text-apptext">
                {lastReading ? new Date(lastReading.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No data'}
              </p>
            </div>
            <div className="rounded-xl border border-appborder bg-appinset p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Rate</p>
              <p className="mt-1 text-sm font-semibold text-apptext">${kwhRate.toFixed(4)}/kWh</p>
            </div>
          </div>
        </div>

        {/* Quick-glance stats card */}
        <div className="rounded-[30px] border border-appaccent-border/20 bg-[linear-gradient(180deg,var(--appaccent-soft),var(--appinset))] p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-appaccent-text/75">At a Glance</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link to="/maintenance" className="rounded-2xl border border-appborder bg-appinset/70 p-3 transition-colors hover:bg-appinset">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">🛠️ Maintenance</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">{m?.openCount ?? '...'}<span className="text-sm font-normal text-apptext-muted"> open</span></p>
              <p className="mt-0.5 text-xs text-apptext-muted">{m?.scheduledCount ?? '...'} upcoming</p>
            </Link>
            <Link to="/notifications" className="rounded-2xl border border-appborder bg-appinset/70 p-3 transition-colors hover:bg-appinset">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">🔔 Alerts</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">{unreadCount.data ?? '...'}<span className="text-sm font-normal text-apptext-muted"> unread</span></p>
              <p className="mt-0.5 text-xs text-apptext-muted">Notification center</p>
            </Link>
            <Link to="/users" className="rounded-2xl border border-appborder bg-appinset/70 p-3 transition-colors hover:bg-appinset">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">👥 Household</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">2<span className="text-sm font-normal text-apptext-muted"> members</span></p>
              <p className="mt-0.5 text-xs text-apptext-muted">{guestCount.data ?? 0} guests online</p>
            </Link>
            <div className="rounded-2xl border border-appborder bg-appinset/70 p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">💰 Lifetime</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">
                {m ? `$${m.totalLifetimeCost.toLocaleString()}` : '...'}
              </p>
              <p className="mt-0.5 text-xs text-apptext-muted">Maintenance spend</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stat tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <StatTile label="Today (Elec)" value={todayElec.toFixed(1)} unit="kWh" loading={electricUsage.isLoading} icon={Icons.Bolt} />
        <StatTile label="Electric (60d)" value={elecKwh.toFixed(0)} unit="kWh" loading={electricTotal.isLoading} icon={Icons.Bolt} />
        <StatTile label="Est. Bill" value={`$${estimatedBill.toFixed(2)}`} unit="" loading={electricTotal.isLoading} icon={Icons.Dollar} />
        <StatTile label="Gas (60d)" value={gasKwh.toFixed(0)} unit="kWh" loading={gasTotal.isLoading} icon={Icons.Calendar} />
      </section>

      {/* Module cards */}
      <section className="perf-section">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">Modules</p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-apptext">Quick access to every system.</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => (
            <Link
              key={m.label}
              to={m.route}
              className="group flex items-center gap-4 rounded-[24px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] transition-colors hover:border-appborder-hover hover:bg-appinset-strong"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-appborder bg-appinset text-2xl">{m.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-apptext">{m.label}</h4>
                  <span className="shrink-0 rounded-full border border-appborder bg-appinset px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-apptext-soft">{m.pill}</span>
                </div>
                <p className="mt-1 text-xs text-apptext-muted">{m.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Feed: Electric usage + Recent notifications */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Usage feed */}
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Usage Feed</p>
              <h3 className="mt-2 text-lg font-semibold text-apptext">Recent electric readings</h3>
            </div>
            <Link to="/electric" className="text-sm font-medium text-apptext-soft hover:text-apptext">View all →</Link>
          </div>

          {electricUsage.isLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-2xl bg-appinset" />)}
            </div>
          ) : recentElectric.length ? (
            <VirtualizedList
              items={recentElectric} height={320} itemHeight={64} overscan={4} className="pr-1" contentClassName="space-y-2"
              renderItem={(d) => {
                const usageLevel = getUsageLevel(Number(d.usageKwh));
                return (
                  <div key={d.id} className="flex items-center justify-between gap-4 rounded-2xl border border-appborder-light bg-appinset px-4 py-3 transition-colors hover:border-appborder">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${d.sourceProvider === 'coserv' ? 'bg-appsuccess shadow-[0_0_16px_var(--appsuccess)]' : 'bg-sky-400'}`} />
                      <div>
                        <p className="text-sm font-medium text-apptext">
                          {new Date(d.timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-xs text-apptext-dim">{d.sourceProvider}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${usageLevel.textClass}`}>{Number(d.usageKwh).toFixed(2)} kWh</p>
                      <p className="text-xs text-apptext-dim">${(Number(d.usageKwh) * kwhRate).toFixed(2)} est.</p>
                    </div>
                  </div>
                );
              }}
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
              No usage data yet. Run <code className="mx-1 text-apptext-soft">npm run sync</code>.
            </div>
          )}
        </div>

        {/* Notification feed */}
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Alerts</p>
              <h3 className="mt-2 text-lg font-semibold text-apptext">Recent notifications</h3>
            </div>
            <Link to="/notifications" className="text-sm font-medium text-apptext-soft hover:text-apptext">View all →</Link>
          </div>

          {recentNotifications.isLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-2xl bg-appinset" />)}
            </div>
          ) : (recentNotifications.data ?? []).length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
              No notifications yet. Activity will appear here.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {(recentNotifications.data ?? []).map((n: any) => (
                <Link
                  key={n.id}
                  to="/notifications"
                  className="flex items-center gap-3 rounded-xl border border-appborder-light bg-appinset px-4 py-3 transition-colors hover:border-appborder"
                >
                  <span className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
                    n.severity === 'CRITICAL' ? 'bg-red-400' : n.severity === 'WARNING' ? 'bg-amber-400' : n.severity === 'SUCCESS' ? 'bg-emerald-400' : 'bg-sky-400'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-apptext">{n.title}</p>
                    <p className="text-xs text-apptext-dim">{n.category}</p>
                  </div>
                  {!n.isRead && <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-appaccent" />}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
