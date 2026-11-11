import { memo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  completeReminder,
  createReminder,
  deleteReminder,
  fetchHeadsUpOptions,
  fetchReminders,
  HEADS_UP_OPTIONS_KEY,
  REMINDERS_KEY,
  setReminderAlerts,
  undoReminder,
  updateReminder,
  type Reminder,
  type ReminderInput,
  type ReminderOccurrence,
} from '../api/reminders';
import { errorMessage } from '../api/climate';
import ReminderDialog from '../components/ReminderDialog';
import { usePageMeta } from '../components/shell/PageMeta';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import {
  Badge,
  Button,
  ButtonRow,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
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
  Stack,
  Switch,
  Verdict,
} from '../components/ui';
import { formatDate, formatDateTime, formatDayName, formatList, formatTime, formatWeekday } from '../utils/format';
import type { Tone } from '../utils/status';
import { clockText, dueLine, ruleWords, TRASH_STARTER } from '../utils/reminders';

/** The occurrence a reminder is heading for: the current one unless it's done, then the next. */
function openOccurrence(r: Reminder): ReminderOccurrence | null {
  if (r.occurrence && !r.occurrence.completed) return r.occurrence;
  return r.nextOccurrence;
}

/** "today", "tomorrow", "on Fri, Nov 13". */
function dayWords(date: string): string {
  const name = formatDayName(date);
  return name === 'Today' || name === 'Tomorrow' ? name.toLowerCase() : `on ${formatDate(date)}`;
}

/** The verdict: what's due now, else what's next. */
function verdictFor(list: readonly Reminder[]): { tone: Tone; text: string; note: string } {
  const due = list.filter((r) => r.occurrence?.visible);
  if (due.length === 1) {
    const r = due[0];
    const occ = r.occurrence as ReminderOccurrence;
    return {
      tone: 'headsup',
      text: `${r.name} is due ${dayWords(occ.date)}.`,
      note: `It's on Home until it's done${r.dueBy ? ` or ${clockText(r.dueBy)} passes` : ''}. Mark it done there or below.`,
    };
  }
  if (due.length > 1) {
    return {
      tone: 'headsup',
      text: `${due.length} reminders are due.`,
      note: `${formatList(due.map((r) => r.name))}. They're on Home until done.`,
    };
  }
  if (!list.length) {
    return {
      tone: 'info',
      text: 'No reminders yet.',
      note: 'Add the chores that come round on a schedule. Each shows on Home ahead of time and can alert everyone’s phone.',
    };
  }
  const next = soonest(list);
  if (!next) return { tone: 'ok', text: 'Nothing due right now.', note: 'None of the reminders has another date.' };
  return {
    tone: 'ok',
    text: 'Nothing due right now.',
    note: `Next: ${next.reminder.name}, ${formatDate(next.occ.date)}. It shows on Home from ${formatDateTime(next.occ.showFrom)}.`,
  };
}

function soonest(list: readonly Reminder[]): { reminder: Reminder; occ: ReminderOccurrence } | null {
  let best: { reminder: Reminder; occ: ReminderOccurrence } | null = null;
  for (const r of list) {
    const occ = openOccurrence(r);
    if (occ && (!best || occ.dueAt < best.occ.dueAt)) best = { reminder: r, occ };
  }
  return best;
}

