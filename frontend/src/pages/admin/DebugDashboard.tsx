import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { errorMessage } from '../../api/climate';
import {
  Badge,
  Button,
  ButtonRow,
  Count,
  DataTable,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  FormGrid,
  InstrumentPanel,
  Input,
  KeyValue,
  KV,
  LampMatrix,
  LampRow,
  LinkButton,
  List,
  Notice,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Row,
  Screen,
  Seg,
  SegPanel,
  Select,
  SkelInstrumentPanel,
  Split,
  Stack,
  StatusText,
  Tag,
  Textarea,
  Verdict,
  useSearchParamState,
  type CellState,
  type Column,
  type MatrixCell,
} from '../../components/ui';
import { usePageMeta } from '../../components/shell/PageMeta';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { startSleepTest } from '../../hooks/useAppSleep';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatShortDate,
  formatStamp,
  formatTime,
  homeToday,
  plural,
} from '../../utils/format';
import { checkStatus, eventLevelStatus, humanize, worstTone, type Tone } from '../../utils/status';
import { coverageState, freshnessStatus, MAX_RANGE_DAYS, shiftDay, tablePreset, type CoverageDay } from './diagnostics';

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

interface PoolInfo {
  active: number;
  idle: number;
  total: number;
  awaitingConnection: number;
  max: number;
}

interface HealthInfo {
  timestamp: string;
  database: { status: string; url: string } | { status: string; error: string };
  jvm: { uptimeMinutes: number; heapUsedMB: number; heapMaxMB: number; startTime: string };
  threads: number;
  pool?: PoolInfo;
  lastSyncCheck?: { timestamp: string; message: string };
}

interface EventSummary {
  total24h: number;
  errors24h: number;
  warns24h: number;
}

interface FreshnessBlock {
  dataThrough: string | null;
  dataThroughDate: string | null;
  ageHours: number | null;
  lastAttempt: string | null;
  lastSuccess: string | null;
}
interface Freshness { daily: FreshnessBlock; hourly: FreshnessBlock; timestamp: string; }

interface Coverage { days: number; expectedHourly: number; completeThreshold: number; coverage: CoverageDay[]; }

interface SyncHistoryRow {
  source: string;
  total: number;
  ok: number;
  warn: number;
  error: number;
  successRate: number | null;
  lastRun: string | null;
}
interface SyncHistory { days: number; bySource: SyncHistoryRow[]; }

interface ConfigCheckItem { check: string; status: 'OK' | 'WARN'; detail: string; }
interface ConfigCheckResult { checks: ConfigCheckItem[]; }

type DriftState = 'NORMAL' | 'ANOMALOUS' | 'DRIFT_SUSPECTED' | 'REGIME_CHANGE_SUSPECTED';
type AnomalyClass = 'NORMAL' | 'ANOMALOUS' | 'SEVERE';
interface DriftInfo {
  state: DriftState;
  asOf: string;
  sampleCount: number;
  historicalMae: number | null;
  recentMae: number | null;
  maeRatio: number | null;
  recentBias: number | null;
  streakLength: number;
  streakSign: number;
}
interface DiagnosticDay {
  date: string;
  actual: number;
  predicted: number;
  residual: number;
  absError: number;
  anomalyScore: number | null;
  robustScale: number | null;
  anomalyClassification: AnomalyClass;
}
interface ForecastDiagnosticsResult { trailingDays: number; drift: DriftInfo; daily: DiagnosticDay[]; }

/**
 * The categories AppEventService is actually called with (B-004: "DB" and "API" were offered
 * but never written, so filtering by them always said "no events"; Home Assistant was missing).
 */
const CATEGORIES = [
  { value: 'all', label: 'All categories' },
  { value: 'sync', label: 'Sync' },
  { value: 'forecast', label: 'Forecast' },
  { value: 'system', label: 'System' },
  { value: 'weather', label: 'Weather' },
  { value: 'camera', label: 'Cameras' },
  { value: 'home-assistant', label: 'Home Assistant' },
  // Password resets with a birthday: every attempt, the birthdays admins set (PasswordResetService).
  { value: 'auth', label: 'Sign-in' },
] as const;

const LEVELS = [
  { value: 'all', label: 'All levels' },
  { value: 'ERROR', label: 'Errors' },
  { value: 'WARN', label: 'Warnings' },
  { value: 'INFO', label: 'Info' },
] as const;

const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? humanize(c);

const DRIFT: Record<string, { tone: Tone; label: string }> = {
  NORMAL: { tone: 'ok', label: 'Normal' },
  ANOMALOUS: { tone: 'headsup', label: 'Anomalous' },
  DRIFT_SUSPECTED: { tone: 'headsup', label: 'Drift suspected' },
  REGIME_CHANGE_SUSPECTED: { tone: 'problem', label: 'Regime change suspected' },
};
const driftStatus = (s: string) => DRIFT[s] ?? { tone: 'neutral' as Tone, label: humanize(s) };

const ANOMALY: Record<string, { tone: Tone; label: string }> = {
  NORMAL: { tone: 'ok', label: 'Normal' },
  ANOMALOUS: { tone: 'headsup', label: 'Anomalous' },
  SEVERE: { tone: 'problem', label: 'Severe' },
};
const anomalyStatus = (s: string) => ANOMALY[s] ?? { tone: 'neutral' as Tone, label: humanize(s) };

// null/non-finite -> em dash (the backend nulls out empty-window NaN / cold-start scale).
const fmtKwh1 = (v: number | null | undefined) => formatNumber(v, { decimals: 1, fixed: true, unit: 'kWh' });
const fmtSigned1 = (v: number | null | undefined) => formatNumber(v, { decimals: 1, fixed: true, signed: true });

