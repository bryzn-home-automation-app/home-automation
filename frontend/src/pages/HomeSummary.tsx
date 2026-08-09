import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import VirtualizedList from '../components/VirtualizedList';
import { fetchMaintenanceAnalytics } from '../api/maintenance';
import { fetchNotifications } from '../api/notifications';
import { fetchUnreadCount } from '../api/notifications';
import { fetchGuestSessionCount } from '../api/auth';
import { fetchCurrentWeather } from '../api/weather';
import { getWeatherEmoji, getWeatherCodeDescription } from '../utils/weather';

export default function HomeSummary() {
  const { electricUsage, gasUsage, electricTotal, gasTotal, config } = useUsageData();

  const kwhRate = config.data?.kwhRate ?? 0.1171;
  const elecKwh = electricTotal.data?.totalKwh ?? 0;
  const gasKwh = gasTotal.data?.totalKwh ?? 0;
  const totalKwh = elecKwh + gasKwh;
  const estimatedBill = totalKwh * kwhRate;

  // Latest daily usage — sum hourly records per date, take the most recent with ≥ 20 records
  const latestDaily = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const d of electricUsage.data ?? []) {
      if (d.source !== 'CoServ Average Usage') continue;
      const date = d.timestamp.slice(0, 10);
      const entry = byDate.get(date) ?? { total: 0, count: 0 };
      entry.total += Number(d.usageKwh);
      entry.count++;
      byDate.set(date, entry);
    }
    const complete = Array.from(byDate.entries())
      .filter(([, v]) => v.count >= 18)
      .sort(([a], [b]) => b.localeCompare(a));
    return complete.length > 0 ? { date: complete[0][0], total: complete[0][1].total } : null;
  }, [electricUsage.data]);

  // Daily-aggregated usage feed (from hourly records)
  const recentElectric = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number; latestTimestamp: string }>();
    for (const d of electricUsage.data ?? []) {
      if (d.source !== 'CoServ Average Usage') continue;
      const date = d.timestamp.slice(0, 10);
      const entry = byDate.get(date) ?? { total: 0, count: 0, latestTimestamp: d.timestamp };
      entry.total += Number(d.usageKwh);
      entry.count++;
      if (d.timestamp > entry.latestTimestamp) entry.latestTimestamp = d.timestamp;
      byDate.set(date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, v]) => ({ date, total: Math.round(v.total * 100) / 100, count: v.count }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [electricUsage.data]);

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

  // ── Current weather (latest hourly reading) ──────────────────
  const { data: currentWeather } = useQuery({
    queryKey: ['weather-current'],
    queryFn: fetchCurrentWeather,
    staleTime: 300_000,
  });
  const currentWx = currentWeather?.current ?? null;
  const latestTemp = currentWx?.temperature ?? null;
  const latestHumidity = currentWx?.humidity ?? null;
  const wxEmoji = currentWx ? getWeatherEmoji(currentWx.weatherCode) : null;
  const wxDesc = currentWx ? getWeatherCodeDescription(currentWx.weatherCode) : null;

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
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-appborder bg-appinset p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Rate</p>
              <p className="mt-1 text-sm font-semibold text-apptext">${kwhRate.toFixed(4)}/kWh</p>
            </div>
            <div className="rounded-xl border border-appborder bg-appinset p-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Last Reading</p>
              <p className="mt-1 text-sm font-semibold text-apptext">
                {latestDaily ? new Date(latestDaily.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No data'}
              </p>
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
        <StatTile
          label="Last Daily"
          value={latestDaily ? latestDaily.total.toFixed(1) : '—'}
          unit="kWh"
          loading={electricUsage.isLoading}
          icon={Icons.Bolt}
          subtitle={latestDaily ? new Date(latestDaily.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined}
        />
        <StatTile label="Electric (60d)" value={elecKwh.toFixed(0)} unit="kWh" loading={electricTotal.isLoading} icon={Icons.Bolt} />
        <StatTile label="Est. Bill" value={`$${estimatedBill.toFixed(2)}`} unit="" loading={electricTotal.isLoading} icon={Icons.Dollar} />
        <StatTile label="Gas (60d)" value={gasKwh.toFixed(0)} unit="kWh" loading={gasTotal.isLoading} icon={Icons.Calendar} />
      </section>

      {/* Current weather card */}
      {currentWx && (
        <section className="rounded-[28px] border border-sky-300/15 bg-sky-300/5 p-5 shadow-[0_8px_24px_var(--appshadow)] transition-colors">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-4xl">{wxEmoji}</span>
              <div>
                <p className="text-sm font-medium text-sky-200/80">{wxDesc}</p>
                <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-apptext">
                  {Math.round(latestTemp!)}°F
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="rounded-2xl border border-sky-300/10 bg-sky-300/5 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Humidity</p>
                <p className="mt-1 text-lg font-semibold text-apptext">{Math.round(latestHumidity!)}%</p>
              </div>
            </div>
          </div>
        </section>
      )}

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
                const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                return (
                  <div key={d.date} className="flex items-center justify-between gap-4 rounded-2xl border border-appborder-light bg-appinset px-4 py-3 transition-colors hover:border-appborder">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full bg-appsuccess shadow-[0_0_16px_var(--appsuccess)]" />
                      <div>
                        <p className="text-sm font-medium text-apptext">{label}</p>
                        <p className="text-xs text-apptext-dim">CoServ · {d.count} hourly records</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-apptext-soft">{d.total.toFixed(2)} kWh</p>
                      <p className="text-xs text-apptext-dim">${(d.total * kwhRate).toFixed(2)} est.</p>
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
