import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRoombaCommands, sendRoombaCommand } from '../api/roomba';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { commandLabel, commandState, relativeInSentence, type RoombaState } from '../utils/roombaStatus';
import { Button, ButtonRow, Stack } from './ui';

/** "Clean rooms · accepted 2 min ago" for the last command (B-120: words, not "clean_rooms · OK"). */
export function lastCommandLine(cmd: { command: string; status: string; createdAt: string; processedAt: string | null }, now?: Date): string {
  const word = commandState(cmd.status).label.toLowerCase();
  const when = relativeInSentence(cmd.processedAt ?? cmd.createdAt, now);
  return `${commandLabel(cmd.command)} · ${word} ${when}`;
}

/**
 * ADMIN-only keys under the verdict. Commands are queued server-side and the poller sends them;
 * Clean opens the clean dialog (scope and options) rather than firing a bare start. The key that
 * leads changes with what the robot is doing: Clean when it's free, Pause while it cleans,
 * Resume while it's paused. Send home, Stop and Find are always there.
 */
export default function RoombaControls({ state, onClean }: { state: RoombaState; onClean: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const commandsInterval = useJitteredInterval(8000);

  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    refetchInterval: commandsInterval,
    refetchIntervalInBackground: false,
  });

  const mutation = useMutation({
    mutationFn: (command: string) => sendRoombaCommand(command),
    onSuccess: (cmd) => {
      // Queued is what this means: the poller picks it up on its next tick (B-120).
      setNote(`${commandLabel(cmd.command)}: queued. The robot picks it up within a few seconds.`);
      qc.invalidateQueries({ queryKey: ['roomba', 'commands'] });
    },
    onError: () => setNote("Couldn't queue the command. Try again."),
  });

  const last = (commandsQuery.data ?? [])[0];
  const disabled = mutation.isPending || state.offline;
  const send = (command: string) => mutation.mutate(command);

  const primary = state.paused
    ? <Button variant="primary" size="lg" block icon="play" disabled={disabled} onClick={() => send('resume')}>Resume</Button>
    : state.cleaning
      ? <Button variant="primary" size="lg" block icon="pause" disabled={disabled} onClick={() => send('pause')}>Pause</Button>
      : <Button variant="primary" size="lg" block icon="play" disabled={state.offline} onClick={onClean}>Clean</Button>;

  return (
    <Stack gap="s">
      {primary}
      <ButtonRow className="justify-center">
        <Button variant={state.inMission ? 'secondary' : 'quiet'} icon="dock" disabled={disabled} onClick={() => send('dock')}>Send home</Button>
        {state.inMission && <Button variant="quiet" icon="stop" disabled={disabled} onClick={() => send('stop')}>Stop here</Button>}
        <Button variant="quiet" icon="bell" disabled={disabled} onClick={() => send('find')}>Find it</Button>
      </ButtonRow>
      <p className="fp-small fp-muted text-center" aria-live="polite">
        {state.offline
          ? "The robot is offline, so the keys wait until it checks in again."
          : note ?? (last ? `Last: ${lastCommandLine(last)}` : 'Accepted means the robot took the command, not that it ran. The status above confirms it.')}
      </p>
    </Stack>
  );
}