/** The instrument: the next due date as a tear-off calendar plate. */
function NextPlate({ list }: { list: readonly Reminder[] }) {
  const next = soonest(list);
  return (
    <figure className="m-0 flex w-full max-w-[330px] flex-col items-center gap-3 rounded-well border border-appborder-strong bg-appsurface px-6 pb-4 pt-5">
      <p className="fp-label">{next ? 'Next due' : 'Reminders'}</p>
      {next ? (
        <>
          <p className="fp-mono text-sm uppercase tracking-wide text-apptext-muted">{formatWeekday(next.occ.date)}</p>
          <Num size="xl" value={String(Number(next.occ.date.slice(8, 10)))} />
          <dl className="grid w-full grid-cols-2 border-t border-appborder">
            <div className="flex min-w-0 flex-col items-center gap-1 px-1 pt-3">
              <dt className="fp-label">What</dt>
              <dd className="w-full truncate text-center font-semibold text-apptext">{next.reminder.name}</dd>
            </div>
            <div className="flex flex-col items-center gap-1 border-l border-appborder px-1 pt-3">
              <dt className="fp-label">When</dt>
              <dd className="fp-mono whitespace-nowrap text-apptext">{formatDayName(next.occ.date)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <Icon name="calendar" className="h-16 w-16 text-apptext-muted" />
      )}
    </figure>
  );
}

export default memo(function Reminders() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: REMINDERS_KEY,
    queryFn: fetchReminders,
    refetchInterval: useJitteredInterval(120_000),
    staleTime: 30_000,
  });
  const options = useQuery({ queryKey: HEADS_UP_OPTIONS_KEY, queryFn: fetchHeadsUpOptions, staleTime: Infinity });
  usePageMeta({ subtitle: query.dataUpdatedAt ? `Updated ${formatTime(query.dataUpdatedAt)}` : undefined });

  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Reminder | null>(null);
  // ['reminders'] covers Home's due list too.
  const refresh = () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });

  const save = useMutation({
    mutationFn: (p: { id?: number; input: ReminderInput }) => (p.id ? updateReminder(p.id, p.input) : createReminder(p.input)),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
  });
  const starter = useMutation({ mutationFn: () => createReminder(TRASH_STARTER), onSettled: refresh });
  const remove = useMutation({
    mutationFn: (id: number) => deleteReminder(id),
    onSuccess: () => {
      setDeleting(null);
      void refresh();
    },
  });
  const alerts = useMutation({
    mutationFn: (p: { id: number; on: boolean }) => setReminderAlerts(p.id, p.on),
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: REMINDERS_KEY, exact: true });
      const before = queryClient.getQueryData<Reminder[]>(REMINDERS_KEY);
      queryClient.setQueryData<Reminder[]>(REMINDERS_KEY, (list) => list?.map((r) => (r.id === p.id ? { ...r, alerts: p.on } : r)));
      return { before };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.before) queryClient.setQueryData(REMINDERS_KEY, ctx.before);
    },
    onSettled: refresh,
  });
  const done = useMutation({
    mutationFn: (p: { id: number; date: string; undo?: boolean }) => (p.undo ? undoReminder(p.id, p.date) : completeReminder(p.id, p.date)),
    onSettled: refresh,
  });

  const openEdit = (r: Reminder | 'new') => {
    save.reset();
    setEditing(r);
  };
  const actionError = alerts.error ?? done.error ?? starter.error;

  return (
    <Screen>
      <QueryState
        query={query}
        what="the reminders"
        loadingLabel="Loading reminders"
        loading={
          <Stack gap="page">
            <SkelInstrumentPanel readouts={3} />
            <SkelPanel rows={3} />
          </Stack>
        }
        isEmpty={() => false}
      >
        {(list) => {
          const v = verdictFor(list);
          const dueNow = list.filter((r) => r.occurrence?.visible).length;
          const alerting = list.filter((r) => r.alerts && r.headsUps.length > 0).length;
          return (
            <>
              <InstrumentPanel
                instrument={<NextPlate list={list} />}
                verdict={
                  <Verdict tone={v.tone} note={v.note}>
                    {v.text}
                  </Verdict>
                }
                readouts={
                  <Readouts count={3}>
                    <Readout label="Reminders" value={list.length} note="Shared by everyone at home" />
                    <Readout label="Due now" value={dueNow} tone={dueNow ? 'headsup' : undefined} note={dueNow ? 'On Home until done' : 'Nothing on Home'} />
                    <Readout label="Alerting" value={alerting} note="Send phone alerts" />
                  </Readouts>
                }
              />

              <Panel
                title="Household reminders"
                subtitle="Anyone at home can add, change or tick these off. Times are Central."
                action={
                  list.length > 0 ? (
                    <Button size="sm" variant="primary" icon="plus" onClick={() => openEdit('new')}>
                      Add a reminder
                    </Button>
                  ) : undefined
                }
              >
                {list.length === 0 ? (
                  <EmptyState
                    icon="calendar"
                    title="No reminders yet"
                    action={
                      <ButtonRow>
                        <Button variant="primary" icon="plus" busy={starter.isPending} busyLabel="Adding…" onClick={() => starter.mutate()}>
                          Add trash day
                        </Button>
                        <Button onClick={() => openEdit('new')}>Add your own</Button>
                      </ButtonRow>
                    }
                  >
                    For chores that come round on a schedule. Trash goes out on Friday? Add “Trash day” and it shows on Home
                    from Thursday afternoon with a phone alert then and in the evening, until someone marks it done. Next week
                    it comes back on its own.
                  </EmptyState>
                ) : (
                  <ul className="fp-list" aria-label="Reminders">
                    {list.map((r) => (
                      <ReminderRow
                        key={r.id}
                        reminder={r}
                        onEdit={() => openEdit(r)}
                        onAlerts={(on) => alerts.mutate({ id: r.id, on })}
                        onDone={(date, undo) => done.mutate({ id: r.id, date, undo })}
                        busy={done.isPending && done.variables?.id === r.id}
                      />
                    ))}
                  </ul>
                )}
                {actionError != null && (
                  <Notice tone="problem" live="assertive" className="mt-3">
                    {errorMessage(actionError, "Couldn't save that. Try again.")}
                  </Notice>
                )}
              </Panel>
            </>
          );
        }}
      </QueryState>

      {editing != null && (
        <ReminderDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          reminder={editing === 'new' ? null : editing}
          options={options.data}
          saving={save.isPending}
          error={save.isError ? errorMessage(save.error, "Couldn't save the reminder. Try again.") : null}
          onSave={(input) => save.mutate({ id: editing === 'new' ? undefined : editing.id, input })}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  setDeleting(editing);
                  setEditing(null);
                }
          }
          onClose={() => setEditing(null)}
        />
      )}
      {deleting != null && (
        <ConfirmDialog
          open
          tone="danger"
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete reminder"
          busy={remove.isPending}
          busyLabel="Deleting…"
          onConfirm={() => remove.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        >
          It goes for everyone at home, with its history. It can't be undone.
          {remove.isError && <span className="mt-2 block">{errorMessage(remove.error, "Couldn't delete it. Try again.")}</span>}
        </ConfirmDialog>
      )}
    </Screen>
  );
});