const DEBUG_TABS = ['overview', 'sync', 'events', 'forecast', 'tools'] as const;
type DebugTab = (typeof DEBUG_TABS)[number];

function useEvents(key: unknown[], params: Record<string, string>, interval: number | false) {
  return useQuery<AppEvent[]>({
    queryKey: ['admin-events', ...key],
    queryFn: async () => {
      const p = new URLSearchParams({ hours: '72', limit: '200', ...params });
      const { data } = await api.get(`/admin/events?${p}`);
      return data;
    },
    staleTime: 10_000,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
  });
}

/**
 * Admin → Diagnostics. Tabs (kept in the address, ?tab=): Overview (freshness, the app server,
 * settings), Sync (reliability, manual runs, recent runs), Events (the diagnostic log),
 * Forecast (accuracy and drift), Tools (sleep test, query console). The answer above the tabs
 * says whether last night's data arrived and whether anything is erroring.
 */
export default function DebugDashboard() {
  const [tab, setTab] = useSearchParamState<DebugTab>('tab', DEBUG_TABS, 'overview');
  const [category, setCategory] = useState<string>('all');
  const [level, setLevel] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<AppEvent | null>(null);

  // Memoized poll intervals — stable across the frequent re-renders of this
  // dashboard so the RQ timers aren't reset each render.
  const eventsInterval = useJitteredInterval(30_000);
  const summaryInterval = useJitteredInterval(30_000);
  const healthInterval = useJitteredInterval(60_000);
  const freshnessInterval = useJitteredInterval(60_000);
  const coverageInterval = useJitteredInterval(120_000);
  const syncHistoryInterval = useJitteredInterval(120_000);
  const diagnosticsInterval = useJitteredInterval(120_000);

  const filterParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (category !== 'all') p.category = category;
    if (level !== 'all') p.level = level;
    return p;
  }, [category, level]);
  const events = useEvents([category, level], filterParams, eventsInterval);
  // The Sync and Forecast tabs read their own, unfiltered lists, so a filter chosen on the
  // Events tab can't empty them (B-035).
  const syncEvents = useEvents(['sync'], { category: 'sync' }, eventsInterval);
  const forecastEvents = useEvents(['forecast'], { category: 'forecast' }, eventsInterval);

  const summary = useQuery<EventSummary>({
    queryKey: ['admin-events-summary'],
    queryFn: async () => (await api.get('/admin/events/summary')).data,
    staleTime: 15_000,
    refetchInterval: summaryInterval,
    refetchIntervalInBackground: false,
  });
  const health = useQuery<HealthInfo>({
    queryKey: ['admin-health'],
    queryFn: async () => (await api.get('/admin/health')).data,
    staleTime: 30_000,
    refetchInterval: healthInterval,
    refetchIntervalInBackground: false,
  });
  // Version / commit hash
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: fetchConfig, staleTime: 3_600_000 });
  const version: string = config?.version || 'unknown';
  const freshness = useQuery<Freshness>({
    queryKey: ['admin-freshness'],
    queryFn: async () => (await api.get('/admin/sync/freshness')).data,
    staleTime: 30_000,
    refetchInterval: freshnessInterval,
    refetchIntervalInBackground: false,
  });
  const coverage = useQuery<Coverage>({
    queryKey: ['admin-coverage'],
    queryFn: async () => (await api.get('/admin/coverage?days=14')).data,
    staleTime: 60_000,
    refetchInterval: coverageInterval,
    refetchIntervalInBackground: false,
  });
  const syncHistory = useQuery<SyncHistory>({
    queryKey: ['admin-sync-history'],
    queryFn: async () => (await api.get('/admin/sync/history?days=30')).data,
    staleTime: 60_000,
    refetchInterval: syncHistoryInterval,
    refetchIntervalInBackground: false,
  });
  const configCheck = useQuery<ConfigCheckResult>({
    queryKey: ['admin-config-check'],
    queryFn: async () => (await api.get('/admin/config-check')).data,
    staleTime: 300_000,
  });
  const diagnostics = useQuery<ForecastDiagnosticsResult>({
    queryKey: ['admin-forecast-diagnostics'],
    queryFn: async () => (await api.get('/admin/forecast/diagnostics?days=30')).data,
    staleTime: 60_000,
    refetchInterval: diagnosticsInterval,
    refetchIntervalInBackground: false,
  });

  usePageMeta({ subtitle: freshness.dataUpdatedAt ? `Updated ${formatTime(freshness.dataUpdatedAt)}` : undefined });

  const errors = summary.data?.errors24h ?? 0;
  const openEvents = (lvl: string) => {
    setLevel(lvl);
    setCategory('all');
    setTab('events');
  };

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'sync', label: 'Sync' },
    {
      value: 'events',
      label: <>Events <Count value={errors} label={`${errors} error${errors === 1 ? '' : 's'} in the last 24 hours`} /></>,
    },
    { value: 'forecast', label: 'Forecast' },
    { value: 'tools', label: 'Tools' },
  ] as const;

  return (
    <Screen>
      <Answer
        freshness={freshness.data}
        freshnessFailed={freshness.isError && !freshness.data}
        coverage={coverage.data}
        summary={summary.data}
        configChecks={configCheck.data?.checks}
        drift={diagnostics.data?.drift}
        lastSyncCheck={health.data?.lastSyncCheck}
        version={version}
        onOpenEvents={openEvents}
        onRetry={() => void freshness.refetch()}
      />

      {/* Five short words: they share a phone's width rather than scroll off it (B-175). */}
      <Seg id="debug-tab" label="Diagnostics sections" value={tab} onChange={setTab} options={tabs} className="max-sm:[&_.fp-seg-key]:px-1.5" />
      <SegPanel id="debug-tab" value={tab}>
        {tab === 'overview' && (
          <OverviewTab health={health} freshness={freshness} configCheck={configCheck} />
        )}
        {tab === 'sync' && (
          <SyncTab syncHistory={syncHistory} coverage={coverage} syncEvents={syncEvents} onOpen={setSelectedEvent} />
        )}
        {tab === 'events' && (
          <EventsTab
            events={events}
            category={category}
            level={level}
            onCategory={setCategory}
            onLevel={setLevel}
            onOpen={setSelectedEvent}
          />
        )}
        {tab === 'forecast' && (
          <ForecastTab forecastEvents={forecastEvents} diagnostics={diagnostics} onOpen={setSelectedEvent} />
        )}
        {tab === 'tools' && (
          <>
            <SleepTestCard />
            <DbExplorer />
          </>
        )}
      </SegPanel>

      {selectedEvent && <EventDetailDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </Screen>
  );
}

