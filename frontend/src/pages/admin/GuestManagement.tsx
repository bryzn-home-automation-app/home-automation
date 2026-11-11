import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { expireGuestSessions, fetchGuestSessions, type GuestSession } from '../../api/auth';
import { errorMessage } from '../../api/climate';
import {
  Avatar,
  Badge,
  Button,
  Chips,
  Dial,
  DialCentre,
  Disclosure,
  EmptyState,
  InstrumentPanel,
  KeyValue,
  KV,
  List,
  Notice,
  Num,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Ring,
  Row,
  Screen,
  SkelInstrumentPanel,
  SkelPanel,
  Tag,
  Verdict,
  useConfirm,
} from '../../components/ui';
import { usePageMeta } from '../../components/shell/PageMeta';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { formatDate, formatDateTime, formatList, formatRelative, formatShortDate, formatTime, plural, toInstant } from '../../utils/format';
import { guestSessionStatus } from '../../utils/status';
import { deviceLabel } from './guestDevice';

/** Access lasts this long after a guest's last visit (UserService.GUEST_EXPIRY_DAYS). */
const ACCESS_DAYS = 30;
const DAY_MS = 86_400_000;

/** Whole days of access left (0 on the last day, never negative). */
function daysLeft(s: GuestSession, now = Date.now()): number {
  const end = toInstant(s.expiresAt);
  return end == null ? 0 : Math.max(0, Math.ceil((end - now) / DAY_MS));
}

type ListView = 'active' | 'ended';

/** formatRelative mid-sentence: "just now", "yesterday", but a date keeps its capital. */
const inSentence = (rel: string) => (rel === 'Just now' || rel === 'Yesterday' ? rel.toLowerCase() : rel);

/** The result of the last "Clear inactive guests", said under the button. */
type ClearResult = { kind: 'done'; cleared: string[] } | { kind: 'failed'; message: string };

function Answer({ active }: { active: GuestSession[] }) {
  // The guest whose access ends first is the one the dial is about.
  const soonest = [...active].sort((a, b) => (toInstant(a.expiresAt) ?? 0) - (toInstant(b.expiresAt) ?? 0))[0];
  const left = soonest ? daysLeft(soonest) : 0;
  // One name per guest, even when they hold two sessions (two phones).
  const names = [...new Set(active.map((s) => s.guestName))];
  const visits = active.reduce((n, s) => n + (s.connectionCount ?? 0), 0);
  return (
    <InstrumentPanel
      instrument={
        <Dial
          label={soonest ? `${soonest.guestName} has ${plural(left, 'day')} of access left.` : 'No guest has access.'}
          rings={[{
            r: 88, w: 10, min: 0, max: ACCESS_DAYS, ticks: 6, major: 3,
            labels: [[0, '0'], [ACCESS_DAYS, `${ACCESS_DAYS} d`]],
            segments: soonest ? [{ from: 0, to: left, tone: 'ink' }] : [],
            needle: soonest ? { at: left } : undefined,
          }]}
        >
          {soonest ? (
            <DialCentre label={soonest.guestName} note={`left, until ${formatShortDate(soonest.expiresAt)}`}>
              <Num size="xl" value={left} unit={left === 1 ? 'day' : 'days'} />
            </DialCentre>
          ) : (
            <DialCentre label="Guests" note="with access">
              <Num size="xl" value={0} />
            </DialCentre>
          )}
        </Dial>
      }
      verdict={
        active.length ? (
          <Verdict tone="ok" note={`Access ends ${ACCESS_DAYS} days after a guest's last visit, so each visit keeps it open longer.`}>
            {names.length === 1 ? `${names[0]} is the only guest with access.` : `${formatList(names)} have guest access.`}
          </Verdict>
        ) : (
          <Verdict tone="neutral" note="Guests show up here once they sign in on the guest page.">
            No guests have access right now.
          </Verdict>
        )
      }
      readouts={
        <Readouts count={3}>
          <Readout label="With access" value={names.length} unit={names.length === 1 ? 'guest' : 'guests'} note={names.length ? formatList(names) : 'Nobody'} />
          <Readout
            label="Access ends"
            value={soonest ? formatShortDate(soonest.expiresAt) : '—'}
            note={soonest ? `${soonest.guestName}, unless they visit again` : 'No guest has access'}
          />
          <Readout label="Visits" value={visits} note="By the guests with access" />
        </Readouts>
      }
      foot={<span className="fp-mono">Refreshes every 30 s</span>}
    />
  );
}

function GuestRow({ s }: { s: GuestSession }) {
  const status = guestSessionStatus(s.status);
  const active = s.status === 'ACTIVE';
  const left = daysLeft(s);
  return (
    <Row
      lead={<Avatar name={s.guestName} size="sm" away={!active} decorative />}
      title={<>{s.guestName} <Tag>Guest</Tag></>}
      meta={
        <>
          {deviceLabel(s.userAgent)} · <span className="fp-mono">{s.ipAddress}</span> · seen {inSentence(formatRelative(s.lastSeenAt))}
        </>
      }
      trail={
        active ? (
          <span className="inline-flex items-center gap-2.5">
            <span className="fp-small fp-muted whitespace-nowrap max-sm:hidden">Until {formatDate(s.expiresAt)}</span>
            <Ring value={left / ACCESS_DAYS} size={44} width={22} label={`${plural(left, 'day')} left, until ${formatShortDate(s.expiresAt)}`}>
              <Num size="s" value={left} />
            </Ring>
          </span>
        ) : (
          <Badge status={status} className="whitespace-nowrap" />
        )
      }
    />
  );
}

