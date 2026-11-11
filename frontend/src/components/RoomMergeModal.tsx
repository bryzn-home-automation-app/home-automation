import { useState } from 'react';
import { mergeRoombaRooms } from '../api/roomba';
import { formatList } from '../utils/format';
import type { RoomSelection } from './RoombaMap';
import { Button, Checkbox, Dialog, Notice, Stack } from './ui';
import { CommandNotice, useQueuedCommand, useRefreshMapWhenDone } from './roomba/useQueuedCommand';

interface Props {
  rooms: RoomSelection[];
  onClose: () => void;
}

/**
 * Confirmation for merging rooms. An EXPERIMENTAL, not-cleanly-reversible map edit (never
 * validated on hardware), so it needs an explicit acknowledgement. After queueing it watches the
 * command and refreshes the floor plan when the merge lands.
 */
export default function RoomMergeModal({ rooms, onClose }: Props) {
  const [ack, setAck] = useState(false);
  const cmd = useQueuedCommand(() => mergeRoombaRooms(rooms.map((r) => r.id)));
  useRefreshMapWhenDone(cmd.done);
  const names = rooms.map((r) => r.name ?? 'an unnamed room');

  return (
    <Dialog
      open
      onClose={onClose}
      size="narrow"
      eyebrow="Floor plan"
      title={`Merge ${rooms.length} rooms`}
      subtitle={`Combine ${formatList(names)} into one room.`}
      closeOnBackdrop={!cmd.submitting}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>{cmd.done ? 'Done' : 'Cancel'}</Button>
          {!cmd.done && (
            <Button variant="danger" disabled={!ack && !cmd.submitting} busy={cmd.submitting} busyLabel="Merging…" onClick={cmd.send}>
              Merge {rooms.length} rooms
            </Button>
          )}
        </>
      }
    >
      <Stack>
        <Notice tone="headsup" title="Experimental.">
          Merging hasn't been tried on this robot and can't be cleanly undone here. The new room is
          worked out fresh, not restored. Divide it again or reset the map in the iRobot app if needed.
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
          refused="The robot turned the merge down"
          notQueued="Couldn't queue the merge."
        />
      </Stack>
    </Dialog>
  );
}
