import { useMemo, useState } from 'react';
import { cleanRoombaRooms, sendRoombaCommand } from '../api/roomba';
import { plural } from '../utils/format';
import { Button, Checkbox, Dialog, Field, FormGrid, Notice, Seg, Select, Stack } from './ui';
import { CommandNotice, MODES, PASSES, SUCTION, useQueuedCommand } from './roomba/useQueuedCommand';

export interface CleanRoomOption {
  id: string;
  name: string | null;
}

interface Props {
  rooms: CleanRoomOption[];
  onClose: () => void;
}

type Scope = 'all' | 'select';
const SCOPES = [
  { value: 'all', label: 'Whole house' },
  { value: 'select', label: 'Pick rooms' },
] as const;

/** The line under the room choice, a whole sentence per scope (B-137: never "Cleaning 2 rooms selected."). */
export function cleanScopeSummary(scope: Scope, roomCount: number, picked: number): string {
  if (scope === 'all') return roomCount > 0 ? `Cleaning the whole house · ${plural(roomCount, 'room')}.` : 'Cleaning the whole house.';
  if (picked === 0) return 'Pick at least one room.';
  return `${plural(picked, 'room')} picked.`;
}

/**
 * "Start a clean". Choose the whole house (every mapped room) or a hand-picked selection, plus
 * suction / passes / mode, then start. Both scopes use the same confirmed region-clean path (one
 * region per room). With no map yet a whole-house clean falls back to a plain start, which can't
 * carry the options, so they are switched off and the dialog says so (B-135).
 */
export default function CleanModal({ rooms, onClose }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suction, setSuction] = useState('');
  const [passes, setPasses] = useState('');
  const [mode, setMode] = useState('');

  const roomIds = useMemo(
    () => (scope === 'all' ? rooms.map((r) => r.id) : rooms.filter((r) => selected.has(r.id)).map((r) => r.id)),
    [scope, rooms, selected],
  );

  const cmd = useQueuedCommand(() =>
    roomIds.length === 0
      ? sendRoombaCommand('start')
      : cleanRoombaRooms(roomIds, suction || undefined, passes || undefined, mode || undefined),
  );
  const locked = cmd.submitting || cmd.done;
  const noMap = rooms.length === 0;
  // Whole-house is always startable (a plain start when unmapped); a selection needs a room.
  const canStart = (scope === 'all' || roomIds.length > 0) && !locked;

  const toggleRoom = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Roomba"
      title="Start a clean"
      subtitle="It heads back to the dock when it's done."
      closeOnBackdrop={!locked}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>{cmd.done ? 'Done' : 'Cancel'}</Button>
          {!cmd.done && (
            <Button variant="primary" icon="play" disabled={!canStart && !cmd.submitting} busy={cmd.submitting} busyLabel="Starting…" onClick={cmd.send}>
              Start cleaning
            </Button>
          )}
        </>
      }
    >
      <Stack gap="l">
        <Stack gap="m">
          <Seg kind="radio" fit="fill" label="What to clean" value={scope} onChange={setScope} options={SCOPES} />
          {scope === 'select' && (
            noMap ? (
              <p className="fp-small fp-muted">No mapped rooms yet. Rooms appear after the robot has mapped the house.</p>
            ) : (
              <fieldset className="fp-fieldset grid grid-cols-1 gap-x-3 sm:grid-cols-2" disabled={locked}>
                <legend className="fp-sr-only">Rooms</legend>
                {rooms.map((r) => (
                  <Checkbox
                    key={r.id}
                    label={r.name ?? <span className="fp-muted italic">Unnamed room</span>}
                    checked={selected.has(r.id)}
                    onChange={() => toggleRoom(r.id)}
                  />
                ))}
              </fieldset>
            )
          )}
          <p className="fp-small fp-muted" aria-live="polite">{cleanScopeSummary(scope, rooms.length, roomIds.length)}</p>
        </Stack>

        <FormGrid>
          <Field label="Suction" wide>
            <Select value={suction} onChange={(e) => setSuction(e.target.value)} disabled={locked || noMap} options={SUCTION} />
          </Field>
          <Field label="Passes">
            <Select value={passes} onChange={(e) => setPasses(e.target.value)} disabled={locked || noMap} options={PASSES} />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value)} disabled={locked || noMap} options={MODES} />
          </Field>
        </FormGrid>
        {noMap && (
          <Notice tone="neutral">Options need the floor map, so this runs a standard clean.</Notice>
        )}

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
