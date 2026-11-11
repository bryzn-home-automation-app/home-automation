import { useDeferredValue, useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  markRead,
  type Notification,
} from '../api/notifications';
import { useAuth } from '../context/AuthContext';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { usePageMeta } from '../components/shell/PageMeta';
import {
  Button,
  Chips,
  Disclosure,
  EmptyState,
  Field,
  Icon,
  Input,
  InstrumentPanel,
  Lamp,
  LinkButton,
  List,
  Num,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Screen,
  SkelRows,
  Stack,
  StatusText,
  Switch,
  Verdict,
  type ChipOption,
} from '../components/ui';
import { formatDate, formatDayName, formatStamp, formatTime, homeDayKey, homeToday, plural, toInstant } from '../utils/format';
import { notificationCategory, severityStatus, worstTone, type Tone } from '../utils/status';

const LIMIT = 100;
/** Rows shown before "Show older alerts" (lists never scroll in their own box; B-006). */
const FIRST_ROWS = 20;

type CategoryKey = 'all' | 'ELECTRICAL' | 'WEATHER' | 'CAMERA' | 'ROOMBA' | 'WATER' | 'SYSTEM';
type SeverityKey = 'all' | 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';

/**
 * The category chips. Gas and Wi-Fi are left out: nothing sends alerts in those categories,
 * so their chips could only ever show an empty list (B-152). Water alerts are the admin-only
 * Gmail warning and System the home server's health, so both are for admins only.
 */
const CATEGORIES: { key: Exclude<CategoryKey, 'all'>; adminOnly?: boolean }[] = [
  { key: 'ELECTRICAL' },
  { key: 'WEATHER' },
  { key: 'CAMERA' },
  { key: 'ROOMBA' },
  { key: 'WATER', adminOnly: true },
  { key: 'SYSTEM', adminOnly: true },
];

const SEVERITIES: Exclude<SeverityKey, 'all'>[] = ['CRITICAL', 'WARNING', 'INFO', 'SUCCESS'];

/** Every filter the list can have; the unfiltered params are shared with the page's answer. */
function listParams(category: CategoryKey, severity: SeverityKey, unreadOnly: boolean) {
  return {
    category: category === 'all' ? undefined : category,
    severity: severity === 'all' ? undefined : severity,
    unread: unreadOnly,
    limit: LIMIT,
  };
}

/** Search titles and messages (client side, over what the server sent). */
export function searchAlerts(list: readonly Notification[], query: string): Notification[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((n) => n.title.toLowerCase().includes(q) || (n.message ?? '').toLowerCase().includes(q));
}

/** Alerts grouped by the home's calendar day, newest day first (the list arrives newest first). */
export function groupByDay(list: readonly Notification[]): { day: string; items: Notification[] }[] {
  const groups: { day: string; items: Notification[] }[] = [];
  for (const n of list) {
    const day = homeDayKey(n.createdAt) ?? '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(n);
    else groups.push({ day, items: [n] });
  }
  return groups;
}

/** Severity counts over the last 7 days (home days, today included). */
export function weekTally(list: readonly Notification[], now: Date = new Date()): Record<Exclude<SeverityKey, 'all'>, number> {
  const tally = { CRITICAL: 0, WARNING: 0, INFO: 0, SUCCESS: 0 };
  const cutoff = now.getTime() - 7 * 86_400_000;
  for (const n of list) {
    const at = toInstant(n.createdAt);
    if (at == null || at < cutoff) continue;
    if (n.severity in tally) tally[n.severity as keyof typeof tally]++;
  }
  return tally;
}