// ── The answer ──────────────────────────────────────────────

interface Issue { key: string; tone: Tone; title: string; meta?: string; onClick?: () => void }

function Answer({
  freshness, freshnessFailed, coverage, summary, configChecks, drift, lastSyncCheck, version, onOpenEvents, onRetry,
}: {
  freshness: Freshness | undefined;
  freshnessFailed: boolean;
  coverage: Coverage | undefined;
  summary: EventSummary | undefined;
  configChecks: ConfigCheckItem[] | undefined;
  drift: DriftInfo | undefined;
  lastSyncCheck: HealthInfo['lastSyncCheck'];
  version: string;
  onOpenEvents: (level: string) => void;
  onRetry: () => void;
}) {
  if (!freshness?.daily || !freshness?.hourly) {
    if (freshnessFailed) {
      return (
        <InstrumentPanel
          instrument={<CoverageStrip coverage={coverage} />}
          verdict={<Verdict tone="problem" note="The home server didn't answer the freshness check.">Couldn't check whether the data is up to date.</Verdict>}
        >
          <ButtonRow><Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button></ButtonRow>
        </InstrumentPanel>
      );
    }
    return <SkelInstrumentPanel readouts={4} />;
  }

  const today = homeToday();
  const days = coverage?.coverage ?? [];
  const yesterday = days.find((d) => d.date === shiftDay(today, -1));
  const daily = freshnessStatus(freshness.daily.ageHours);
  const hourly = freshnessStatus(freshness.hourly.ageHours);

  const issues: Issue[] = [];
  for (const [name, f, st] of [['Hourly', freshness.hourly, hourly], ['Daily', freshness.daily, daily]] as const) {
    if (st.tone === 'headsup' || st.tone === 'problem') {
      issues.push({
        key: `fresh-${name}`, tone: st.tone,
        title: `${name} data is ${st.label.toLowerCase()}`,
        meta: f.dataThroughDate ? `Newest is ${formatDate(f.dataThroughDate)}, ${f.ageHours} hr old` : 'Nothing has arrived yet',
      });
    }
  }
  if (summary && summary.errors24h > 0) {
    issues.push({
      key: 'errors', tone: 'headsup', title: `${plural(summary.errors24h, 'error')} in the last 24 hours`,
      meta: 'Open the event log', onClick: () => onOpenEvents('ERROR'),
    });
  }
  for (const d of days) {
    if (coverageState(d, today) === 'warn') {
      issues.push({
        key: `partial-${d.date}`, tone: 'headsup',
        title: `${formatDate(d.date)} has only ${d.hourlyNonZero} of ${coverage?.expectedHourly ?? 24} hours`,
        meta: 'Run a sync for that day before CoServ drops it (it keeps about two weeks)',
      });
    }
  }
  for (const c of configChecks ?? []) {
    if (c.status !== 'OK') issues.push({ key: `cfg-${c.check}`, tone: 'headsup', title: c.check, meta: c.detail });
  }

  const fresh = daily.tone === 'ok' && hourly.tone === 'ok';
  const behind = daily.tone === 'problem' || hourly.tone === 'problem';
  const tone = issues.length ? worstTone(issues.map((i) => i.tone)) : fresh ? 'ok' : 'neutral';
  const others = issues.filter((i) => !i.key.startsWith('fresh-')).length;
  const sentence = behind
    ? 'Electric data is behind.'
    : !fresh
      ? daily.tone === 'neutral' && hourly.tone === 'neutral' ? 'No electric data has arrived yet.' : 'Electric data is running late.'
      : others
        ? `Electric data is up to date; ${others === 1 ? 'one thing needs' : `${others} things need`} a look.`
        : 'Electric data is up to date.';
  const lampTone = (st: { tone: Tone }) => st.tone;

  return (
    <InstrumentPanel
      instrument={
        <div className="flex w-full flex-col gap-4">
          <CoverageStrip coverage={coverage} />
          <LampRow
            label="Data pipeline"
            items={[
              { key: 'hourly', label: 'Hourly', tone: lampTone(hourly) },
              { key: 'daily', label: 'Daily', tone: lampTone(daily) },
              { key: 'weather', label: 'Weather', tone: yesterday ? (yesterday.weatherPresent ? 'ok' : 'headsup') : 'neutral' },
              { key: 'forecast', label: 'Forecast', tone: drift ? driftStatus(drift.state).tone : 'neutral' },
              { key: 'settings', label: 'Settings', tone: configChecks ? (configChecks.some((c) => c.status !== 'OK') ? 'headsup' : 'ok') : 'neutral' },
            ]}
          />
        </div>
      }
      verdict={
        <Verdict
          tone={tone}
          note={`Hourly readings through ${formatDateTime(freshness.hourly.dataThrough ?? freshness.hourly.dataThroughDate)}; daily through ${formatDate(freshness.daily.dataThroughDate)}.`}
        >
          {sentence}
        </Verdict>
      }
      readouts={
        <Readouts count={4}>
          <Readout
            label="Hourly"
            value={yesterday ? yesterday.hourlyNonZero : '—'}
            unit={`of ${coverage?.expectedHourly ?? 24} h`}
            note={yesterday ? `Yesterday, ${formatShortDate(yesterday.date)}` : 'Yesterday'}
          />
          <Readout
            label="Daily"
            value={freshness.daily.dataThroughDate ? formatShortDate(freshness.daily.dataThroughDate) : '—'}
            note={freshness.daily.lastSuccess ? `Last success ${formatStamp(freshness.daily.lastSuccess)}` : 'No success yet'}
          />
          <Readout
            label="Errors"
            tone={summary && summary.errors24h > 0 ? 'headsup' : undefined}
            value={summary?.errors24h ?? '—'}
            note="Last 24 hours"
            onClick={() => onOpenEvents('ERROR')}
          />
          <Readout
            label="Warnings"
            tone={summary && summary.warns24h > 0 ? 'headsup' : undefined}
            value={summary?.warns24h ?? '—'}
            note={summary ? `Of ${plural(summary.total24h, 'event')}` : 'Last 24 hours'}
            onClick={() => onOpenEvents('WARN')}
          />
        </Readouts>
      }
      foot={
        <>
          <span className="fp-mono">{lastSyncCheck ? `Last sync check ${formatStamp(lastSyncCheck.timestamp)}` : 'No sync check yet'}</span>
          <span className="fp-mono">Build {version}</span>
        </>
      }
    >
      {issues.length > 0 && (
        <List inset aria-label="Needs a look">
          {issues.map((i) => (
            <Row key={i.key} compact lamp={i.tone} title={i.title} meta={i.meta} onClick={i.onClick} chevron={!!i.onClick} />
          ))}
        </List>
      )}
    </InstrumentPanel>
  );
}

/** The 14-day coverage as a lamp matrix, oldest left, today right. */
function CoverageStrip({ coverage }: { coverage: Coverage | undefined }) {
  const today = homeToday();
  const days = coverage?.coverage ?? [];
  if (!days.length) {
    return <EmptyState compact icon="calendar" title="No coverage yet">The strip fills in as days of readings arrive.</EmptyState>;
  }
  const expected = coverage?.expectedHourly ?? 24;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const cells: MatrixCell[] = sorted.map((d, i) => ({
    label: d.date === today ? `Today, ${formatShortDate(d.date)}` : formatDate(d.date),
    short: i === 0 || i === Math.floor(sorted.length / 2) ? formatShortDate(d.date) : i === sorted.length - 1 ? (d.date === today ? 'Today' : formatShortDate(d.date)) : '',
    state: coverageState(d, today),
    note: `${d.hourlyNonZero} of ${expected} hours · daily ${d.dailyPresent ? 'in' : 'missing'} · weather ${d.weatherPresent ? 'in' : 'missing'}`,
  }));
  const complete = sorted.filter((d) => d.hourlyComplete).length;
  const past = sorted.filter((d) => d.date !== today).length;
  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="fp-label">Last {sorted.length} days</p>
        <span className="fp-mono text-xs text-apptext-muted">{complete} of {past} complete</span>
      </div>
      <LampMatrix
        cells={cells}
        caption={`${complete} of the last ${past} days are complete.`}
        words={{ ok: 'Complete', warn: 'Partial day', problem: 'Missing', off: 'Not yet' }}
      />
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────

type Q<T> = { data: T | undefined; isError: boolean; isFetching: boolean; dataUpdatedAt: number; refetch: () => unknown };
const objectEmpty = (d: unknown) => d == null || Array.isArray(d);

function OverviewTab({ health, freshness, configCheck }: { health: Q<HealthInfo>; freshness: Q<Freshness>; configCheck: Q<ConfigCheckResult> }) {
  return (
    <Split>
      <Stack gap="page">
        <Panel title="Freshness" subtitle="Yesterday is the newest day CoServ posts, so that is as fresh as it gets">
          <QueryState query={freshness} what="the freshness check" compact isEmpty={(f) => objectEmpty(f) || !f.daily}>
            {(f) => (
              <List>
                {([['Hourly readings', f.hourly, 'clock'], ['Daily readings', f.daily, 'calendar']] as const).map(([label, b, icon]) => {
                  const st = freshnessStatus(b.ageHours);
                  return (
                    <Row
                      key={label}
                      icon={icon}
                      title={label}
                      meta={
                        <>
                          Through {b.dataThroughDate ? formatDate(b.dataThroughDate) : '—'}
                          {b.ageHours != null ? ` (${b.ageHours} hr ago)` : ''} · last success {formatStamp(b.lastSuccess)} · last try {formatStamp(b.lastAttempt)}
                        </>
                      }
                      trail={<Badge tone={st.tone}>{st.label}</Badge>}
                    />
                  );
                })}
              </List>
            )}
          </QueryState>
          {health.data?.lastSyncCheck && (
            <div className="mt-3 border-t border-appborder pt-3">
              <p className="fp-label">Last sync check · {formatStamp(health.data.lastSyncCheck.timestamp)}</p>
              <p className="fp-mono mt-1 break-words text-sm">{health.data.lastSyncCheck.message}</p>
            </div>
          )}
        </Panel>
      </Stack>

      <Stack gap="page">
        <Panel
          title="App server"
          subtitle="The backend inside Docker on the home server"
          action={<LinkButton to="/admin/nuc" size="sm" variant="quiet" iconEnd="arrow-right">Server health</LinkButton>}
        >
          <QueryState query={health} what="the app server" compact isEmpty={(h) => objectEmpty(h) || !h.jvm}>
            {(h) => {
              const up = h.database?.status === 'UP';
              const url = 'url' in h.database ? h.database.url?.replace(/[?&]password=[^&]*/, '') : null;
              const err = 'error' in h.database ? h.database.error : null;
              return (
                <>
                  {/* Four wells in a 2 × 2, so the pool never sits alone on a row (B-171). */}
                  <Readouts square>
                    {/* B-172: one duration style ("3 days 5 hr"), not "3d 305m". */}
                    <Readout label="Up for" value={formatDuration(h.jvm.uptimeMinutes)} note={h.jvm.startTime ? `Since ${formatStamp(h.jvm.startTime)}` : undefined} />
                    <Readout label="Memory" value={h.jvm.heapUsedMB} unit="MB" note={`Of ${formatNumber(h.jvm.heapMaxMB)} MB allowed`} />
                    <Readout label="Threads" value={h.threads} />
                    {h.pool ? (
                      <Readout
                        label="Database pool"
                        tone={h.pool.awaitingConnection > 0 ? 'problem' : undefined}
                        value={h.pool.active}
                        unit={`of ${h.pool.max} busy`}
                        note={`${h.pool.idle} idle${h.pool.awaitingConnection > 0 ? `, ${h.pool.awaitingConnection} waiting` : ', none waiting'}`}
                      />
                    ) : (
                      <Readout label="Database pool" value="—" note="Not reported" />
                    )}
                  </Readouts>
                  <KeyValue className="mt-3">
                    <KV label="Database" tone={up ? 'ok' : 'problem'} value={up ? 'Up' : h.database?.status ?? 'Unknown'} />
                    {url && <KV label="Address" value={<span className="break-all">{url}</span>} mono />}
                    {err && <KV label="Error" value={<span className="break-words">{err}</span>} tone="problem" />}
                  </KeyValue>
                </>
              );
            }}
          </QueryState>
        </Panel>

        <Panel
          title="Settings checks"
          subtitle={configCheck.data?.checks ? `${configCheck.data.checks.filter((c) => c.status === 'OK').length} of ${configCheck.data.checks.length} look right` : undefined}
        >
          <QueryState
            query={configCheck}
            what="the settings checks"
            compact
            isEmpty={(c) => objectEmpty(c) || !c.checks?.length}
            empty={<EmptyState compact title="No settings checks reported" />}
          >
            {(c) => (
              <List>
                {c.checks.map((x) => (
                  <Row key={x.check} compact lamp={checkStatus(x.status).tone} title={x.check} meta={x.detail} />
                ))}
              </List>
            )}
          </QueryState>
        </Panel>
      </Stack>
    </Split>
  );
}

// ── Sync ────────────────────────────────────────────────────

function SyncTab({ syncHistory, coverage, syncEvents, onOpen }: {
  syncHistory: Q<SyncHistory>;
  coverage: Q<Coverage>;
  syncEvents: Q<AppEvent[]>;
  onOpen: (e: AppEvent) => void;
}) {
  return (
    <>
      <ManualSync />
      <Split>
        <Panel title="Recent sync runs" subtitle="The last three days, newest first">
          <QueryState
            query={syncEvents}
            what="the sync runs"
            compact
            empty={<EmptyState compact title="No sync runs in the last three days">The schedulers run every 30 minutes from 7 AM; manual runs show here too.</EmptyState>}
          >
            {(list) => <EventList events={list.slice(0, 8)} onOpen={onOpen} />}
          </QueryState>
        </Panel>
        <Panel title="Sync reliability" subtitle={syncHistory.data?.days ? `Last ${syncHistory.data.days} days, by scheduler` : 'By scheduler'}>
          <QueryState
            query={syncHistory}
            what="the sync history"
            compact
            isEmpty={(h) => objectEmpty(h) || !h.bySource?.length}
            empty={<EmptyState compact title="No runs recorded yet" />}
          >
            {(h) => (
              <List>
                {h.bySource.map((s) => {
                  const rate = s.successRate;
                  const tone: Tone = rate == null ? 'neutral' : rate >= 90 ? 'ok' : rate >= 70 ? 'headsup' : 'problem';
                  return (
                    <Row
                      key={s.source}
                      title={s.source}
                      meta={`${plural(s.total, 'run')} · ${s.ok} OK · ${s.warn} warning · ${s.error} failed · last ${formatStamp(s.lastRun)}`}
                      trail={<StatusText tone={tone} className="whitespace-nowrap font-semibold">{rate != null ? `${rate}% OK` : '—'}</StatusText>}
                    />
                  );
                })}
              </List>
            )}
          </QueryState>
        </Panel>
      </Split>
      <CoverageDetail coverage={coverage} />
    </>
  );
}

/** The coverage strip's numbers, day by day, for the curious. */
function CoverageDetail({ coverage }: { coverage: Q<Coverage> }) {
  const c = coverage.data;
  if (!c?.coverage?.length) return null;
  const today = homeToday();
  const rows = [...c.coverage].sort((a, b) => b.date.localeCompare(a.date));
  const columns: Column<CoverageDay>[] = [
    { key: 'date', header: 'Day', kind: 'title', cell: (d) => formatDate(d.date) },
    { key: 'hours', header: 'Hourly', kind: 'key', num: true, strong: true, cell: (d) => `${d.hourlyNonZero} of ${c.expectedHourly}` },
    { key: 'daily', header: 'Daily row', cell: (d) => (d.dailyPresent ? 'In' : 'Missing') },
    { key: 'weather', header: 'Weather', cell: (d) => (d.weatherPresent ? 'In' : 'Missing') },
    {
      key: 'state', header: 'Status', cell: (d) => {
        const s = coverageState(d, today);
        const words: Record<CellState, [Tone, string]> = { ok: ['ok', 'Complete'], warn: ['headsup', 'Partial'], problem: ['problem', 'Missing'], info: ['info', 'Info'], off: ['neutral', 'Not yet'] };
        return <Badge tone={words[s][0]}>{words[s][1]}</Badge>;
      },
    },
  ];
  return (
    <Panel flush aria-label="Coverage by day">
      <Disclosure variant="row" summary="Coverage by day" openSummary="Hide coverage by day">
        <p className="fp-small fp-muted mb-2">
          A day is complete at {c.completeThreshold} or more non-zero hourly readings of {c.expectedHourly}.
        </p>
        <DataTable rows={rows} rowKey={(d) => d.date} columns={columns} caption="Data coverage by day" />
      </Disclosure>
    </Panel>
  );
}

function ManualSync() {
  const yesterday = shiftDay(homeToday(), -1);
  const todayIso = homeToday();
  const earliestIso = shiftDay(todayIso, -MAX_RANGE_DAYS);
  const [preset, setPreset] = useState<'yesterday' | 'range'>('yesterday');
  const [startDate, setStartDate] = useState(yesterday);
  const [endDate, setEndDate] = useState(yesterday);

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
  const blocked = preset === 'range' && !!rangeError;

  return (
    <Panel title="Run a sync" subtitle="Syncs run in the background; their results land in Recent sync runs and the event log">
      <Stack>
        <Seg
          kind="radio"
          fit="inline"
          label="Days to sync"
          value={preset}
          onChange={setPreset}
          options={[{ value: 'yesterday', label: 'Yesterday' }, { value: 'range', label: 'Custom range' }]}
        />
        {preset === 'range' && (
          <FormGrid>
            {/* Real labels (B-042), and the inputs follow the theme's colour scheme (B-173). */}
            <Field label="Start date" error={rangeError && rangeError.startsWith('Start') ? rangeError : undefined}>
              <Input type="date" value={startDate} min={earliestIso} max={todayIso} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End date" error={rangeError && !rangeError.startsWith('Start') ? rangeError : undefined}>
              <Input type="date" value={endDate} min={earliestIso} max={todayIso} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </FormGrid>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SyncButton label="Daily sync" icon="calendar" endpoint="/admin/sync/daily" body={syncBody} disabled={blocked} primary />
          <SyncButton label="Hourly sync" icon="clock" endpoint="/admin/sync/hourly" body={syncBody} disabled={blocked} />
          <SyncButton label="Generate alerts" icon="bell" endpoint="/admin/sync/alerts" />
          <SyncButton label="Retrain forecast" icon="bar-chart" endpoint="/admin/sync/forecast" />
        </div>
      </Stack>
    </Panel>
  );
}

/**
 * A manual trigger: POSTs to a sync endpoint and says what happened under the key, success
 * or failure with the server's reason (B-174). The result clears after a while, and as soon
 * as the date range changes, so an old tick never vouches for a new range.
 */
function SyncButton({ label, icon, endpoint, body, disabled, primary }: {
  label: string;
  icon: 'calendar' | 'clock' | 'bell' | 'bar-chart';
  endpoint: string;
  body?: { startDate: string; endDate: string };
  disabled?: boolean;
  primary?: boolean;
}) {
  const queryClient = useQueryClient();
  const trigger = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(endpoint, body);
      return data as { status?: string };
    },
    onSuccess: () => {
      // The ["admin-events"] prefix covers the filtered log and the Sync / Forecast lists.
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      queryClient.invalidateQueries({ queryKey: ['admin-events-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin-health'] });
    },
  });
  const { reset, isSuccess, isError } = trigger;
  const bodyKey = body ? `${body.startDate}..${body.endDate}` : 'yesterday';
  useEffect(() => { reset(); }, [bodyKey, reset]);
  useEffect(() => {
    if (!isSuccess && !isError) return;
    const t = window.setTimeout(() => reset(), isError ? 15_000 : 8_000);
    return () => window.clearTimeout(t);
  }, [isSuccess, isError, reset]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Button
        variant={primary ? 'primary' : 'secondary'}
        icon={icon}
        block
        onClick={() => trigger.mutate()}
        disabled={disabled}
        busy={trigger.isPending}
        busyLabel="Starting…"
      >
        {label}
      </Button>
      <p className="fp-small min-h-[1.25em]" role="status">
        {trigger.isSuccess && <StatusText tone="ok">Started{body ? ` for ${formatShortDate(body.startDate)} – ${formatShortDate(body.endDate)}` : ''}.</StatusText>}
        {trigger.isError && <StatusText tone="problem">Failed: {errorMessage(trigger.error, 'the server refused it')}.</StatusText>}
      </p>
    </div>
  );
}

// ── Events ──────────────────────────────────────────────────

/** Rows shown before "Show N more" (the log never scrolls in a box of its own; B-006). */
const EVENT_ROWS = 25;

function EventList({ events, onOpen }: { events: AppEvent[]; onOpen: (e: AppEvent) => void }) {
  const row = (e: AppEvent) => {
    const st = eventLevelStatus(e.level);
    return (
      <Row
        key={e.id}
        compact
        lamp={st.tone}
        regularTitle
        title={<span className="line-clamp-2 break-words">{e.message}</span>}
        meta={<><span className="fp-mono">{formatStamp(e.timestamp, { time: 'always' })}</span> · {categoryLabel(e.category)} · {e.source}</>}
        onClick={() => onOpen(e)}
      />
    );
  };
  const head = events.slice(0, EVENT_ROWS);
  const rest = events.slice(EVENT_ROWS);
  return (
    <>
      <List>{head.map(row)}</List>
      {rest.length > 0 && (
        <Disclosure variant="row" summary={`Show ${plural(rest.length, 'more event')}`} openSummary="Show fewer">
          <List>{rest.map(row)}</List>
        </Disclosure>
      )}
    </>
  );
}

function EventsTab({ events, category, level, onCategory, onLevel, onOpen }: {
  events: Q<AppEvent[]>;
  category: string;
  level: string;
  onCategory: (c: string) => void;
  onLevel: (l: string) => void;
  onOpen: (e: AppEvent) => void;
}) {
  const filtering = category !== 'all' || level !== 'all';
  return (
    <Panel title="Diagnostic log" subtitle="The last three days, newest first. Tap an event for its details">
      <FormGrid className="mb-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => onCategory(e.target.value)} options={CATEGORIES} />
        </Field>
        <Field label="Level">
          <Select value={level} onChange={(e) => onLevel(e.target.value)} options={LEVELS} />
        </Field>
      </FormGrid>
      <QueryState
        query={events}
        what="the event log"
        compact
        empty={
          filtering ? (
            <EmptyState
              compact
              title="No events match these filters"
              action={<Button size="sm" onClick={() => { onCategory('all'); onLevel('all'); }}>Clear filters</Button>}
            >
              Nothing in the last three days is {[category !== 'all' && categoryLabel(category), level !== 'all' && LEVELS.find((l) => l.value === level)?.label.toLowerCase()].filter(Boolean).join(' and ')}.
            </EmptyState>
          ) : (
            <EmptyState compact icon="activity" title="No events in the last three days">Syncs, forecasts and restarts are logged here as they happen.</EmptyState>
          )
        }
      >
        {(list) => <EventList events={list} onOpen={onOpen} />}
      </QueryState>
    </Panel>
  );
}

/** One event in full: message and details at full width, in the kit's dialog. */
function EventDetailDialog({ event, onClose }: { event: AppEvent; onClose: () => void }) {
  const st = eventLevelStatus(event.level);
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={categoryLabel(event.category)}
      title="Event details"
      subtitle={formatDateTime(event.timestamp)}
      footer={<Button variant="quiet" onClick={onClose}>Close</Button>}
    >
      <Stack>
        <div className="fp-cluster">
          <Badge status={st} />
          <Tag>{categoryLabel(event.category)}</Tag>
          <span className="fp-mono fp-small fp-muted">{event.source}</span>
        </div>
        <div>
          <p className="fp-label">Message</p>
          <p className="mt-1.5 break-words">{event.message}</p>
        </div>
        <div>
          <p className="fp-label">Details</p>
          {event.details ? (
            <pre className="fp-mono mt-1.5 whitespace-pre-wrap break-words rounded-well bg-appinset p-3 text-xs leading-relaxed">{event.details}</pre>
          ) : (
            <p className="fp-small fp-muted mt-1.5">No additional details for this event.</p>
          )}
        </div>
      </Stack>
    </Dialog>
  );
}

