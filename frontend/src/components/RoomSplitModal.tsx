import { useState } from 'react';
import { splitRoombaRoom } from '../api/roomba';
import type { SplitLine } from './RoombaMap';
import { Button, Checkbox, Dialog, Notice, Stack } from './ui';
import { CommandNotice, useQueuedCommand, useRefreshMapWhenDone } from './roomba/useQueuedCommand';

interface Props {
  split: SplitLine;
  onClose: () => void;
}

/**
 * Confirmation for dividing a room. An EXPERIMENTAL, not-cleanly-reversible map edit (never
 * validated on hardware), so it needs an explicit acknowledgement before sending. After queueing
 * it watches the command and refreshes the floor plan when the divide lands.
 */
export default function RoomSplitModal({ split, onClose }: Props) {
  const [ack, setAck] = useState(false);
  const cmd = useQueuedCommand(() => splitRoombaRoom(split.roomId, split.points));
  useRefreshMapWhenDone(cmd.done);
  const roomLabel = split.roomName ?? 'this room';

  return (
    <Dialog
      open
      onClose={onClose}
      size="narrow"
      eyebrow="Floor plan"
      title={`Divide ${roomLabel}`}
      subtitle={`Splits ${roomLabel} in two along the line you drew.`}
      closeOnBackdrop={!cmd.submitting}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>{cmd.done ? 'Done' : 'Cancel'}</Button>
          {!cmd.done && (
            <Button variant="danger" disabled={!ack && !cmd.submitting} busy={cmd.submitting} busyLabel="Dividing…" onClick={cmd.send}>Divide room</Button>
          )}
        </>
      }
    >
      <Stack>
        <Notice tone="headsup" title="Experimental.">
          Dividing a room hasn't been tried on this robot and can't be cleanly undone here. If it goes
          wrong, merge the rooms again or reset the map in the iRobot app.
        </Notice>
        {!cmd.status && (
          <Checkbox
            label="I understand this is experimental and may not be reversible."
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
        )}
        <CommandNotice
          cmd={cmd}
          accepted="Done. The floor plan updates within a minute."
          refused="The robot turned the divide down"
          notQueued="Couldn't queue the divide."
        />
      </Stack>
    </Dialog>
  );
}