export default function NotificationsPage() {
  const { isGuest, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<CategoryKey>('all');
  const [severity, setSeverity] = useState<SeverityKey>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  // Defer the search filter so typing stays responsive.
  const deferredSearch = useDeferredValue(search);
  const notifInterval = useJitteredInterval(30_000);

  const params = useMemo(() => listParams(category, severity, unreadOnly), [category, severity, unreadOnly]);
  const notifications = useQuery({
    queryKey: ['notifications', params],
    queryFn: () => fetchNotifications(params),
    refetchInterval: notifInterval,
    refetchIntervalInBackground: false,
  });
  // The page's answer is about everything, whatever the list is filtered to. Unfiltered, this
  // is the same query (same key) as the list, so it costs nothing extra.
  const allParams = useMemo(() => listParams('all', 'all', false), []);
  const all = useQuery({
    queryKey: ['notifications', allParams],
    queryFn: () => fetchNotifications(allParams),
    refetchInterval: notifInterval,
    refetchIntervalInBackground: false,
  });
  // The real unread count, the shell's own query (B-026: counting the filtered page made the
  // number and the button disagree with the header, while Mark all read clears everything).
  const unreadCount = useQuery({ queryKey: ['notifications-unread-count'], queryFn: fetchUnreadCount, staleTime: 30_000 });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };
  const markAllMut = useMutation({ mutationFn: markAllRead, onSuccess: invalidate });
  const readMut = useMutation({ mutationFn: (id: number) => markRead(id), onSuccess: invalidate });

  usePageMeta({ subtitle: all.dataUpdatedAt ? `Updated ${formatTime(all.dataUpdatedAt)}` : undefined });

  const filtering = category !== 'all' || severity !== 'all' || unreadOnly || deferredSearch.trim() !== '';
  const clearFilters = () => {
    setCategory('all');
    setSeverity('all');
    setUnreadOnly(false);
    setSearch('');
  };

  const allList = all.data ?? [];
  const unread = unreadCount.data ?? allList.filter((n) => !n.isRead).length;
  const unreadList = allList.filter((n) => !n.isRead);
  const tally = weekTally(allList);
  const today = homeToday();
  const todays = allList.filter((n) => homeDayKey(n.createdAt) === today);
  const weekTotal = tally.CRITICAL + tally.WARNING + tally.INFO + tally.SUCCESS;

  const verdictTone: Tone = unread === 0 ? 'ok' : worstTone(unreadList.map((n) => severityStatus(n.severity).tone));
  const verdictText = unread === 0 ? "You're all caught up." : `${plural(unread, 'unread alert')}.`;
  const verdictNote =
    unread === 0
      ? allList[0]
        ? `Last alert: ${formatStamp(allList[0].createdAt)}.`
        : 'Alerts from the house land here as they happen.'
      : unreadList[0]
        ? `Newest: ${unreadList[0].title}.`
        : 'Open an alert to read all of it.';

  const categoryOptions: ChipOption<CategoryKey>[] = [
    { value: 'all', label: 'All' },
    ...CATEGORIES.filter((c) => !c.adminOnly || isAdmin).map((c) => {
      const cat = notificationCategory(c.key);
      return { value: c.key, label: cat.label, icon: cat.icon };
    }),
  ];
  const severityOptions: ChipOption<SeverityKey>[] = [
    { value: 'all', label: 'Any' },
    ...SEVERITIES.map((s) => ({ value: s, label: severityStatus(s).label })),
  ];

  return (
    <Screen>
      <InstrumentPanel
        instrument={<Annunciator unread={all.data || unreadCount.data != null ? unread : null} tally={all.data ? tally : null} />}
        verdict={
          all.isError && !all.data ? (
            <Verdict tone="headsup" note="The home server didn't answer. Try again in a moment.">Couldn't load your alerts.</Verdict>
          ) : !all.data ? (
            <Verdict tone="neutral">Loading your alerts…</Verdict>
          ) : (
            <Verdict tone={verdictTone} note={verdictNote}>{verdictText}</Verdict>
          )
        }
        readouts={
          <Readouts count={2}>
            <Readout
              label="Today"
              value={all.data ? todays.length : '—'}
              unit={todays.length === 1 ? 'alert' : 'alerts'}
              note={all.data ? (todays.length ? `${todays.filter((n) => !n.isRead).length} unread` : 'Nothing yet today') : undefined}
            />
            <Readout
              label="Past 7 days"
              value={all.data ? weekTotal : '—'}
              unit={weekTotal === 1 ? 'alert' : 'alerts'}
              note={all.data ? (tally.CRITICAL ? `${plural(tally.CRITICAL, 'problem')}` : 'No problems') : undefined}
            />
          </Readouts>
        }
      >
        <div className="fp-btn-row">
          <Button
            variant="primary"
            icon="check"
            onClick={() => markAllMut.mutate()}
            disabled={unread === 0}
            busy={markAllMut.isPending}
            busyLabel="Marking…"
          >
            {unread > 0 ? `Mark all ${unread} read` : 'Mark all read'}
          </Button>
          {!isGuest && (
            <LinkButton to="/profile?view=alerts#alert-types" variant="quiet" icon="settings">
              Alert settings
            </LinkButton>
          )}
        </div>
      </InstrumentPanel>

      <Panel title="Everything the house told you" subtitle="Newest first. Tap an alert to read all of it.">
        <Stack gap="m">
          <Chips label="Show alerts from" value={category} onChange={setCategory} options={categoryOptions} />
          <Disclosure
            summary={<span className="inline-flex items-center gap-2"><Icon name="sliders" />Search and more filters</span>}
            openSummary={<span className="inline-flex items-center gap-2"><Icon name="sliders" />Fewer filters</span>}
            defaultOpen={severity !== 'all' || unreadOnly || search !== ''}
          >
            <Stack gap="m" className="pt-3">
              <Field label="Search">
                <Input
                  type="search"
                  icon="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles and messages"
                  aria-label="Search alerts"
                />
              </Field>
              <Stack gap="s">
                <span className="fp-label">How much it mattered</span>
                <Chips label="How much it mattered" value={severity} onChange={setSeverity} options={severityOptions} />
              </Stack>
              <List inset>
                <li>
                  <Switch checked={unreadOnly} onChange={setUnreadOnly} label="Unread only" help="Hide the ones you've already read" />
                </li>
              </List>
            </Stack>
          </Disclosure>
        </Stack>

        <div className="mt-4">
          <QueryState
            query={notifications}
            what="your alerts"
            loading={<SkelRows count={5} />}
            isEmpty={(d) => searchAlerts(d, deferredSearch).length === 0}
            empty={
              filtering ? (
                <EmptyState
                  icon="filter"
                  title="Nothing matches these filters"
                  action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>}
                >
                  Clear the filters to see every alert.
                </EmptyState>
              ) : (
                <EmptyState icon="bell" title="No alerts yet">
                  Alerts from the house land here as they happen.
                </EmptyState>
              )
            }
          >
            {(data) => {
              const shown = searchAlerts(data, deferredSearch);
              const first = shown.slice(0, FIRST_ROWS);
              const rest = shown.slice(FIRST_ROWS);
              return (
                <>
                  <AlertDays list={first} onOpen={(n) => { if (!n.isRead) readMut.mutate(n.id); }} />
                  {rest.length > 0 && (
                    <Disclosure variant="row" summary={`Show ${plural(rest.length, 'older alert')}`} openSummary="Hide older alerts" className="mt-4">
                      <AlertDays list={rest} onOpen={(n) => { if (!n.isRead) readMut.mutate(n.id); }} />
                    </Disclosure>
                  )}
                </>
              );
            }}
          </QueryState>
        </div>
      </Panel>
    </Screen>
  );
}

