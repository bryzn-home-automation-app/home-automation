import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import VirtualizedList from '../components/VirtualizedList';
import { ForecastStrip, ForecastModal } from '../components/WeatherForecast';
import { fetchMaintenanceAnalytics } from '../api/maintenance';
import { fetchNotifications } from '../api/notifications';
import { fetchUnreadCount } from '../api/notifications';
import { fetchGuestSessionCount } from '../api/auth';
import { fetchRoombaStatus } from '../api/roomba';
import { fetchCurrentWeather } from '../api/weather';
import { getWeatherEmoji, getWeatherCodeDescription } from '../utils/weather';
import { isHourlySource } from '../utils/usageSource';

export default function HomeSummary() {
  const { electricUsage, gasUsage, electricTotal, gasTotal, config } = useUsageData();
  const [showForecast, setShowForecast] = useState(false);

  const kwhRate = config.data?.kwhRate ?? 0.1171;
  // Gas is metered in CCF-equivalent "units", not kWh — it has its own rate
  // and must never be added directly into an electric kWh total. Dollar
  // amounts from each fuel ARE directly additive, though, so the combined
  // estimate below sums $ from each source priced at its own rate rather
  // than summing raw usage and pricing it once at the electric rate.
  const gasUnitRate = config.data?.gasUnitRate ?? 1.47;
  const elecKwh = electricTotal.data?.totalKwh ?? 0;
  const gasUnits = gasTotal.data?.totalKwh ?? 0;
  // The 60-day moving-window spend. This is "60-day spend", not a monthly
  // bill — re-labeled honestly per improvements.md §7.
  const sixtyDaySpend = elecKwh * kwhRate + gasUnits * gasUnitRate;
  const monthlyEstimate = sixtyDaySpend * 0.5;

  // Latest daily usage — sum hourly records per date, take the most recent with ≥ 20 records
  const latestDaily = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const d of electricUsage.data ?? []) {
      if (!isHourlySource(d.source)) continue;
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
      if (!isHourlySource(d.source)) continue;
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

  // Live Roomba snapshot — short staleTime so a running/stuck robot shows up
  // near-live on Home (mirrors the /roomba page's polling intent, lighter).
  const roomba = useQuery({
    queryKey: ['roomba-status'],
    queryFn: fetchRoombaStatus,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const m = maintenance.data;

  // Condense the raw V4 phase into a glanceable headline word.
  const rb = roomba.data;
  const roombaState = rb == null
    ? '—'
    : rb.running
      ? 'Cleaning'
      : rb.phase === 'charge'
        ? 'Charging'
        : rb.phase === 'evac'
          ? 'Emptying'
          : rb.dockText && /dock/i.test(rb.dockText)
            ? 'Docked'
            : 'Idle';
  const roombaAttention = rb?.needsAttention ?? false;

  // ── Current weather (latest hourly reading) ──────────────────
  const { data: currentWeather, isLoading: weatherLoading } = useQuery({
    queryKey: ['weather-current'],
    queryFn: fetchCurrentWeather,
    staleTime: 300_000,
  });
  const currentWx = currentWeather?.current ?? null;
  const latestTemp = currentWx?.temperature ?? null;
  const latestHumidity = currentWx?.humidity ?? null;
  const wxEmoji = currentWx ? getWeatherEmoji(currentWx.weatherCode) : null;
  const wxDesc = currentWx ? getWeatherCodeDescription(currentWx.weatherCode) : null;

  // Memoized so the 6 module cards (and their icon/pill children) don't get
  // fresh object references — and re-render — on every parent render; only
  // rebuild when one of the underlying values actually changes.
  const modules = useMemo(() => [
    // Utilities are now one tab (Electric + Gas + Water) — one card, one destination.
    { label: 'Utility', detail: `Electric · Gas · Water · ${(electricUsage.data?.length ?? 0) + (gasUsage.data?.length ?? 0)} records`, route: '/utility', icon: '⚡', pill: 'Live' },
    { label: 'Roomba', detail: rb ? `${roombaState}${rb.batteryPct != null ? ` · ${rb.batteryPct}%` : ''}` : 'No data yet', route: '/roomba', icon: '🤖', pill: roombaAttention ? 'Attention' : rb?.running ? 'Cleaning' : 'Idle' },
    { label: 'Maintenance', detail: m ? `${m.openCount} open · ${m.completedCount} done` : 'Loading...', route: '/maintenance', icon: '🔧', pill: m ? `${m.openCount} open` : '...' },
    { label: 'Notifications', detail: `${unreadCount.data ?? 0} unread alerts`, route: '/notifications', icon: '🔔', pill: unreadCount.data ? `${unreadCount.data} new` : 'Clear' },
    { label: 'WiFi', detail: `Guest network${guestCount.data ? ` · ${guestCount.data} online` : ''}`, route: '/wifi', icon: '📶', pill: guestCount.data ? `${guestCount.data} on` : 'Ready' },
    { label: 'Users', detail: 'Members, roles & approvals', route: '/users', icon: '👥', pill: 'Manage' },
    { label: "What's New", detail: 'Latest releases & changes', route: '/updates', icon: '✨', pill: 'Updates' },
  ], [electricUsage.data?.length, gasUsage.data?.length, m, unreadCount.data, guestCount.data, rb, roombaState, roombaAttention]);

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Hero row */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.8fr)]">
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">Home</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
            {elecKwh.toFixed(0)} kWh
          </h2>
          <p className="mt-2 text-sm text-apptext-soft">Electric usage over the last 60 days</p>
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
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">At a Glance</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {/* Roomba live state — turns amber when the robot needs attention so a
                stuck/errored vacuum is visible straight from Home. */}
            <Link
              to="/roomba"
              className={`rounded-2xl border p-3 transition-colors ${
                roombaAttention
                  ? 'border-appwarning/50 bg-appwarning/10 hover:bg-appwarning/15'
                  : 'border-appborder bg-appinset/70 hover:bg-appinset'
              }`}
            >
              <p className={`text-[10px] uppercase tracking-[0.14em] ${roombaAttention ? 'text-appwarning' : 'text-apptext-dim'}`}>🤖 Roomba</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">{roombaState}</p>
              <p className="mt-0.5 truncate text-xs text-apptext-muted">
                {roombaAttention ? (rb?.attentionReasons[0] ?? 'Needs attention') : rb?.batteryPct != null ? `${rb.batteryPct}% battery` : 'Vacuum status'}
              </p>
            </Link>
            <Link to="/notifications" className="rounded-2xl border border-appborder bg-appinset/70 p-3 transition-colors hover:bg-appinset">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">🔔 Alerts</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">{unreadCount.data ?? '...'}<span className="text-sm font-normal text-apptext-muted"> unread</span></p>
              <p className="mt-0.5 text-xs text-apptext-muted">Notification center</p>
            </Link>
            <Link to="/users" className="rounded-2xl border border-appborder bg-appinset/70 p-3 transition-colors hover:bg-appinset">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">👥 Guests</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">{guestCount.data ?? 0}<span className="text-sm font-normal text-apptext-muted"> online</span></p>
              <p className="mt-0.5 text-xs text-apptext-muted">On the guest network</p>
            </Link>
            <Link to="/maintenance" className="rounded-2xl border border-appborder bg-appinset/70 p-3 transition-colors hover:bg-appinset">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">🛠️ Maintenance</p>
              <p className="mt-1.5 text-lg font-semibold text-apptext">{m?.openCount ?? '...'}<span className="text-sm font-normal text-apptext-muted"> open</span></p>
              <p className="mt-0.5 text-xs text-apptext-muted">{m?.scheduledCount ?? '...'} upcoming</p>
            </Link>
          </div>
        </div>
      </section>

      {/* Current weather — kept high on the page (right under the hero) since
          it's the most glanceable live signal. Click to open the 24h forecast. */}
      {weatherLoading && !currentWx ? (
        <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_8px_24px_var(--appshadow)]">
          <div className="animate-pulse">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-2xl bg-appinset" />
                <div className="space-y-2">
                  <div className="h-3 w-28 rounded bg-appinset" />
                  <div className="h-7 w-20 rounded bg-appinset" />
                </div>
              </div>
              <div className="h-14 w-24 rounded-2xl bg-appinset" />
            </div>
            <div className="mt-4 h-16 rounded-2xl bg-appinset" />
          </div>
        </section>
      ) : currentWx ? (
        <section
          role="button"
          tabIndex={0}
          onClick={() => setShowForecast(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowForecast(true); } }}
          className="cursor-pointer rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_8px_24px_var(--appshadow)] transition-colors hover:border-appborder-hover"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft text-2xl">{wxEmoji}</span>
              <div>
                <p className="text-sm font-medium text-apptext-soft">{wxDesc}</p>
                <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-apptext">
                  {Math.round(latestTemp!)}°F
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl border border-appborder bg-appinset px-4 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-apptext-soft">Humidity</p>
                <p className="mt-1 text-lg font-semibold text-apptext">{Math.round(latestHumidity!)}%</p>
              </div>
              {currentWx.windSpeed != null && (
                <div className="hidden rounded-2xl border border-appborder bg-appinset px-4 py-3 text-center sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-apptext-soft">Wind</p>
                  <p className="mt-1 text-lg font-semibold text-apptext">{Math.round(currentWx.windSpeed)}<span className="text-xs font-normal text-apptext-muted"> mph</span></p>
                </div>
              )}
              <span className="text-xs font-medium text-appaccent-text">Forecast →</span>
            </div>
          </div>

          {/* Next-few-hours strip */}
          <div className="mt-4">
            <ForecastStrip hourly={currentWeather?.hourly} />
          </div>
        </section>
      ) : null}

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
        <StatTile label="Monthly Est." value={`$${monthlyEstimate.toFixed(2)}`} unit="/mo" loading={electricTotal.isLoading} icon={Icons.Dollar} />
        <StatTile label="Gas (60d)" value={gasUnits.toFixed(0)} unit="units" loading={gasTotal.isLoading} icon={Icons.Calendar} />
      </section>

      {showForecast && (
        <ForecastModal
          hourly={currentWeather?.hourly}
          current={currentWx}
          onClose={() => setShowForecast(false)}
        />
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
            <Link to="/utility" className="text-sm font-medium text-apptext-soft hover:text-apptext">View all →</Link>
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
                      <p className="text-xs text-apptext-dim">${(d.total * kwhRate).toFixed(2)}</p>
                    </div>
                  </div>
                );
              }}
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset px-4 text-center text-sm text-apptext-muted">
              No readings yet — usage syncs automatically each evening once your utility posts the day's data.
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
                    n.severity === 'CRITICAL' ? 'bg-appdanger' : n.severity === 'WARNING' ? 'bg-appwarning' : n.severity === 'SUCCESS' ? 'bg-appsuccess' : 'bg-appaccent'
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
