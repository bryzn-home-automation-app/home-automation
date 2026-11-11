import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTabUsage } from '../../api/activity';
import {
  Avatar,
  DataTable,
  Disclosure,
  EmptyState,
  Grid,
  Icon,
  InstrumentPanel,
  Meter,
  MeterRow,
  Panel,
  Progress,
  QueryState,
  Readout,
  Readouts,
  Screen,
  Seg,
  SkelInstrumentPanel,
  SkelPanel,
  Tag,
  Verdict,
} from '../../components/ui';
import { usePageMeta } from '../../components/shell/PageMeta';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { HEARTBEAT_MS } from '../../hooks/useAppPresence';
import { routeById } from '../../routes';
import { formatDuration, formatList, formatNumber, formatPercent, formatRelative, formatTime, plural } from '../../utils/format';
import { roleLabel } from '../../utils/status';
import { tabLabel } from '../../utils/tabs';
import type { MemberTabUsage, TabTotal, TabUsage as TabUsageData } from '../../types';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;
type Range = (typeof RANGES)[number]['value'];

/** The meter and each member's list stop here; the table has every tab. */
const TOP = 6;
/** Rows the "Every tab" table shows before "Show N more". */
const TABLE_ROWS = 8;

const tabIcon = (tab: string) => routeById(tab)?.icon;
const isAdminTab = (tab: string) => routeById(tab)?.access === 'admin';
const memberName = (m: MemberTabUsage) => m.displayName || m.username;
/** formatRelative mid-sentence: "just now", "yesterday", but a date keeps its capital ("Mon, Nov 2"). */
const inSentence = (rel: string) => (rel === 'Just now' || rel === 'Yesterday' ? rel.toLowerCase() : rel);

/** A tab's name with its menu icon, and an Admin tag on the pages members can't open. */
function TabName({ tab }: { tab: string }) {
  const icon = tabIcon(tab);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {icon && <Icon name={icon} className="shrink-0 text-apptext-muted" />}
      <span className="truncate">{tabLabel(tab)}</span>
      {isAdminTab(tab) && <Tag>Admin</Tag>}
    </span>
  );
}

/**
 * The instrument: the household's busiest tabs as LED meters, scaled to the busiest one. The
 * minutes are written beside each bar, so no figure depends on reading the bar.
 */
function RankedMeter({ tabs }: { tabs: TabTotal[] }) {
  const shown = tabs.slice(0, TOP);
  const max = Math.max(1, ...shown.map((t) => t.activeMinutes));
  return (
    <div className="flex w-full max-w-[440px] flex-col gap-3.5">
      <p className="fp-label">Active time · everyone</p>
      {shown.map((t) => (
        <MeterRow key={t.tab} label={<TabName tab={t.tab} />} value={formatDuration(t.activeMinutes)}>
          <Meter
            value={t.activeMinutes / max}
            segments={24}
            label={`${tabLabel(t.tab)} active time`}
            valueText={formatDuration(t.activeMinutes)}
          />
        </MeterRow>
      ))}
    </div>
  );
}

function summarise(data: TabUsageData) {
  const tabs = data.household;
  const total = tabs.reduce((s, t) => s + t.activeMinutes, 0);
  const visits = tabs.reduce((s, t) => s + t.visits, 0);
  const byTime = tabs[0];
  const byVisits = [...tabs].sort((a, b) => b.visits - a.visits)[0];
  const least = [...tabs].sort((a, b) => a.activeMinutes - b.activeMinutes || a.visits - b.visits)[0];
  const busiest = [...data.members].sort((a, b) => b.activeMinutes - a.activeMinutes)[0];
  const share = (min: number) => (total > 0 ? Math.round((min / total) * 100) : 0);
  return { total, visits, byTime, byVisits, least, busiest, share };
}

function Answer({ data }: { data: TabUsageData }) {
  const { total, visits, byTime, byVisits, least, busiest, share } = summarise(data);
  const same = byTime.tab === byVisits.tab;
  const quiet = data.household.filter((t) => t.activeMinutes <= 5).map((t) => tabLabel(t.tab)).slice(0, 2);
  return (
    <InstrumentPanel
      instrument={<RankedMeter tabs={data.household} />}
      verdict={
        <Verdict
          tone="info"
          note={
            <>
              The household spent {formatDuration(total)} in the app in {data.days} days
              {busiest && total > 0 ? `, and ${memberName(busiest)} accounts for ${formatPercent(share(busiest.activeMinutes))} of it` : ''}.
              {quiet.length > 0 && ` ${formatList(quiet)} ${quiet.length === 1 ? 'is' : 'are'} barely opened.`}
            </>
          }
        >
          {same
            ? `${tabLabel(byTime.tab)} gets the most time and the most visits.`
            : `${tabLabel(byTime.tab)} gets the most time; ${tabLabel(byVisits.tab)} the most visits.`}
        </Verdict>
      }
      readouts={
        <Readouts count={busiest ? 4 : 3}>
          <Readout label="Active time" value={formatDuration(total)} note={`Everyone, ${plural(visits, 'visit')}`} />
          <Readout label="Top tab" value={formatDuration(byTime.activeMinutes)} note={`${tabLabel(byTime.tab)}, ${plural(byTime.visits, 'visit')}`} />
          {busiest && (
            <Readout
              label="Most active"
              value={formatDuration(busiest.activeMinutes)}
              note={`${memberName(busiest)}, ${formatPercent(share(busiest.activeMinutes))} of the time`}
            />
          )}
          <Readout label="Least used" value={formatDuration(least.activeMinutes)} note={`${tabLabel(least.tab)}, ${plural(least.visits, 'visit')}`} />
        </Readouts>
      }
      foot={
        <>
          <span className="fp-mono">A visit is opening a tab; time counts only while in use</span>
          <span className="fp-mono">Guests aren't tracked</span>
        </>
      }
    />
  );
}

