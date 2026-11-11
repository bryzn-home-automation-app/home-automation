import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllUsers, fetchGuestSessions } from '../../api/auth';
import { fetchThermostatActivity } from '../../api/climate';
import {
  Button,
  Chips,
  Dial,
  DialCentre,
  DialLegend,
  Disclosure,
  EmptyState,
  InstrumentPanel,
  Notice,
  Num,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Screen,
  SkelInstrumentPanel,
  SkelPanel,
  Timeline,
  Verdict,
  type ChartTone,
  type TimelineItem,
} from '../../components/ui';
import { usePageMeta } from '../../components/shell/PageMeta';
import { formatDate, formatHour, formatTime, homeClock, homeDayKey, daysBetween, plural } from '../../utils/format';
import type { Tone } from '../../utils/status';
import { buildActivityLog, KIND_GROUP, kindTone, type LogEntry, type LogGroup } from './activityLog';

/** How far back thermostat changes go in the feed. */
const THERMOSTAT_DAYS = 30;
/** Timeline rows shown before "Show older". */
const FIRST_ROWS = 30;

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'thermostat', label: 'Thermostat', icon: 'thermometer' },
  { value: 'signin', label: 'Sign-ins', icon: 'log-in' },
  { value: 'guest', label: 'Guests', icon: 'id-card' },
  { value: 'account', label: 'Accounts', icon: 'user' },
] as const;
type Filter = 'all' | LogGroup;

const TONE_CHART: Record<Tone, ChartTone> = { ok: 'ok', headsup: 'warn', problem: 'problem', info: 'info', neutral: 'graphite' };

/** The fractional hour of the day at home (7:45 PM → 19.75), for the 24-hour ring. */
function hourOfDay(ts: string): number | null {
  const c = homeClock(ts);
  return c && c.hasTime ? c.hour + c.minute / 60 : null;
}

function useActivityLog() {
  const users = useQuery({ queryKey: ['admin-users'], queryFn: fetchAllUsers });
  const sessions = useQuery({ queryKey: ['admin-guest-sessions'], queryFn: fetchGuestSessions });
  const thermostats = useQuery({
    queryKey: ['thermostat-activity', THERMOSTAT_DAYS],
    queryFn: () => fetchThermostatActivity(THERMOSTAT_DAYS),
    refetchInterval: 60_000,
  });
  const logs = useMemo(
    () => buildActivityLog(users.data ?? [], sessions.data ?? [], thermostats.data ?? []),
    [users.data, sessions.data, thermostats.data],
  );
  // The feed is ready once all three have answered (B-169: guest and thermostat rows used to
  // pop in after the skeleton had gone). People are the backbone: without them there's no log.
  const settled = [users, sessions, thermostats].every((q) => q.data !== undefined || q.isError);
  const waiting = new Set((users.data ?? []).filter((u) => u.status === 'PENDING_APPROVAL').map((u) => `register-${u.id}`));
  const query = {
    data: settled && users.data !== undefined ? logs : undefined,
    isError: users.isError,
    isFetching: users.isFetching,
    dataUpdatedAt: users.dataUpdatedAt,
    refetch: () => users.refetch(),
  };
  // A part that failed is said once, not silently left out of the feed.
  const missing: Array<{ what: string; retry: () => void }> = [];
  if (sessions.isError && !sessions.data) missing.push({ what: 'guest check-ins', retry: () => void sessions.refetch() });
  if (thermostats.isError && !thermostats.data) missing.push({ what: 'thermostat changes', retry: () => void thermostats.refetch() });
  return { query, waiting, missing, pending: (users.data ?? []).filter((u) => u.status === 'PENDING_APPROVAL') };
}

