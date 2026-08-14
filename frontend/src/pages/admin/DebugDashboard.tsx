import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { jitteredInterval } from '../../hooks/useJitteredInterval';
import { useFocusTrap } from '../../hooks/useFocusTrap';

// Fetch config (includes version/commit hash) — shared key with useUsageData
const fetchConfig = () => api.get('/config').then((r) => r.data);

interface AppEvent {
  id: number;
  timestamp: string;
  category: string;
  level: string;
  source: string;
  message: string;
  details: string | null;
}

interface HealthInfo {
  timestamp: string;
  database: { status: string; url: string } | { status: string; error: string };
  jvm: { uptimeMinutes: number; heapUsedMB: number; heapMaxMB: number; startTime: string };
  threads: number;
  lastSyncCheck?: { timestamp: string; message: string };
}

interface EventSummary {
  total24h: number;
  errors24h: number;
  warns24h: number;
}

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'sync', label: 'Sync' },
  { key: 'system', label: 'System' },
  { key: 'db', label: 'DB' },
  { key: 'api', label: 'API' },
  { key: 'weather', label: 'Weather' },
] as const;

const LEVELS = [
  { key: 'all', label: 'All' },
  { key: 'ERROR', label: 'Errors' },
  { key: 'WARN', label: 'Warnings' },
  { key: 'INFO', label: 'Info' },
] as const;

const levelBadge = (level: string) => {
  switch (level) {
    case 'ERROR': return 'bg-rose-300/10 border-rose-300/20 text-rose-300';
    case 'WARN': return 'bg-amber-300/10 border-amber-300/20 text-amber-300';
    default: return 'bg-sky-300/10 border-sky-300/20 text-sky-300';
  }
};

const categoryBadge = (cat: string) => {
  const colors: Record<string, string> = {
    sync: 'bg-emerald-300/10 border-emerald-300/20 text-emerald-300',
    system: 'bg-violet-300/10 border-violet-300/20 text-violet-300',
    db: 'bg-amber-300/10 border-amber-300/20 text-amber-300',
    api: 'bg-sky-300/10 border-sky-300/20 text-sky-300',
    weather: 'bg-cyan-300/10 border-cyan-300/20 text-cyan-300',
    auth: 'bg-pink-300/10 border-pink-300/20 text-pink-300',
  };
  return colors[cat] ?? 'bg-appinset border-appborder text-apptext-muted';
};

// ── Date helpers (manual sync range) ────────────────────────────
const toIsoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

/** CoServ only keeps ~2 weeks of interval data. */
const MAX_RANGE_DAYS = 14;