/** Each guest's sign-in facts, for the curious: full times and the raw device string. */
function GuestDetails({ sessions }: { sessions: GuestSession[] }) {
  return (
    <Disclosure variant="row" summary="Show details" openSummary="Hide details">
      <div className="flex flex-col gap-5">
        {sessions.map((s) => (
          <KeyValue key={s.id}>
            <KV kind="group" label={s.guestName} value={guestSessionStatus(s.status).label} />
            <KV kind="sub" label="Joined" value={formatDateTime(s.connectedAt)} />
            <KV kind="sub" label="Last seen" value={formatDateTime(s.lastSeenAt)} />
            <KV kind="sub" label={s.status === 'ACTIVE' ? 'Access ends' : 'Access ended'} value={formatDateTime(s.expiresAt)} />
            <KV kind="sub" label="Visits" value={s.connectionCount ?? '—'} />
            <KV kind="sub" label="Address" value={s.ipAddress} mono />
            <KV kind="sub" label="Device" value={<span className="break-all">{s.userAgent || 'Unknown'}</span>} />
          </KeyValue>
        ))}
      </div>
    </Disclosure>
  );
}

export default function GuestManagement() {
  const queryClient = useQueryClient();
  const sessionsInterval = useJitteredInterval(30_000);
  const [view, setView] = useState<ListView>('active');
  const [result, setResult] = useState<ClearResult | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const sessions = useQuery({
    queryKey: ['admin-guest-sessions'],
    queryFn: fetchGuestSessions,
    refetchInterval: sessionsInterval,
    refetchIntervalInBackground: false,
  });
  usePageMeta({ subtitle: sessions.dataUpdatedAt ? `Updated ${formatTime(sessions.dataUpdatedAt)}` : undefined });

  /*
   * The server's "expire" only ends guests who haven't been seen for 30 days (B-037); a guest
   * here this week keeps their access. So the button says that, asks first, and then says
   * what actually happened, worked out from the list before and after.
   */
  const clear = useMutation({
    mutationFn: async () => {
      const before = (sessions.data ?? []).filter((s) => s.status === 'ACTIVE');
      await expireGuestSessions();
      const after = await queryClient.fetchQuery({ queryKey: ['admin-guest-sessions'], queryFn: fetchGuestSessions, staleTime: 0 });
      const stillActive = new Set(after.filter((s) => s.status === 'ACTIVE').map((s) => s.id));
      return before.filter((s) => !stillActive.has(s.id)).map((s) => s.guestName);
    },
    onSuccess: (cleared) => setResult({ kind: 'done', cleared }),
    onError: (e) => setResult({ kind: 'failed', message: errorMessage(e, "The home server didn't answer") }),
  });

  const askToClear = async () => {
    setResult(null);
    const ok = await confirm({
      title: 'Clear inactive guests?',
      message: `Ends access for every guest who hasn't been seen for ${ACCESS_DAYS} days. Guests who visited more recently keep theirs.`,
      confirmLabel: 'Clear inactive guests',
      tone: 'danger',
    });
    if (ok) clear.mutate();
  };

  return (
    <Screen>
      <QueryState
        query={sessions}
        what="the guests"
        loading={<><SkelInstrumentPanel readouts={3} /><SkelPanel rows={3} /></>}
        isEmpty={() => false}
      >
        {(data) => {
          const active = data.filter((s) => s.status === 'ACTIVE');
          const ended = data.filter((s) => s.status !== 'ACTIVE');
          const shown = view === 'active' ? active : ended;
          return (
            <>
              <Answer active={active} />
              <Panel
                title="Door list"
                subtitle={`Access ends ${ACCESS_DAYS} days after a guest's last visit`}
                action={
                  <Chips
                    label="Guests"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'active', label: 'Active', count: active.length },
                      { value: 'ended', label: 'Ended', count: ended.length },
                    ]}
                  />
                }
                footer={
                  <>
                    <span className="fp-small fp-muted">Ends access for guests not seen for {ACCESS_DAYS} days</span>
                    <Button size="sm" variant="danger-quiet" icon="lock" busy={clear.isPending} busyLabel="Clearing…" onClick={askToClear}>
                      Clear inactive guests
                    </Button>
                  </>
                }
              >
                {result && (
                  <Notice
                    live="polite"
                    tone={result.kind === 'failed' ? 'problem' : result.cleared.length ? 'ok' : 'neutral'}
                    title={
                      result.kind === 'failed'
                        ? "Couldn't clear inactive guests."
                        : result.cleared.length
                          ? `Ended access for ${formatList(result.cleared)}.`
                          : 'Nothing to clear.'
                    }
                    className="mb-3"
                  >
                    {result.kind === 'failed'
                      ? `${result.message}. Nobody's access changed.`
                      : result.cleared.length
                        ? null
                        : `Every guest with access has been seen in the last ${ACCESS_DAYS} days.`}
                  </Notice>
                )}
                {shown.length ? (
                  <List>{shown.map((s) => <GuestRow key={s.id} s={s} />)}</List>
                ) : view === 'active' ? (
                  <EmptyState compact icon="id-card" title="No guests have access right now">
                    Guests show up here once they sign in on the guest page. Access lasts {ACCESS_DAYS} days from their last visit.
                  </EmptyState>
                ) : (
                  <EmptyState compact title="No ended visits yet">Guests move here once their access ends.</EmptyState>
                )}
                {shown.length > 0 && <GuestDetails sessions={shown} />}
              </Panel>
            </>
          );
        }}
      </QueryState>
      {confirmDialog}
    </Screen>
  );
}