// ── Forecast ────────────────────────────────────────────────

function ForecastTab({ forecastEvents, diagnostics, onOpen }: {
  forecastEvents: Q<AppEvent[]>;
  diagnostics: Q<ForecastDiagnosticsResult>;
  onOpen: (e: AppEvent) => void;
}) {
  return (
    <>
      <Panel
        title="Accuracy and drift"
        subtitle="Why recent forecasts missed, and whether the misses look like one odd day or a model drifting off"
        action={diagnostics.data?.drift ? <Badge status={driftStatus(diagnostics.data.drift.state)} /> : undefined}
      >
        <QueryState query={diagnostics} what="the forecast diagnostics" compact isEmpty={(d) => objectEmpty(d) || !d.drift}>
          {(d) => {
            const columns: Column<DiagnosticDay>[] = [
              { key: 'date', header: 'Day', kind: 'title', cell: (x) => formatDate(x.date) },
              { key: 'actual', header: 'Actual, kWh', num: true, strong: true, cell: (x) => formatNumber(x.actual, { decimals: 1, fixed: true }) },
              { key: 'predicted', header: 'Predicted, kWh', num: true, cell: (x) => formatNumber(x.predicted, { decimals: 1, fixed: true }) },
              // B-170: the residual at the same precision as the two columns it is the difference of.
              { key: 'residual', header: 'Residual, kWh', num: true, kind: 'key', cell: (x) => fmtSigned1(x.residual) },
              { key: 'score', header: 'Score', num: true, cell: (x) => (x.anomalyScore != null ? formatNumber(x.anomalyScore, { decimals: 2, fixed: true }) : '—') },
              { key: 'class', header: 'Class', cell: (x) => <Badge status={anomalyStatus(x.anomalyClassification)} /> },
            ];
            return (
              <Stack>
                <Readouts count={4}>
                  <Readout label="Historical MAE" value={fmtKwh1(d.drift.historicalMae)} />
                  <Readout label="Recent MAE" value={fmtKwh1(d.drift.recentMae)} />
                  <Readout label="MAE ratio" value={d.drift.maeRatio != null ? `${formatNumber(d.drift.maeRatio, { decimals: 2, fixed: true })}×` : '—'} />
                  <Readout label="Recent bias" value={fmtSigned1(d.drift.recentBias)} unit="kWh" />
                </Readouts>
                <p className="fp-small fp-muted">
                  {plural(d.drift.sampleCount, 'graded day')} in the drift window
                  {d.drift.streakLength > 0 && d.drift.streakSign !== 0 && (
                    <> · a {d.drift.streakLength}-day streak of usage running {d.drift.streakSign > 0 ? 'above' : 'below'} the forecast</>
                  )}
                </p>
                {d.daily.length ? (
                  <DataTable rows={[...d.daily].reverse()} rowKey={(x) => x.date} columns={columns} caption="Forecast accuracy by day" />
                ) : (
                  <EmptyState compact title={`No graded forecast days in the last ${d.trailingDays} days yet`} />
                )}
              </Stack>
            );
          }}
        </QueryState>
      </Panel>
      <Panel
        title="Events received"
        subtitle="Every ingestion event the forecast reacted to, including no-ops where a sync ran but no new reading had landed"
      >
        <QueryState
          query={forecastEvents}
          what="the forecast events"
          compact
          empty={<EmptyState compact title="No forecast events in the last three days" />}
        >
          {(list) => <EventList events={list.slice(0, 8)} onOpen={onOpen} />}
        </QueryState>
      </Panel>
    </>
  );
}