export default function DebugDashboard() {
  const [category, setCategory] = useState<string>('all');
  const [level, setLevel] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<AppEvent | null>(null);

  // Manual sync date range
  const [preset, setPreset] = useState<'yesterday' | 'range'>('yesterday');
  const [startDate, setStartDate] = useState(() => toIsoLocal(addDays(new Date(), -1)));
  const [endDate, setEndDate] = useState(() => toIsoLocal(addDays(new Date(), -1)));

  const todayIso = toIsoLocal(new Date());
  const earliestIso = toIsoLocal(addDays(new Date(), -MAX_RANGE_DAYS));

  const rangeError = useMemo(() => {
    if (preset !== 'range') return '';
    if (!startDate || !endDate) return 'Choose start and end dates.';
    if (startDate > endDate) return 'Start date must be on or before end date.';
    if (endDate > todayIso) return 'End date cannot be in the future.';
    if (startDate < earliestIso) return `Start date is more than ${MAX_RANGE_DAYS} days ago (CoServ keeps ~2 weeks).`;
    return '';
  }, [preset, startDate, endDate, todayIso, earliestIso]);

  // Body sent to the sync endpoints; undefined = "yesterday".
  const syncBody = preset === 'range' ? { startDate, endDate } : undefined;

  const { data: events, isLoading: eventsLoading } = useQuery<AppEvent[]>({
    queryKey: ['admin-events', category, level],
    queryFn: async () => {
      const params = new URLSearchParams({ hours: '72', limit: '200' });
      if (category !== 'all') params.set('category', category);
      if (level !== 'all') params.set('level', level);
      const { data } = await api.get(`/admin/events?${params}`);
      return data;
    },
    staleTime: 10_000,
    refetchInterval: jitteredInterval(30_000),
    refetchIntervalInBackground: false,
  });

  const { data: summary } = useQuery<EventSummary>({
    queryKey: ['admin-events-summary'],
    queryFn: async () => {
      const { data } = await api.get('/admin/events/summary');
      return data;
    },
    staleTime: 15_000,
    refetchInterval: jitteredInterval(30_000),
    refetchIntervalInBackground: false,
  });

  const { data: health, isLoading: healthLoading } = useQuery<HealthInfo>({
    queryKey: ['admin-health'],
    queryFn: async () => {
      const { data } = await api.get('/admin/health');
      return data;
    },
    staleTime: 30_000,
    refetchInterval: jitteredInterval(60_000),
    refetchIntervalInBackground: false,
  });

  // Version / commit hash
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: 3_600_000,
  });
  const version = config?.version || 'unknown';

  // Sync-specific events
  const syncEvents = useMemo(
    () => (events ?? []).filter((e) => e.category === 'sync'),
    [events],
  );

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-amber-300/20 bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-2xl">🔧</span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-amber-200/70">Admin</p>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">Debug Dashboard <span className="text-xs font-mono text-apptext-dim ml-2">{version}</span></h2>
          </div>
        </div>
      </section>

      {/* System Health */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <div className="rounded-2xl border border-appborder bg-appinset p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Database</p>
          {healthLoading ? (
            <p className="mt-2 text-sm text-apptext-muted">...</p>
          ) : (
            <>
              <p className={`mt-2 text-lg font-semibold ${health?.database?.status === 'UP' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {health?.database?.status ?? '?'}
              </p>
              <p className="text-xs text-apptext-dim truncate">
                {'url' in (health?.database ?? {}) ? (health?.database as any).url?.replace(/[?&]password=[^&]*/, '') : ''}
              </p>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-appborder bg-appinset p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Uptime</p>
          {healthLoading ? (
            <p className="mt-2 text-sm text-apptext-muted">...</p>
          ) : (
            <p className="mt-2 text-lg font-semibold text-apptext">
              {health?.jvm?.uptimeMinutes != null
                ? health.jvm.uptimeMinutes >= 1440
                  ? `${Math.floor(health.jvm.uptimeMinutes / 1440)}d ${health.jvm.uptimeMinutes % 1440}m`
                  : `${Math.floor(health.jvm.uptimeMinutes / 60)}h ${health.jvm.uptimeMinutes % 60}m`
                : '...'}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-appborder bg-appinset p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Heap Memory</p>
          {healthLoading ? (
            <p className="mt-2 text-sm text-apptext-muted">...</p>
          ) : (
            <p className="mt-2 text-lg font-semibold text-apptext">
              {health?.jvm?.heapUsedMB ?? '...'}<span className="text-sm text-apptext-muted"> / {health?.jvm?.heapMaxMB ?? '...'} MB</span>
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-appborder bg-appinset p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Threads</p>
          {healthLoading ? (
            <p className="mt-2 text-sm text-apptext-muted">...</p>
          ) : (
            <p className="mt-2 text-lg font-semibold text-apptext">{health?.threads ?? '...'}</p>
          )}
        </div>
      </section>

      {/* Last sync check box */}
      {health?.lastSyncCheck && (
        <div className="rounded-2xl border border-sky-300/10 bg-sky-300/5 px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-sky-200/60">Last Sync Check</p>
          <p className="mt-1 text-sm text-apptext-soft">
            {new Date(health.lastSyncCheck.timestamp + 'Z').toLocaleString('en-US', {
              month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })}
          </p>
          <p className="mt-1 text-xs text-apptext-dim truncate">{health.lastSyncCheck.message}</p>
        </div>
      )}

      {/* Event summary badges */}
      {summary && (
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-appborder bg-appinset p-4 text-center">
            <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">24h Events</p>
            <p className="mt-1 text-2xl font-semibold text-apptext">{summary.total24h}</p>
          </div>
          <div className="rounded-2xl border border-rose-300/10 bg-rose-300/5 p-4 text-center">
            <p className="text-[10px] uppercase tracking-[0.14em] text-rose-200/60">Errors</p>
            <p className="mt-1 text-2xl font-semibold text-rose-300">{summary.errors24h}</p>
          </div>
          <div className="rounded-2xl border border-amber-300/10 bg-amber-300/5 p-4 text-center">
            <p className="text-[10px] uppercase tracking-[0.14em] text-amber-200/60">Warnings</p>
            <p className="mt-1 text-2xl font-semibold text-amber-300">{summary.warns24h}</p>
          </div>
        </section>
      )}

      {/* Manual Sync Triggers */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Manual Triggers</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Run Sync Jobs</h3>
        </div>

        {/* Date range selector */}
        <div className="mb-4 rounded-2xl border border-appborder bg-appinset p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-apptext-dim">Range</span>
            <button
              type="button"
              onClick={() => setPreset('yesterday')}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                preset === 'yesterday'
                  ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                  : 'border-appborder text-apptext-muted hover:bg-appinset-strong'
              }`}
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => setPreset('range')}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                preset === 'range'
                  ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                  : 'border-appborder text-apptext-muted hover:bg-appinset-strong'
              }`}
            >
              Custom range
            </button>
          </div>

          {preset === 'range' && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-apptext-dim">
                  Start date
                </label>
                <input
                  type="date"
                  value={startDate}
                  min={earliestIso}
                  max={todayIso}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-xl border border-appborder bg-appsurface px-3 py-2 text-sm text-apptext-soft outline-none focus:border-appaccent-border [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-apptext-dim">
                  End date
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={earliestIso}
                  max={todayIso}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-appborder bg-appsurface px-3 py-2 text-sm text-apptext-soft outline-none focus:border-appaccent-border [color-scheme:dark]"
                />
              </div>
            </div>
          )}

          {rangeError && (
            <p className="mt-2 text-xs text-rose-300">{rangeError}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <SyncButton
            label="⚡ Daily Sync (Green Button)"
            endpoint="/admin/sync/daily"
            body={syncBody}
            disabled={preset === 'range' && !!rangeError}
          />
          <SyncButton
            label="🕐 Hourly Sync (Avg Usage API)"
            endpoint="/admin/sync/hourly"
            body={syncBody}
            disabled={preset === 'range' && !!rangeError}
          />
          <SyncButton label="🔔 Generate Alerts" endpoint="/admin/sync/alerts" />
        </div>
        <p className="mt-2 text-[10px] text-apptext-dim">
          Syncs run in the background — watch the Diagnostic Log for results.
        </p>
      </section>

      {/* Event Feed */}
      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Event Feed</p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">Diagnostic Log</h3>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext-soft outline-none"
            >
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext-soft outline-none"
            >
              {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </div>
        </div>

        {eventsLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-2xl bg-appinset" />)}
          </div>
        ) : !events?.length ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
            No events yet. Run a sync or restart to populate.
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto pr-1">
            {events.map((e) => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedEvent(e)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setSelectedEvent(e);
                  }
                }}
                className="group cursor-pointer border-b border-appborder-light py-2.5 transition-colors hover:bg-appinset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appaccent/40"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] tabular-nums text-apptext-muted whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit', second: '2-digit',
                    })}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${levelBadge(e.level)}`}>
                    {e.level}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${categoryBadge(e.category)}`}>
                    {e.category}
                  </span>
                  <span className="text-[10px] text-apptext-dim">{e.source}</span>
                  <span className="ml-auto text-[10px] text-apptext-dim opacity-0 transition-opacity group-hover:opacity-100">
                    View details →
                  </span>
                </div>
                <p className="mt-1 text-xs leading-snug text-apptext-soft break-words">{e.message}</p>
                {e.details && (
                  <p className="mt-0.5 text-[10px] leading-snug text-apptext-dim truncate" title={e.details}>
                    {e.details}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Syncs */}
      {syncEvents.length > 0 && (
        <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Sync History</p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">Recent Sync Runs</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {syncEvents.slice(0, 6).map((e) => (
              <div key={e.id} className="rounded-2xl border border-appborder bg-appinset p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${e.level === 'ERROR' ? 'bg-rose-300/10 border-rose-300/20 text-rose-300' : 'bg-emerald-300/10 border-emerald-300/20 text-emerald-300'}`}>
                    {e.level === 'ERROR' ? 'Failed' : 'OK'}
                  </span>
                  <span className="text-xs text-apptext-dim">
                    {new Date(e.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-2 text-sm text-apptext-soft truncate">{e.message}</p>
                <p className="mt-1 text-[10px] text-apptext-dim">{e.source}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* DB Explorer */}
      <DbExplorer />

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}

