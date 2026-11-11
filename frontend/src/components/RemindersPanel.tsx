import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import {
  completeReminder,
  DUE_REMINDERS_KEY,
  fetchDueReminders,
  REMINDERS_KEY,
  undoReminder,
  type DueReminder,
} from '../api/reminders';
import { errorMessage } from '../api/climate';
import { dueLine, sortDue } from '../utils/reminders';
import { Button, cx, Icon, LinkButton, Notice, Panel } from './ui';

/** How long Undo stays after Done. */
export const UNDO_MS = 6_000;

/**
 * Home's "Reminders" panel: the household reminders showing right now (from their first
 * heads-up until done or their done-by time), each with a Done button and, for a few seconds
 * after, Undo. Renders nothing at all when none is showing, and nothing for guests. Fetches
 * /api/reminders/due itself, every minute and when the window regains focus.
 *
 * Mount it as one line on Home: `<RemindersPanel />`.
 */
export default function RemindersPanel({ className }: { className?: string }) {
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: DUE_REMINDERS_KEY,
    queryFn: fetchDueReminders,
    enabled: !isGuest,
    refetchInterval: useJitteredInterval(60_000),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  /** The last one marked done, while Undo is offered. */
  const [recent, setRecent] = useState<DueReminder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The Done request in flight, so Undo waits for it rather than racing it. */
  const pending = useRef<Promise<unknown> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The Reminders page's list only (exact): this panel's own list is already up to date.
  const refreshLists = () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY, exact: true });

  const done = useMutation({
    mutationFn: (r: DueReminder) => {
      const p = completeReminder(r.id, r.date);
      pending.current = p;
      return p;
    },
    // Gone at once; back (with the error) if the server says no.
    onMutate: async (r) => {
      await queryClient.cancelQueries({ queryKey: DUE_REMINDERS_KEY });
      queryClient.setQueryData<DueReminder[]>(DUE_REMINDERS_KEY, (list) => list?.filter((x) => x.id !== r.id));
      if (timer.current) clearTimeout(timer.current);
      setRecent(r);
      timer.current = setTimeout(() => setRecent(null), UNDO_MS);
    },
    onError: (_e, r) => {
      if (timer.current) clearTimeout(timer.current);
      setRecent(null);
      queryClient.setQueryData<DueReminder[]>(DUE_REMINDERS_KEY, (list) => (list ? sortDue([...list.filter((x) => x.id !== r.id), r]) : [r]));
    },
    onSettled: refreshLists,
  });

  const undo = useMutation({
    mutationFn: async (r: DueReminder) => {
      await pending.current?.catch(() => undefined);
      return undoReminder(r.id, r.date);
    },
    onMutate: async (r) => {
      if (timer.current) clearTimeout(timer.current);
      setRecent(null);
      await queryClient.cancelQueries({ queryKey: DUE_REMINDERS_KEY });
      queryClient.setQueryData<DueReminder[]>(DUE_REMINDERS_KEY, (list) => sortDue([...(list ?? []).filter((x) => x.id !== r.id), r]));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: DUE_REMINDERS_KEY });
      void refreshLists();
    },
  });

  if (isGuest) return null;
  const items = query.data ?? [];
  const error = done.isError ? done.error : undo.isError ? undo.error : null;
  if (!items.length && !recent && !error) return null;

  return (
    <Panel
      title="Reminders"
      className={className}
      action={
        <LinkButton to="/reminders" size="sm" variant="quiet" iconEnd="arrow-right">
          All reminders
        </LinkButton>
      }
    >
      {items.length > 0 && (
        <ul className="fp-list" aria-label="Due reminders">
          {items.map((r) => (
            <DueRow key={r.id} reminder={r} onDone={() => done.mutate(r)} />
          ))}
        </ul>
      )}
      {recent && (
        <Notice
          tone="ok"
          live="polite"
          className={cx(items.length > 0 && 'mt-3')}
          action={
            <Button size="sm" icon="refresh" onClick={() => undo.mutate(recent)}>
              Undo
            </Button>
          }
        >
          {recent.name}: done for everyone.
        </Notice>
      )}
      {!recent && error != null && (
        <Notice tone="problem" live="assertive" className={cx(items.length > 0 && 'mt-3')}>
          {errorMessage(error, "Couldn't save that. Try again.")}
        </Notice>
      )}
    </Panel>
  );
}

function DueRow({ reminder: r, onDone }: { reminder: DueReminder; onDone: () => void }) {
  const line = dueLine(r.date, r.dueBy);
  const today = line.startsWith('Today');
  return (
    <li className="flex items-center gap-3 px-[var(--apppanel-pad)] py-3">
      <Icon name={today ? 'alert-circle' : 'calendar'} className={cx('fp-icon--m shrink-0', today ? 'text-apptext' : 'text-apptext-muted')} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-apptext">{r.name}</p>
        <p className={cx('fp-small', today ? 'font-medium text-apptext' : 'fp-muted')}>{line}</p>
        {r.note && <p className="fp-small fp-muted">{r.note}</p>}
      </div>
      <Button size="sm" icon="check" onClick={onDone} aria-label={`Done: ${r.name}`} className="shrink-0">
        Done
      </Button>
    </li>
  );
}
