import { useRef, useState } from 'react';
import { renameRoombaRoom } from '../api/roomba';
import type { RoomSelection } from './RoombaMap';
import { Button, Dialog, Field, Input, Select, Stack } from './ui';
import { CommandNotice, useQueuedCommand, useRefreshMapWhenDone } from './roomba/useQueuedCommand';

/** RoomCategory wire values (snake_case) the robot accepts. Empty = leave unchanged. */
const CATEGORIES = [
  { value: '', label: 'Leave as it is' },
  { value: 'living_room', label: 'Living room' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'dining_room', label: 'Dining room' },
  { value: 'hallway', label: 'Hallway' },
  { value: 'balcony', label: 'Balcony' },
  { value: 'other', label: 'Other' },
] as const;

const MAX_NAME = 80;

interface Props {
  room: RoomSelection;
  onClose: () => void;
}

/**
 * ADMIN room-rename dialog. Queues a rename and watches it (the poller applies it through the
 * robot's map-edit API); once it lands the floor plan is refetched so the new label shows.
 */
export default function RoomRenameModal({ room, onClose }: Props) {
  const [name, setName] = useState(room.name ?? '');
  const [category, setCategory] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 || category !== '';
  const cmd = useQueuedCommand(() => renameRoombaRoom(room.id, trimmed || undefined, category || undefined));
  useRefreshMapWhenDone(cmd.done);
  const locked = cmd.submitting || cmd.done;
  const dirty = trimmed !== (room.name ?? '') || category !== '';

  return (
    <Dialog
      open
      onClose={onClose}
      size="narrow"
      eyebrow="Floor plan"
      title={room.name ? `Rename ${room.name}` : 'Name this room'}
      subtitle="The map updates within a minute."
      // The name box gets first focus (B-043), with its text selected for a quick retype.
      initialFocusRef={inputRef}
      closeOnBackdrop={!dirty || cmd.done}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>{cmd.done ? 'Done' : 'Cancel'}</Button>
          {!cmd.done && (
            <Button variant="primary" disabled={!canSubmit && !cmd.submitting} busy={cmd.submitting} busyLabel="Saving…" onClick={cmd.send}>Save</Button>
          )}
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !locked) cmd.send();
        }}
      >
        <Stack>
          <Field label="Room name">
            <Input
              ref={inputRef}
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="For example, Living room"
              disabled={locked}
              autoComplete="off"
            />
          </Field>
          <Field label="Room type">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} disabled={locked} options={CATEGORIES} />
          </Field>
          <CommandNotice
            cmd={cmd}
            accepted="Saved. The floor plan updates within a minute."
            refused="The robot turned the change down"
            notQueued="Couldn't queue the rename."
          />
        </Stack>
      </form>
    </Dialog>
  );
}
