import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { renameRoombaRoom, fetchRoombaCommands } from '../api/roomba';
import { jitteredInterval } from '../hooks/useJitteredInterval';
import type { RoomSelection } from './RoombaMap';

/** RoomCategory wire values (snake_case) the robot accepts. Empty = leave unchanged. */
const CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: 'Leave unchanged' },
  { value: 'living_room', label: 'Living room' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'dining_room', label: 'Dining room' },
  { value: 'hallway', label: 'Hallway' },
  { value: 'balcony', label: 'Balcony' },
  { value: 'other', label: 'Other' },
];

const MAX_NAME = 80;

interface Props {
  room: RoomSelection;
  onClose: () => void;
}

/**
 * ADMIN room-rename dialog. Enqueues a rename command and then watches that
 * command's status (the poller applies it via the robot's map-edit API). On
 * success the floor-plan query is invalidated so the new label appears once the
 * poller has re-fetched the map bundle.
 */
export default function RoomRenameModal({ room, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(room.name ?? '');
  const [category, setCategory] = useState('');
  const [commandId, setCommandId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 || category !== '';

  const mutation = useMutation({
    mutationFn: () =>
      renameRoombaRoom(room.id, trimmed || undefined, category || undefined),
    onSuccess: (cmd) => setCommandId(cmd.id),
  });

  const isTerminalStatus = (s: string | undefined) => s === 'OK' || s === 'FAILED';

  // Poll command status while we're waiting on the one we just queued — the
  // functional refetchInterval stops polling once it reaches a terminal state.
  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    enabled: commandId != null,
    refetchInterval: (query) => {
      const c = (query.state.data ?? []).find((x) => x.id === commandId);
      return isTerminalStatus(c?.status) ? false : jitteredInterval(2500);
    },
    refetchIntervalInBackground: false,
  });

  const queued = useMemo(
    () => (commandsQuery.data ?? []).find((c) => c.id === commandId) ?? null,
    [commandsQuery.data, commandId],
  );

  const status = queued?.status ?? (mutation.isPending || commandId != null ? 'PENDING' : null);

  // When the rename lands, refresh the map so the new label shows up. The poller
  // needs ~one poll cycle to re-fetch the map bundle, so refetch now (cheap) and
  // again shortly after to catch the regenerated map. Fire-and-forget so the
  // delayed refetches still run if the dialog is closed right after success —
  // invalidateQueries is global and safe after unmount.
  useEffect(() => {
    if (queued?.status !== 'OK') return;
    qc.invalidateQueries({ queryKey: ['roomba-map'] });
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['roomba-map'] }), 30_000);
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['roomba-map'] }), 70_000);
  }, [queued?.status, qc]);

  const submitting =
    mutation.isPending || (commandId != null && !isTerminalStatus(status ?? undefined));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Rename room`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Floor plan
        </p>
        <h3 className="mt-2 text-lg font-semibold text-apptext">
          {room.name ? `Rename “${room.name}”` : 'Name this room'}
        </h3>

        <label className="mt-5 block text-xs font-medium text-apptext-soft">
          Room name
          <input
            ref={inputRef}
            type="text"
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Living room"
            disabled={submitting || status === 'OK'}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
          />
        </label>

        <label className="mt-4 block text-xs font-medium text-apptext-soft">
          Room type
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={submitting || status === 'OK'}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {status && (
          <div
            className={`mt-4 rounded-xl border px-3 py-2.5 text-xs ${
              status === 'OK'
                ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-300'
                : status === 'FAILED'
                  ? 'border-rose-300/25 bg-rose-300/10 text-rose-300'
                  : 'border-amber-300/25 bg-amber-300/10 text-amber-300'
            }`}
          >
            {status === 'OK'
              ? 'Applied — the floor plan will update within a minute.'
              : status === 'FAILED'
                ? `The robot rejected the change${queued?.detail ? `: ${queued.detail}` : '.'}`
                : 'Sending to the robot…'}
          </div>
        )}
        {mutation.isError && (
          <p className="mt-3 text-xs text-rose-300">Couldn’t queue the rename. Try again.</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-appborder bg-appinset px-4 py-2 text-sm font-medium text-apptext-soft transition-colors hover:bg-appinset-strong"
          >
            {status === 'OK' ? 'Done' : 'Cancel'}
          </button>
          {status !== 'OK' && (
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={() => mutation.mutate()}
              className="rounded-xl border border-appaccent-border bg-appaccent-soft px-4 py-2 text-sm font-semibold text-appaccent-text transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