function MemberPanel({ m }: { m: MemberTabUsage }) {
  const shown = m.tabs.slice(0, TOP);
  const max = Math.max(1, ...shown.map((t) => t.activeMinutes));
  const name = memberName(m);
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2.5">
          <Avatar name={name} size="sm" decorative />
          {name}
          <Tag>{roleLabel(m.role)}</Tag>
        </span>
      }
      subtitle={m.lastActiveAt ? `Last active ${inSentence(formatRelative(m.lastActiveAt))}` : 'Not active in this range'}
    >
      <p className="fp-small fp-muted">
        {formatDuration(m.activeMinutes)} active · {plural(m.visits, 'visit')}
      </p>
      {shown.length ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="fp-label">Top tabs · time and visits</p>
          {shown.map((t) => (
            <MeterRow key={t.tab} label={<TabName tab={t.tab} />} value={`${formatDuration(t.activeMinutes)} · ${formatNumber(t.visits)}`}>
              <Progress thin value={(t.activeMinutes / max) * 100} label={`${name}: ${tabLabel(t.tab)}`} valueText={formatDuration(t.activeMinutes)} />
            </MeterRow>
          ))}
        </div>
      ) : (
        <EmptyState compact title="No tabs opened in this range" />
      )}
    </Panel>
  );
}

function EveryTab({ tabs }: { tabs: TabTotal[] }) {
  const total = tabs.reduce((s, t) => s + t.activeMinutes, 0);
  const columns = [
    { key: 'tab', header: 'Tab', kind: 'title' as const, cell: (t: TabTotal) => <TabName tab={t.tab} /> },
    { key: 'time', header: 'Active time', num: true, strong: true, kind: 'key' as const, cell: (t: TabTotal) => formatDuration(t.activeMinutes) },
    { key: 'visits', header: 'Visits', num: true, cell: (t: TabTotal) => formatNumber(t.visits) },
    {
      key: 'per',
      header: 'Per visit',
      num: true,
      cell: (t: TabTotal) => (t.visits ? formatNumber(t.activeMinutes / t.visits, { decimals: 1, fixed: true, unit: 'min' }) : '—'),
    },
    { key: 'share', header: 'Share', num: true, cell: (t: TabTotal) => (total ? formatPercent((t.activeMinutes / total) * 100) : '—') },
  ];
  const head = tabs.slice(0, TABLE_ROWS);
  const rest = tabs.slice(TABLE_ROWS);
  return (
    <Panel title="Every tab" subtitle="Busiest first. Admin pages are only open to admins">
      <DataTable rows={head} rowKey={(t) => t.tab} columns={columns} caption="Every tab, busiest first" />
      {rest.length > 0 && (
        <Disclosure variant="row" summary={`Show ${plural(rest.length, 'more tab')}`} openSummary="Show fewer">
          <DataTable rows={rest} rowKey={(t) => t.tab} columns={columns} caption="The rest of the tabs" />
        </Disclosure>
      )}
    </Panel>
  );
}

export default function TabUsage() {
  const [days, setDays] = useState<Range>('30');
  // Activity lands once a minute (the heartbeat), so refresh on the same beat while
  // the page is in view.
  const refreshInterval = useJitteredInterval(HEARTBEAT_MS);
  const query = useQuery({
    queryKey: ['admin-tab-usage', Number(days)],
    queryFn: () => fetchTabUsage(Number(days)),
    staleTime: 30_000,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  usePageMeta({ subtitle: query.dataUpdatedAt ? `Updated ${formatTime(query.dataUpdatedAt)}` : undefined });

  return (
    <Screen>
      <Seg kind="radio" fit="inline" label="Date range" value={days} onChange={setDays} options={RANGES} />
      <QueryState
        query={query}
        what="app usage"
        loading={<><SkelInstrumentPanel readouts={4} /><SkelPanel rows={4} /></>}
        isEmpty={(d) => d.household.length === 0 && d.members.length === 0}
        empty={
          <EmptyState icon="bar-chart" title={`No member activity in the last ${days} days yet`}>
            Each time a member opens a tab it counts here, with the minutes the app was open on it.
          </EmptyState>
        }
      >
        {(data) => (
          <>
            {data.household.length > 0 && <Answer data={data} />}
            {data.members.length === 0 ? (
              <EmptyState compact title={`No member activity in the last ${data.days} days yet`} />
            ) : (
              <Grid cols={3}>
                {data.members.map((m) => <MemberPanel key={m.userId} m={m} />)}
              </Grid>
            )}
            {data.household.length > 0 && <EveryTab tabs={data.household} />}
          </>
        )}
      </QueryState>
    </Screen>
  );
}