/** The instrument: the unread counter, and a lamp per severity with the past week's count. */
function Annunciator({ unread, tally }: { unread: number | null; tally: Record<Exclude<SeverityKey, 'all'>, number> | null }) {
  return (
    <div className="grid w-full max-w-[380px] grid-cols-[minmax(112px,5fr)_minmax(0,7fr)] items-stretch gap-4">
      <div className="flex flex-col items-center justify-center gap-2 rounded-well bg-appinset px-2.5 py-4 shadow-[var(--appwell-shadow)]">
        <span className="fp-label">Unread</span>
        <Num size="xl" value={unread ?? '—'} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="fp-label">Past 7 days</p>
        <ul aria-label="Alerts in the past 7 days, by how much they mattered">
          {SEVERITIES.map((s) => {
            const st = severityStatus(s);
            const n = tally?.[s];
            return (
              <li key={s} className="grid min-h-[30px] grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-appborder">
                <Lamp tone={n ? st.tone : 'neutral'} />
                <span className={`fp-label ${n ? 'text-apptext' : 'text-apptext-muted'}`}>{st.label}</span>
                <span className={`fp-mono ${n ? 'text-apptext' : 'text-apptext-muted'}`}>{n ?? '—'}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Alerts under a heading per home day; each row opens to show its whole message. */
function AlertDays({ list, onOpen }: { list: readonly Notification[]; onOpen: (n: Notification) => void }) {
  return (
    <div className="flex flex-col gap-5">
      {groupByDay(list).map((g) => (
        <AlertDay key={g.day} day={g.day} items={g.items} onOpen={onOpen} />
      ))}
    </div>
  );
}

function AlertDay({ day, items, onOpen }: { day: string; items: Notification[]; onOpen: (n: Notification) => void }) {
  const id = useId();
  const name = formatDayName(day);
  const date = formatDate(day);
  return (
    <section aria-labelledby={id}>
      <h3 className="fp-tl-day" id={id}>
        <span className="fp-label">{name}</span>
        {name !== date && <span className="fp-mono">{date}</span>}
      </h3>
      <ul className="fp-list">
        {items.map((n) => (
          <AlertRow key={n.id} n={n} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One alert: its severity lamp, title, "Heads-up · Electric" and the time. Tapping it opens
 * the whole message under it (B-025: the message used to be cut at two lines with no way to
 * read the rest) and marks it read.
 */
function AlertRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const [open, setOpen] = useState(false);
  const msgId = useId();
  const sev = severityStatus(n.severity);
  const cat = notificationCategory(n.category);
  return (
    <li>
      <button
        type="button"
        className={`fp-row fp-row--compact ${n.isRead ? '' : 'fp-is-unread'}`}
        aria-expanded={open}
        aria-controls={msgId}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) onOpen(n);
        }}
      >
        <span className="fp-row-lead fp-row-lead--lamp">
          <Lamp tone={sev.tone} />
        </span>
        <span className="fp-row-main">
          <span className="fp-row-title fp-row-title--regular">
            {n.title}
            {!n.isRead && <span className="fp-sr-only"> Unread.</span>}
          </span>
          <span className="fp-row-meta">
            <StatusText status={sev} /> · {cat.label}
          </span>
        </span>
        <span className="fp-row-trail">
          <span className="fp-mono">{formatTime(n.createdAt)}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} className="fp-chev" />
        </span>
      </button>
      <div id={msgId} hidden={!open} className="pb-3.5 pl-8 pr-1">
        <p className="fp-prose whitespace-pre-line text-apptext">{n.message || 'No more to it than the title.'}</p>
        <p className="fp-small fp-muted mt-1.5">
          <span className="fp-mono">{formatDate(n.createdAt)}, {formatTime(n.createdAt)}</span> · {cat.label}
        </p>
      </div>
    </li>
  );
}