// ── Tools ───────────────────────────────────────────────────

/** Try the sleep screen without waiting 10 minutes. */
function SleepTestCard() {
  const [started, setStarted] = useState(false);
  return (
    <Panel
      title="Test the sleep screen"
      subtitle={
        started
          ? 'On: hands off the mouse and keys. The countdown shows in 20 s and the app sleeps at 30 s. Waking puts it back to 10 minutes.'
          : 'Makes the next sleep come after 30 s of no activity instead of 10 minutes, once. On a phone, open any page with ?sleepTest on the address instead.'
      }
      action={
        <Button
          size="sm"
          icon="moon"
          onClick={() => {
            startSleepTest();
            setStarted(true);
          }}
        >
          {started ? 'Restart test' : 'Start 30 s test'}
        </Button>
      }
    />
  );
}

interface TableInfo {
  schema: string;
  name: string;
  size: string;
  columns: number;
}

interface QueryResult { columns: string[]; rows: (string | null)[][]; rowCount: number; truncated?: boolean; error?: string }

function DbExplorer() {
  const [query, setQuery] = useState(
  `-- Pick a table above, or write your own SQL
SELECT * FROM app_events
WHERE timestamp >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY timestamp DESC
LIMIT 50`);

  const tables = useQuery<TableInfo[]>({
    queryKey: ['admin-db-tables'],
    queryFn: async () => (await api.get('/admin/db/tables')).data,
    staleTime: 60_000,
  });
  const { data: dbStats } = useQuery<{ rowCounts: Record<string, number>; dbSizePretty: string }>({
    queryKey: ['admin-db-stats'],
    queryFn: async () => (await api.get('/admin/db/stats')).data,
    staleTime: 60_000,
  });

  const queryMutation = useMutation({
    mutationFn: async (sql: string) => (await api.post('/admin/db/query', { query: sql })).data as QueryResult,
  });

  const run = () => {
    if (query.trim()) queryMutation.mutate(query);
  };

  const results = queryMutation.data;
  // The server answers a bad query with HTTP 400/500 and { error }, so the failure is the
  // mutation's error, not its data (B-036). A 200 carrying an error is shown the same way.
  const failure = queryMutation.isError
    ? errorMessage(queryMutation.error, 'Query failed')
    : results?.error ?? null;
  const counts = Object.entries(dbStats?.rowCounts ?? {}).filter(([, v]) => v > 0);

  return (
    <Panel title="Query console" subtitle={dbStats?.dbSizePretty ? `Database size ${dbStats.dbSizePretty}. Read-only; secrets come back redacted` : 'Read-only; secrets come back redacted'}>
      <Stack>
        {counts.length > 0 && (
          <Disclosure summary="Row counts" openSummary="Hide row counts">
            <KeyValue cols>
              {counts.map(([k, v]) => <KV key={k} label={<span className="fp-mono">{k}</span>} value={formatNumber(v)} />)}
            </KeyValue>
          </Disclosure>
        )}
        {tables.data && tables.data.length > 0 && (
          <div>
            <p className="fp-label mb-2">Tables</p>
            <div className="flex flex-wrap gap-2">
              {tables.data.map((t) => (
                <Button key={t.name} size="sm" variant="quiet" className="fp-mono" title={`${t.size} · ${t.columns} columns`} onClick={() => setQuery(tablePreset(t.name))}>
                  {t.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        {tables.isError && !tables.data && (
          <Notice tone="headsup" title="Couldn't load the table list." action={<Button size="sm" icon="refresh" onClick={() => void tables.refetch()}>Try again</Button>} />
        )}
        <form
          className="fp-stack fp-stack--s"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <Field label="SQL" help="Ctrl+Enter runs it">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={5}
              className="fp-mono"
              spellCheck={false}
              placeholder="SELECT * FROM electric_usage ORDER BY timestamp DESC LIMIT 20"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  run();
                }
              }}
            />
          </Field>
          <ButtonRow end>
            <Button type="submit" variant="primary" icon="play" busy={queryMutation.isPending} busyLabel="Running…">Run</Button>
          </ButtonRow>
        </form>

        {failure && (
          <Notice tone="problem" live="assertive" title="The query failed.">
            <span className="fp-mono break-words">{failure}</span>
          </Notice>
        )}

        {results && !failure && <ResultsTable results={results} />}
      </Stack>
    </Panel>
  );
}

function ResultsTable({ results }: { results: QueryResult }) {
  const columns: Column<{ i: number; row: (string | null)[] }>[] = results.columns.map((col, ci) => ({
    key: `${ci}`,
    header: col,
    kind: ci === 0 ? 'title' : undefined,
    cell: ({ row }) => cellText(row[ci]),
  }));
  return (
    <div>
      <p className="fp-small fp-muted mb-2">{plural(results.rowCount, 'row')}{results.truncated ? ' (limited to 200)' : ''}</p>
      {results.rows.length ? (
        <DataTable rows={results.rows.map((row, i) => ({ i, row }))} rowKey={(r) => r.i} columns={columns} caption="Query results" />
      ) : (
        <EmptyState compact title="No rows" />
      )}
    </div>
  );
}

function cellText(cell: string | null): ReactNode {
  if (cell == null) return <span className="fp-muted italic">NULL</span>;
  if (cell === '***REDACTED***') return <span className="fp-t-warn italic">redacted</span>;
  return <span className="break-all">{cell}</span>;
}