function Answer({ logs, waiting, pendingNames }: { logs: LogEntry[]; waiting: Set<string>; pendingNames: string[] }) {
  const today = homeDayKey();
  const todays = logs.filter((e) => homeDayKey(e.timestamp) === today);
  const latest = logs[0];
  const count = (g: LogGroup) => todays.filter((e) => KIND_GROUP[e.kind] === g).length;
  const breakdown = [
    count('thermostat') && plural(count('thermostat'), 'thermostat change'),
    count('signin') && plural(count('signin'), 'sign-in'),
    count('guest') && plural(count('guest'), 'guest'),
    count('account') && plural(count('account'), 'account event'),
  ].filter(Boolean).join(', ');
  const weekThermo = logs.filter((e) => e.kind === 'thermostat' && (daysBetween(e.timestamp, new Date()) ?? 99) < 7);
  const marks = todays
    .map((e) => ({ at: hourOfDay(e.timestamp), tone: TONE_CHART[kindTone(e, waiting.has(e.id))] }))
    .filter((m): m is { at: number; tone: ChartTone } => m.at != null)
    .map((m) => ({ ...m, inset: 1, out: 1 }));
  const nowHour = hourOfDay(new Date().toISOString()) ?? 0;
  const latestTone = latest ? kindTone(latest, waiting.has(latest.id)) : 'neutral';
  return (
    <InstrumentPanel
      instrument={
        <>
          <Dial
            start={180}
            sweep={360}
            label={`Today's events on a 24-hour ring: ${todays.length ? todays.map((e) => `${e.description} at ${formatTime(e.timestamp)}`).join('; ') : 'none yet'}.`}
            rings={[
              {
                r: 84, w: 12, min: 0, max: 24, edge: true, ticks: 24, major: 6,
                labels: [[0, formatHour(0)], [6, formatHour(6)], [12, formatHour(12)], [18, formatHour(18)]],
                marks,
              },
              { r: 68, w: 4, min: 0, max: 24, track: false, segments: [{ from: 0, to: nowHour, tone: 'soft' }] },
            ]}
          >
            <DialCentre label="Today" note={todays.length ? `latest ${formatTime(todays[0].timestamp)}` : 'nothing yet'} noteMono>
              <Num size="xl" value={todays.length} unit={todays.length === 1 ? 'event' : 'events'} />
            </DialCentre>
          </Dial>
          <DialLegend
            items={[
              { label: 'Thermostat', value: count('thermostat'), tone: 'info', key: 'mark' },
              { label: 'Sign-in', value: count('signin'), tone: 'graphite', key: 'mark' },
              { label: 'Guest', value: count('guest'), tone: 'ok', key: 'mark' },
            ]}
          />
        </>
      }
      verdict={
        latest ? (
          <Verdict tone={latestTone === 'neutral' ? 'info' : latestTone} note={breakdown ? `Today: ${breakdown}.` : 'Nothing has happened yet today.'}>
            {latest.description} {homeDayKey(latest.timestamp) === today ? `at ${formatTime(latest.timestamp)}` : `on ${formatDate(latest.timestamp)}`}.
          </Verdict>
        ) : (
          <Verdict tone="neutral">Nothing has been logged yet.</Verdict>
        )
      }
      readouts={
        <Readouts count={3}>
          <Readout label="Today" value={todays.length} unit={todays.length === 1 ? 'event' : 'events'} note={breakdown || 'None yet'} />
          <Readout label="Thermostat" value={weekThermo.length} unit={weekThermo.length === 1 ? 'change' : 'changes'} note="Last 7 days" />
          <Readout
            label="Waiting"
            tone={pendingNames.length ? 'headsup' : undefined}
            value={pendingNames.length}
            unit="to approve"
            note={pendingNames.length ? `${pendingNames.join(', ')} asked to join` : 'Nobody is waiting'}
            to={pendingNames.length ? '/users' : undefined}
          />
        </Readouts>
      }
    />
  );
}

function toItems(logs: LogEntry[], waiting: Set<string>): TimelineItem[] {
  return logs.map((e) => ({
    id: e.id,
    at: e.timestamp,
    time: formatTime(e.timestamp),
    title: e.description,
    meta: e.meta,
    tone: kindTone(e, waiting.has(e.id)),
  }));
}

export default function AuditLogs() {
  const { query, waiting, missing, pending } = useActivityLog();
  const [filter, setFilter] = useState<Filter>('all');
  usePageMeta({ subtitle: query.dataUpdatedAt ? `Updated ${formatTime(query.dataUpdatedAt)}` : undefined });

  return (
    <Screen>
      <QueryState
        query={query}
        what="the activity log"
        loading={<><SkelInstrumentPanel readouts={3} /><SkelPanel rows={5} /></>}
        empty={
          <EmptyState icon="history" title="No activity recorded yet">
            Sign-ins, new accounts, guest check-ins and thermostat changes show up here as they happen.
          </EmptyState>
        }
      >
        {(logs) => {
          const shown = filter === 'all' ? logs : logs.filter((e) => KIND_GROUP[e.kind] === filter);
          const head = shown.slice(0, FIRST_ROWS);
          const rest = shown.slice(FIRST_ROWS);
          return (
            <>
              <Answer logs={logs} waiting={waiting} pendingNames={pending.map((u) => u.displayName || u.username)} />
              {missing.map((m) => (
                <Notice
                  key={m.what}
                  tone="headsup"
                  title={`Couldn't load the ${m.what}.`}
                  action={<Button size="sm" icon="refresh" onClick={m.retry}>Try again</Button>}
                >
                  The log below is missing them until they load.
                </Notice>
              ))}
              <Panel
                title="Timeline"
                subtitle={`Newest first. Each person's latest sign-in, accounts, guest check-ins, and thermostat changes from the last ${THERMOSTAT_DAYS} days`}
              >
                <Chips label="Kind" value={filter} onChange={setFilter} options={FILTERS} className="mb-3" />
                {head.length ? (
                  <>
                    <Timeline items={toItems(head, waiting)} />
                    {rest.length > 0 && (
                      <Disclosure variant="row" summary={`Show ${plural(rest.length, 'older event')}`} openSummary="Hide older events">
                        <Timeline items={toItems(rest, waiting)} />
                      </Disclosure>
                    )}
                  </>
                ) : (
                  <EmptyState
                    compact
                    title="Nothing matches this filter"
                    action={<Button size="sm" onClick={() => setFilter('all')}>Show everything</Button>}
                  >
                    {plural(logs.length, 'event')} in the log; none of them is this kind.
                  </EmptyState>
                )}
              </Panel>
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