// ── DB Explorer ────────────────────────────────────────────

interface TableInfo {
  schema: string;
  name: string;
  size: string;
  columns: number;
}

function DbExplorer() {
  const [query, setQuery] = useState(
  `-- Click a table button above, or write your own SQL ⬇
SELECT * FROM app_events
WHERE timestamp >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY timestamp DESC
LIMIT 50`);
  const [showTables, setShowTables] = useState(true);

  const { data: tables } = useQuery<TableInfo[]>({
    queryKey: ['admin-db-tables'],
    queryFn: async () => {
      const { data } = await api.get('/admin/db/tables');
      return data;
    },
    staleTime: 60_000,
  });

  const { data: dbStats } = useQuery<{ rowCounts: Record<string, number>; dbSizePretty: string }>({
    queryKey: ['admin-db-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/db/stats');
      return data;
    },
    staleTime: 60_000,
  });

  const queryMutation = useMutation({
    mutationFn: async (sql: string) => {
      const { data } = await api.post('/admin/db/query', { query: sql });
      return data as { columns: string[]; rows: (string | null)[][]; rowCount: number; truncated?: boolean; error?: string };
    },
  });

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) queryMutation.mutate(query);
  };

  const results = queryMutation.data;

  // Preset buttons for common queries — use timestamp ordering where available
  const timestampTables = new Set([
    'electric_usage', 'hourly_electric_usage', 'gas_usage', 'water_usage',
    'weather_observations', 'app_events', 'notifications', 'guest_sessions',
    'utility_bills', 'roomba_runs', 'maintenance_records',
  ]);
  const presets = tables?.map((t) => ({
    label: t.name,
    query: timestampTables.has(t.name)
      ? `SELECT * FROM ${t.name} ORDER BY timestamp DESC LIMIT 20`
      : `SELECT * FROM ${t.name} ORDER BY 1 DESC LIMIT 20`,
  })) ?? [];

  return (
    <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">DB Explorer</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Query Console</h3>
        </div>
        <button
          onClick={() => setShowTables(!showTables)}
          className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext-soft"
        >
          {showTables ? 'Hide Tables' : 'Show Tables'}
        </button>
      </div>

      {/* DB Size / Row Counts */}
      {dbStats && (
        <div className="mb-4 rounded-2xl border border-emerald-300/10 bg-emerald-300/5 p-3">
          <p className="text-xs text-emerald-200/70">
            DB size: <span className="font-semibold text-emerald-200">{dbStats.dbSizePretty}</span>
            {' · '}
            {Object.entries(dbStats.rowCounts).filter(([, v]) => v > 0).map(([k, v]) => (
              <span key={k} className="ml-2 text-apptext-dim">{k}: <span className="text-apptext-soft">{v}</span></span>
            ))}
          </p>
        </div>
      )}

      {/* Table list */}
      {showTables && tables && (
        <div className="mb-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setQuery(p.query)}
              className="rounded-full border border-sky-300/10 bg-sky-300/5 px-2.5 py-1 text-[10px] font-medium text-sky-200/80 transition-colors hover:border-sky-300/25 hover:bg-sky-300/10"
              title={`${tables.find(t => t.name === p.label)?.size ?? ''} · ${tables.find(t => t.name === p.label)?.columns ?? ''} cols`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Query input */}
      <form onSubmit={handleQuery} className="mb-3 flex gap-2">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={5}
          className="flex-1 resize-none rounded-2xl border border-appborder bg-appinset px-4 py-3 text-sm font-mono text-apptext-soft placeholder:text-apptext-dim focus:border-appaccent-border focus:outline-none"
          placeholder="SELECT * FROM electric_usage ORDER BY timestamp DESC LIMIT 20"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleQuery(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={queryMutation.isPending}
          className="shrink-0 rounded-2xl bg-appaccent-soft px-5 py-3 text-sm font-semibold text-appaccent-text border border-appaccent-border transition-opacity disabled:opacity-50"
        >
          {queryMutation.isPending ? '...' : 'Run'}
        </button>
      </form>

      {/* Error */}
      {results?.error && (
        <div className="mb-3 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-3 text-sm text-rose-300">
          {results.error}
        </div>
      )}

      {/* Results table */}
      {results && !results.error && (
        <div className="overflow-x-auto rounded-2xl border border-appborder">
          <div className="mb-2 px-3 pt-2 text-xs text-apptext-dim">
            {results.rowCount} rows{results.truncated ? ' (limited to 200)' : ''}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-appborder bg-appinset">
                {results.columns.map((col, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-apptext-soft whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, ri) => (
                <tr key={ri} className={`border-b border-appborder-light transition-colors hover:bg-appinset ${ri % 2 === 0 ? '' : 'bg-black/5'}`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-3 py-1.5 max-w-xs truncate ${cell === '***REDACTED***' ? 'text-amber-400/60 italic' : 'text-apptext-soft'}`}>
                      {cell ?? <span className="text-apptext-dim italic">NULL</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Full-detail modal for a single diagnostic event. Shows message + details at full width. */
function EventDetailModal({ event, onClose }: { event: AppEvent; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef, undefined, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Event details"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-appborder bg-appsurface shadow-[0_20px_60px_var(--appshadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-appborder px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${levelBadge(event.level)}`}>
                {event.level}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${categoryBadge(event.category)}`}>
                {event.category}
              </span>
              <span className="text-xs text-apptext-muted">{event.source}</span>
            </div>
            <p className="mt-2 text-[11px] tabular-nums text-apptext-dim">
              {new Date(event.timestamp).toLocaleString('en-US', {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', second: '2-digit',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-appborder text-apptext-muted transition-colors hover:bg-appinset"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-apptext-dim">Message</p>
            <p className="mt-1.5 text-sm leading-relaxed text-apptext-soft break-words">{event.message}</p>
          </div>

          <div className="mt-5">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-apptext-dim">Details</p>
            {event.details ? (
              <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-2xl border border-appborder bg-appinset p-4 text-[11px] leading-relaxed text-apptext-soft font-mono">
                {event.details}
              </pre>
            ) : (
              <p className="mt-1.5 text-xs text-apptext-muted">No additional details for this event.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Manual trigger button — POSTs to a sync endpoint, shows pending/success state. */
function SyncButton({
  label,
  endpoint,
  body,
  disabled,
}: {
  label: string;
  endpoint: string;
  body?: { startDate: string; endDate: string };
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const trigger = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(endpoint, body);
      return data as { status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      queryClient.invalidateQueries({ queryKey: ['admin-events-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin-health'] });
    },
  });
  return (
    <button
      type="button"
      onClick={() => trigger.mutate()}
      disabled={disabled || trigger.isPending}
      className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-all hover:border-emerald-300/40 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {trigger.isPending ? '⏳ Triggering…' : trigger.isSuccess ? `✓ ${label}` : label}
    </button>
  );
}
