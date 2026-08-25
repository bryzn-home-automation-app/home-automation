import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useUsageData } from '../hooks/useUsageData';
import { ForecastStrip, ForecastModal } from '../components/WeatherForecast';
import { fetchMaintenanceAnalytics } from '../api/maintenance';
import { fetchNotifications } from '../api/notifications';
import { fetchUnreadCount } from '../api/notifications';
import { fetchGuestSessionCount } from '../api/auth';
import { fetchRoombaStatus, fetchRoombaRuns } from '../api/roomba';
import { fetchCurrentWeather } from '../api/weather';
import { getWeatherEmoji, getWeatherCodeDescription } from '../utils/weather';
import { useJitteredInterval } from '../hooks/useJitteredInterval';

export default function HomeSummary() {
  // Home only needs pre-aggregated daily data, so skip the heavy raw-hourly
  // fetches — no reason to transfer ~2,880 rows the landing screen never shows.
  const { electricDaily, config } = useUsageData({ hourly: false });
  const [showForecast, setShowForecast] = useState(false);
  const roombaInterval = useJitteredInterval(60_000);

  const kwhRate = config.data?.kwhRate ?? 0.1171;

  // Latest complete daily electric total. The backend already aggregates hourly
  // readings into ~60 daily points (electricDaily), so we just pick the most
  // recent day with a near-complete set of readings — no per-render reduction
  // over ~2,880 raw hourly rows.
  const latestDaily = useMemo(() => {
    const complete = (electricDaily.data ?? [])
      .filter((d) => d.readingCount >= 18)
      .sort((a, b) => b.date.localeCompare(a.date));
    return complete.length > 0
      ? { date: complete[0].date, total: complete[0].totalKwh }
      : null;
  }, [electricDaily.data]);

  // ── Cross-module data (module cards + notifications feed) ──
  const maintenance = useQuery({
    queryKey: ['maintenance-analytics'],
    queryFn: fetchMaintenanceAnalytics,
    staleTime: 60_000,
  });

  const recentNotifications = useQuery({
    queryKey: ['notifications', { limit: 6 }],
    queryFn: () => fetchNotifications({ limit: 6 }),
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

  // Live Roomba snapshot + last completed run for the summary card.
  const roomba = useQuery({
    queryKey: ['roomba-status'],
    queryFn: fetchRoombaStatus,
    staleTime: 15_000,
    refetchInterval: roombaInterval,
  });
  const roombaRuns = useQuery({
    queryKey: ['roomba-runs', { limit: 1 }],
    queryFn: () => fetchRoombaRuns(1),
    staleTime: 60_000,
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
  const lastRun = roombaRuns.data?.[0] ?? null;

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

  // Module cards — the primary purpose of Home on mobile: quick jump to every
  // section for anyone not using the sidebar.
  const modules = useMemo(() => [
    { label: 'Utility', detail: 'Electric · Gas · Water', route: '/utility', icon: '⚡', pill: 'Live' },
    { label: 'Roomba', detail: rb ? `${roombaState}${rb.batteryPct != null ? ` · ${rb.batteryPct}%` : ''}` : 'No data yet', route: '/roomba', icon: '🤖', pill: roombaAttention ? 'Attention' : rb?.running ? 'Cleaning' : 'Idle' },
    { label: 'Maintenance', detail: m ? `${m.openCount} open · ${m.completedCount} done` : 'Loading...', route: '/maintenance', icon: '🔧', pill: m ? `${m.openCount} open` : '...' },
    { label: 'Notifications', detail: `${unreadCount.data ?? 0} unread alerts`, route: '/notifications', icon: '🔔', pill: unreadCount.data ? `${unreadCount.data} new` : 'Clear' },
    { label: 'WiFi', detail: `Guest network${guestCount.data ? ` · ${guestCount.data} online` : ''}`, route: '/wifi', icon: '📶', pill: guestCount.data ? `${guestCount.data} on` : 'Ready' },
    { label: 'Users', detail: 'Members, roles & approvals', route: '/users', icon: '👥', pill: 'Manage' },
    { label: "What's New", detail: 'Latest releases & changes', route: '/updates', icon: '✨', pill: 'Updates' },
  ], [m, unreadCount.data, guestCount.data, rb, roombaState, roombaAttention]);

  const dailyLabel = latestDaily
    ? new Date(latestDaily.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : null;
  const lastCleanLabel = lastRun?.completedAt
    ? new Date(lastRun.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  // Detail line for the Roomba summary card.
  const roombaDetail = roombaAttention
    ? (rb?.attentionReasons[0] ?? 'Needs attention')
    : rb?.running
      ? `Cleaning now${rb.sqft != null ? ` · ${rb.sqft} sq ft` : ''}`
      : lastCleanLabel
        ? `Last cleaned ${lastCleanLabel}${lastRun?.squareFeet != null ? ` · ${lastRun.squareFeet} sq ft` : ''}`
        : rb
          ? 'No runs recorded yet'
          : 'Waiting for the robot';

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Current weather — the most glanceable live signal, kept at the top.
          Click to open the 24h forecast. */}
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

      {/* Snapshot: last daily electric + Roomba summary */}
      <section className="grid gap-4 sm:grid-cols-2">
        {/* Last daily electric */}
        <Link
          to="/utility"
          className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_8px_24px_var(--appshadow)] transition-colors hover:border-appborder-hover"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">⚡ Last Daily Electric</p>
            <span className="text-xs font-medium text-appaccent-text">Utility →</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-apptext">
            {latestDaily ? latestDaily.total.toFixed(1) : '—'}
            <span className="ml-1 text-base font-normal text-apptext-muted">kWh</span>
          </p>
          <p className="mt-1 text-sm text-apptext-soft">
            {dailyLabel
              ? `${dailyLabel} · $${(latestDaily!.total * kwhRate).toFixed(2)}`
              : 'Syncs automatically each evening'}
          </p>
        </Link>

        {/* Roomba summary — amber when the robot needs attention. */}
        <Link
          to="/roomba"
          className={`rounded-[28px] border p-5 shadow-[0_8px_24px_var(--appshadow)] transition-colors ${
            roombaAttention
              ? 'border-appwarning/50 bg-appwarning/10 hover:bg-appwarning/15'
              : 'border-appborder bg-appsurface-raised hover:border-appborder-hover'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className={`text-[11px] font-medium uppercase tracking-[0.18em] ${roombaAttention ? 'text-appwarning' : 'text-apptext-muted'}`}>🤖 Roomba</p>
            <span className="text-xs font-medium text-appaccent-text">Open →</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-apptext">
            {roombaState}
            {rb?.batteryPct != null && (
              <span className="ml-2 text-base font-normal text-apptext-muted">{rb.batteryPct}%</span>
            )}
          </p>
          <p className="mt-1 truncate text-sm text-apptext-soft">{roombaDetail}</p>
        </Link>
      </section>

      {showForecast && (
        <ForecastModal
          hourly={currentWeather?.hourly}
          current={currentWx}
          onClose={() => setShowForecast(false)}
        />
      )}

      {/* Module cards — quick access to every section (mobile nav aid) */}
      <section className="perf-section">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">Modules</p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-apptext">Quick access to every system.</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((mod) => (
            <Link
              key={mod.label}
              to={mod.route}
              className="group flex items-center gap-4 rounded-[24px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] transition-colors hover:border-appborder-hover hover:bg-appinset-strong"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-appborder bg-appinset text-2xl">{mod.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-apptext">{mod.label}</h4>
                  <span className="shrink-0 rounded-full border border-appborder bg-appinset px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-apptext-soft">{mod.pill}</span>
                </div>
                <p className="mt-1 text-xs text-apptext-muted">{mod.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent notifications */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
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
          <div className="space-y-2">
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
      </section>
    </div>
  );
}