function ReminderRow({
  reminder: r,
  onEdit,
  onAlerts,
  onDone,
  busy,
}: {
  reminder: Reminder;
  onEdit: () => void;
  onAlerts: (on: boolean) => void;
  onDone: (date: string, undo?: boolean) => void;
  busy: boolean;
}) {
  const occ = r.occurrence;
  let status: ReactNode;
  if (!occ) {
    status = <span className="fp-muted">Finished: its date has passed.</span>;
  } else if (occ.completed) {
    status = (
      <span className="fp-muted">
        Done for {formatDate(occ.date)}
        {occ.completedBy ? ` by ${occ.completedBy}` : ''}
        {r.nextOccurrence ? ` · next ${formatDate(r.nextOccurrence.date)}` : ''}
      </span>
    );
  } else if (occ.visible) {
    status = <span className="font-medium text-apptext">Due: {dueLine(occ.date, r.dueBy)}</span>;
  } else {
    status = <span className="fp-muted">Next: {dueLine(occ.date, r.dueBy)}</span>;
  }

  return (
    // Custom rows in the panel's edge-to-edge list take the panel's inset themselves.
    <li className="px-[var(--apppanel-pad)] py-3">
      <div className="flex items-start gap-3">
        <Icon name="calendar" className="fp-icon--m mt-0.5 shrink-0 text-apptext-muted" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-apptext">
            {r.name}
            {occ?.visible && <Badge tone="headsup">Due now</Badge>}
          </p>
          <p className="fp-small fp-muted">{ruleWords(r)}</p>
          <p className="fp-small mt-1">{status}</p>
          {r.note && <p className="fp-small fp-muted">“{r.note}”</p>}
          {occ && !occ.completed && occ.visible && (
            <Button size="sm" icon="check" className="mt-2" busy={busy} busyLabel="Saving…" onClick={() => onDone(occ.date)}>
              Mark done
            </Button>
          )}
          {occ?.completed && (
            <Button size="sm" variant="quiet" icon="refresh" className="mt-2" busy={busy} busyLabel="Saving…" onClick={() => onDone(occ.date, true)}>
              Undo done
            </Button>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <div className="flex w-14 flex-col items-center gap-1">
            <Switch bare checked={r.alerts} label={`Phone alerts for ${r.name}`} onChange={onAlerts} />
            <span className="fp-small fp-muted inline-flex items-center gap-1 text-xs" aria-hidden="true">
              <Icon name="phone" className="fp-icon--s" />
              Alerts
            </span>
          </div>
          <IconButton icon="edit" variant="quiet" label={`Edit ${r.name}`} onClick={onEdit} />
        </div>
      </div>
    </li>
  );
}

