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

const isTerminal = (s: string | undefined) => s === 'OK' || s === 'FAILED';

/** Re-read the command row this often while it's queued or sent (the poller picks it up at once). */
const COMMAND_WATCH_MS = 1000;
/** The status query the Roomba page reads; refreshed the moment a command lands. */
const ROOMBA_STATUS_KEY = ['roomba-status'] as const;

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
}

export function useQueuedCommand(queue: () => Promise<RoombaCommand>): QueuedCommand {
  const qc = useQueryClient();
  const [commandId, setCommandId] = useState<number | null>(null);
  const mutation = useMutation({ mutationFn: queue, onSuccess: (cmd) => setCommandId(cmd.id) });

  // Poll only while waiting on the command just queued; the functional interval stops at a
  // terminal state.
  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    enabled: commandId != null,
    refetchInterval: (query) => {
      const c = (query.state.data ?? []).find((x) => x.id === commandId);
      return isTerminal(c?.status) ? false : COMMAND_WATCH_MS;
    },
    refetchIntervalInBackground: false,
  });

  const queued = useMemo(
    () => (commandsQuery.data ?? []).find((c) => c.id === commandId) ?? null,
    [commandsQuery.data, commandId],
  );
  const status = queued?.status ?? (mutation.isPending || commandId != null ? 'PENDING' : null);
  const submitting = mutation.isPending || (commandId != null && !isTerminal(status ?? undefined));
  const landed = isTerminal(status ?? undefined);

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
