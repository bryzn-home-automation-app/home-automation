import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRoombaCommands, sendRoombaCommand } from '../api/roomba';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import type { RoombaCommand } from '../types';
import { commandLabel, commandState, relativeInSentence, type RoombaState } from '../utils/roombaStatus';
import {
  COMMAND_WATCH_MS, CommandNotice, ROOMBA_STATUS_KEY, isTerminal, useCeilingPassed, type QueuedCommand,
} from './roomba/useQueuedCommand';
import { Button, ButtonRow, Stack } from './ui';

/** "Clean rooms · sent to the robot 2 min ago" for the last command (B-120: words, not "clean_rooms · OK"). */
export function lastCommandLine(cmd: { command: string; status: string; createdAt: string; processedAt: string | null; detail?: string | null }, now?: Date): string {
  const word = commandState(cmd.status).label.toLowerCase();
  const when = relativeInSentence(cmd.processedAt ?? cmd.createdAt, now);
  const why = cmd.status === 'FAILED' && cmd.detail ? `: ${cmd.detail}` : '';
  return `${commandLabel(cmd.command)} · ${word} ${when}${why}`;
}

/**
 * While a pressed key waits on the robot, re-read the status this often. After a send the
 * poller reads the robot back about once a second and writes each reading, so the page sees
 * the robot act within a second or so of it happening, not at the next 30 s poll.
 */
export const STATUS_WATCH_MS = 1000;
/** How long a command the poller marked OK holds its key if the status hasn't moved. */
export const COMMAND_SETTLE_MS = 30_000;

/** The command sent from these keys and what the robot looked like when it was sent. */
interface Sent {
  seq: number;
  command: string;
  id: number | null;
  /** Date.now() when the key was pressed (the COMMAND_CEILING_MS clock). */
  startedAt: number;
  /** The robot's state when the key was pressed; a change means the robot reacted. */
  stateKey: string;
  /** COMMAND_SETTLE_MS passed after OK without the status moving. */
  expired: boolean;
}

const stateKeyOf = (s: RoombaState) => `${s.label}|${s.paused}|${s.inMission}|${s.offline}`;

/**
 * ADMIN-only keys under the verdict. Commands are queued server-side and the poller sends them;
 * Clean opens the clean dialog (scope and options) rather than firing a bare start. The key that
 * leads changes with what the robot is doing: Clean when no clean is under way, Pause through the
 * whole mission (cleaning, emptying the bin, heading back or recharging to finish), Resume while
 * it's paused. Send home, Stop and Find are always there.
 *
 * A pressed key reports its command's progress (Sending → waiting for the robot → Sent to the
 * robot / Failed) and holds that same key so it can't be sent twice: for as long as the row is
 * queued or sent (the poller keeps a command it can check — pause, resume, stop, dock — at SENT
 * until it reads the robot reacting, resending once on silence, about 35 s at worst), then after
 * OK until the status moves or COMMAND_SETTLE_MS passes. A row still without an outcome after
 * COMMAND_CEILING_MS says "No word from the robot yet" and frees the key. While the key waits,
 * the status above is re-read every STATUS_WATCH_MS, so it shows the robot acting as soon as the
 * poller sees it.
 */
