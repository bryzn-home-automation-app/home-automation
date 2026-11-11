import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRoombaCommands } from '../../api/roomba';
import type { RoombaCommand } from '../../types';
import { Notice } from '../ui';

/*
 * The Roomba dialogs (clean, clean a room, rename, divide, merge) all queue a command on the
 * server and then watch it: the poller picks it up and sends it (SENT), and it ends OK or FAILED.
 * A clean started from the dock stays SENT until the poller reads the robot setting off, so OK
 * there means it started; a robot that never reacts comes back FAILED with the reason. This is
 * that watch, once, plus the notice that reports it.
 */

export const isTerminal = (s: string | null | undefined) => s === 'OK' || s === 'FAILED';

/** The status query the Roomba page reads (pages/Roomba.tsx); refreshed the moment a command lands. */
export const ROOMBA_STATUS_KEY = ['roomba-status'] as const;
/** Re-read the command row this often while it's queued or sent (the poller picks it up at once). */
export const COMMAND_WATCH_MS = 1000;
/**
 * The page's backstop: a command still without an outcome this long after it was queued gets
 * "No word from the robot yet", and the row is re-read only every COMMAND_LATE_MS after that.
 * The poller settles every row well inside it (a resent pause about 35 s, a watched start 30 s,
 * a check cut short by a cloud outage at its next retry), so reaching it means the poller itself
 * is stuck or down.
 */
export const COMMAND_CEILING_MS = 90_000;
/** After the ceiling: still re-read the row now and then, so a late outcome shows. */
export const COMMAND_LATE_MS = 15_000;

/**
 * True once COMMAND_CEILING_MS has passed since `startedAt` (a Date.now() when a command was
 * queued; null for none). "No word yet" is this while the command still has no outcome.
 */
export function useCeilingPassed(startedAt: number | null): boolean {
  const [passedFor, setPassedFor] = useState<number | null>(null);
  useEffect(() => {
    if (startedAt == null) return;
    const timer = window.setTimeout(() => setPassedFor(startedAt), Math.max(0, startedAt + COMMAND_CEILING_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [startedAt]);
  return startedAt != null && passedFor === startedAt;
}

export interface QueuedCommand {
  /** Queue the command (ignored while one is in flight). */
  send: () => void;
  /** null before sending; then PENDING / SENT / OK / FAILED. */
  status: string | null;
  /** The robot's reason when it refused. */
  detail: string | null;
  /** Queued or sending: the dialog's keys wait. */
  submitting: boolean;
  /** The robot accepted it. */
  done: boolean;
  /** The server didn't take the command at all. */
  sendFailed: boolean;
  /** Still no outcome COMMAND_CEILING_MS after it was queued: the keys are free again. */
  noWord: boolean;
}

export function useQueuedCommand(queue: () => Promise<RoombaCommand>): QueuedCommand {
  const qc = useQueryClient();
  const [commandId, setCommandId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: queue,
    onSuccess: (cmd) => {
      setCommandId(cmd.id);
      setStartedAt(Date.now());
    },
  });

  const ceilingPassed = useCeilingPassed(startedAt);
  // Poll only while waiting on the command just queued: closely, then loosely once the ceiling
  // has passed; the functional interval stops at a terminal state.
  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    enabled: commandId != null,
    refetchInterval: (query) => {
      const c = (query.state.data ?? []).find((x) => x.id === commandId);
      if (isTerminal(c?.status)) return false;
      return ceilingPassed ? COMMAND_LATE_MS : COMMAND_WATCH_MS;
    },
    refetchIntervalInBackground: false,
  });

  const queued = useMemo(
    () => (commandsQuery.data ?? []).find((c) => c.id === commandId) ?? null,
    [commandsQuery.data, commandId],
  );
  const status = queued?.status ?? (mutation.isPending || commandId != null ? 'PENDING' : null);
  const landed = isTerminal(status);
  const onItsWay = commandId != null && !landed;
  const noWord = onItsWay && ceilingPassed;
  const submitting = mutation.isPending || (onItsWay && !noWord);

  // The page behind the dialog shows the robot's state: re-read it the moment the command lands.
  useEffect(() => {
    if (landed) qc.invalidateQueries({ queryKey: ROOMBA_STATUS_KEY });
  }, [landed, commandId, qc]);

  return {
    send: () => { if (!submitting) mutation.mutate(); },
    status,
    detail: queued?.detail ?? null,
    submitting,
    done: status === 'OK',
    sendFailed: mutation.isError,
    noWord,
  };
}

/**
 * After a map edit lands, pull the floor plan again. The poller needs about one cycle to
 * re-fetch the map bundle, so refetch now and twice more. Fire-and-forget: the later refetches
 * still run if the dialog closes right away (invalidateQueries is safe after unmount).
 */
export function useRefreshMapWhenDone(done: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!done) return;
    qc.invalidateQueries({ queryKey: ['roomba-map'] });
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['roomba-map'] }), 30_000);
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['roomba-map'] }), 70_000);
  }, [done, qc]);
}

/** What happened to the queued command, in words, announced as it changes. */
export function CommandNotice({ cmd, accepted, refused, notQueued }: {
  cmd: QueuedCommand;
  /** "Cleaning started. The robot may take a moment to set off." */
  accepted: string;
  /** "The robot didn't start" (the robot's reason is added). */
  refused: string;
  /** "Couldn't queue the clean." */
  notQueued: string;
}) {
  if (cmd.sendFailed) {
    return <Notice tone="problem" live="polite" title={notQueued}>The home server didn't take it. Try again.</Notice>;
  }
  if (!cmd.status) return null;
  if (cmd.status === 'OK') return <Notice tone="ok" live="polite">{accepted}</Notice>;
  if (cmd.status === 'FAILED') {
    return <Notice tone="problem" live="polite">{refused}{cmd.detail ? `: ${cmd.detail}` : '.'}</Notice>;
  }
  if (cmd.noWord) {
    return (
      <Notice tone="headsup" live="polite" title="No word from the robot yet">
        It may still act. Check the robot's status before sending it again.
      </Notice>
    );
  }
  if (cmd.status === 'SENT') {
    return <Notice tone="info" live="polite" icon="refresh">Sent. Waiting for the robot…</Notice>;
  }
  return <Notice tone="info" live="polite" icon="refresh">Sending to the robot…</Notice>;
}

// Suction, passes and mode for a clean (both clean dialogs). Empty = the robot's own default.
export const SUCTION = [
  { value: '', label: 'Robot default' },
  { value: 'low', label: 'Quiet' },
  { value: 'medium', label: 'Standard' },
  { value: 'high', label: 'High' },
  { value: 'turbo', label: 'Max' },
] as const;

export const PASSES = [
  { value: '', label: 'Auto' },
  { value: 'one', label: 'One pass' },
  { value: 'two', label: 'Two passes' },
] as const;

// Combo robots only; a vacuum-only robot ignores mop modes.
export const MODES = [
  { value: '', label: 'Robot default' },
  { value: 'vacuum', label: 'Vacuum only' },
  { value: 'mop', label: 'Mop only' },
  { value: 'vacmop', label: 'Vacuum and mop' },
] as const;
