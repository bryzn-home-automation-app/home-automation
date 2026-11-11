import { useState } from 'react';
import { cleanRoombaRoom } from '../api/roomba';
import type { RoomSelection } from './RoombaMap';
import { Button, Dialog, Field, Select, Stack } from './ui';
import { CommandNotice, MODES, PASSES, SUCTION, useQueuedCommand } from './roomba/useQueuedCommand';

interface Props {
  room: RoomSelection;
  onClose: () => void;
}

/**
 * "Clean this room": a confirmed-working region clean, with optional suction, passes and mode.
 * After queueing it watches the command until the robot accepts or refuses it.
 */
export default function RoomCleanModal({ room, onClose }: Props) {
  const [suction, setSuction] = useState('');
  const [passes, setPasses] = useState('');
  const [mode, setMode] = useState('');
  const cmd = useQueuedCommand(() =>
    cleanRoombaRoom(room.id, suction || undefined, passes || undefined, mode || undefined),
  );
  const locked = cmd.submitting || cmd.done;

  return (
    <Dialog
      open
      onClose={onClose}
      size="narrow"
      eyebrow="Roomba"
      title={room.name ? `Clean ${room.name}` : 'Clean this room'}
      subtitle="Just this room, then back to the dock."
      closeOnBackdrop={!locked}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>{cmd.done ? 'Done' : 'Cancel'}</Button>
          {!cmd.done && (
            <Button variant="primary" icon="play" busy={cmd.submitting} busyLabel="Starting…" onClick={cmd.send}>Start cleaning</Button>
          )}
        </>
      }
    >
      <Stack>
        <Field label="Suction">
          <Select value={suction} onChange={(e) => setSuction(e.target.value)} disabled={locked} options={SUCTION} />
        </Field>
        <Field label="Passes">
          <Select value={passes} onChange={(e) => setPasses(e.target.value)} disabled={locked} options={PASSES} />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)} disabled={locked} options={MODES} />
        </Field>
        <CommandNotice
          cmd={cmd}
          accepted="Cleaning started. The robot may take a moment to set off."
          refused="The robot didn't start"
          notQueued="Couldn't queue the clean."
        />
      </Stack>
    </Dialog>
  );
}