export default function RoombaControls({ state, onClean }: { state: RoombaState; onClean: () => void }) {
  const qc = useQueryClient();
  const commandsInterval = useJitteredInterval(8000);
  const [sent, setSent] = useState<Sent | null>(null);
  const seqRef = useRef(0);
  const ceilingPassed = useCeilingPassed(sent?.startedAt ?? null);

  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    // Quick while the command just sent is on its way (until the ceiling), the usual cadence
    // otherwise.
    refetchInterval: (query) => {
      if (sent?.id == null || ceilingPassed) return commandsInterval;
      const row = (query.state.data ?? []).find((c) => c.id === sent.id);
      return isTerminal(row?.status) ? commandsInterval : COMMAND_WATCH_MS;
    },
    refetchIntervalInBackground: false,
  });

  const mutation = useMutation({
    mutationFn: (command: string) => sendRoombaCommand(command),
    onSuccess: (row: RoombaCommand, command: string) => {
      setSent((s) => (s && s.command === command && s.id == null ? { ...s, id: row.id } : s));
      qc.invalidateQueries({ queryKey: ['roomba', 'commands'] });
      qc.invalidateQueries({ queryKey: ROOMBA_STATUS_KEY });
    },
  });

  const send = (command: string) => {
    const seq = ++seqRef.current;
    setSent({ seq, command, id: null, startedAt: Date.now(), stateKey: stateKeyOf(state), expired: false });
    mutation.mutate(command);
  };

  const commands = commandsQuery.data ?? [];
  const last = commands[0];
  const row = sent?.id != null ? commands.find((c) => c.id === sent.id) ?? null : null;
  const sendFailed = sent != null && mutation.isError;
  const status = sent == null || sendFailed ? null : row?.status ?? 'PENDING';
  const landed = isTerminal(status);
  // Queued or sent, no outcome yet; past the ceiling it's "no word yet" and the key is free.
  const onItsWay = status != null && !landed;
  const noWord = onItsWay && ceilingPassed;
  const stateMoved = sent != null && stateKeyOf(state) !== sent.stateKey;
  // Sent to the robot and then the status moved (or time ran out): back to the last-command line.
  const okSettled = status === 'OK' && (sent?.expired || stateMoved);
  // The same key waits while its row is on its way (the row, not a timer, says when it's done),
  // then after OK until the robot's status visibly moves.
  const waiting = sent != null && !sendFailed && (onItsWay ? !noWord : status === 'OK' && !stateMoved && !sent.expired);
  const inFlight = mutation.isPending || (onItsWay && !noWord);
  const sentSeq = sent?.seq;
  const okSeq = status === 'OK' ? sentSeq : undefined;

  // An OK row whose effect never shows lets go of its key after COMMAND_SETTLE_MS.
  useEffect(() => {
    if (okSeq == null) return;
    const timer = window.setTimeout(
      () => setSent((s) => (s && s.seq === okSeq ? { ...s, expired: true } : s)),
      COMMAND_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [okSeq]);

  // Watch the robot while the key waits: the status line above is the proof it acted.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => qc.invalidateQueries({ queryKey: ROOMBA_STATUS_KEY }), STATUS_WATCH_MS);
    return () => window.clearInterval(timer);
  }, [waiting, qc]);

  // And once more the moment the command row lands (OK or FAILED).
  useEffect(() => {
    if (landed) qc.invalidateQueries({ queryKey: ROOMBA_STATUS_KEY });
  }, [landed, sentSeq, qc]);

  const queued: QueuedCommand = {
    send: () => {},
    status,
    detail: row?.detail ?? null,
    submitting: inFlight,
    done: status === 'OK',
    sendFailed,
    noWord,
  };
  const label = commandLabel(sent?.command);

  const keyProps = (command: string) => {
    const busy = waiting && sent?.command === command;
    return {
      disabled: state.offline || (mutation.isPending && !busy),
      busy,
      busyLabel: status === 'PENDING' ? 'Sending…' : 'Waiting for the robot…',
      onClick: () => send(command),
    };
  };

  const primary = state.paused
    ? <Button variant="primary" size="lg" block icon="play" {...keyProps('resume')}>Resume</Button>
    : state.inMission
      ? <Button variant="primary" size="lg" block icon="pause" {...keyProps('pause')}>Pause</Button>
      : <Button variant="primary" size="lg" block icon="play" disabled={state.offline} onClick={onClean}>Clean</Button>;

  return (
    <Stack gap="s">
      {primary}
      <ButtonRow className="justify-center">
        <Button variant={state.inMission ? 'secondary' : 'quiet'} icon="dock" {...keyProps('dock')}>Send home</Button>
        {state.inMission && <Button variant="quiet" icon="stop" {...keyProps('stop')}>Stop here</Button>}
        <Button variant="quiet" icon="bell" {...keyProps('find')}>Find it</Button>
      </ButtonRow>
      {state.offline ? (
        <p className="fp-small fp-muted text-center" aria-live="polite">
          The robot is offline, so the keys wait until it checks in again.
        </p>
      ) : sent != null && !okSettled ? (
        <CommandNotice
          cmd={queued}
          accepted={`${label}: sent to the robot. The status above shows when it acts.`}
          refused={`${label} failed`}
          notQueued={`Couldn't send ${label}`}
        />
      ) : (
        <p className={`fp-small text-center ${last?.status === 'FAILED' ? 'fp-t-problem' : 'fp-muted'}`} aria-live="polite">
          {last
            ? `Last: ${lastCommandLine(last)}`
            : 'Sent to the robot means it got the command, not that it acted. The status above confirms it.'}
        </p>
      )}
    </Stack>
  );
}
