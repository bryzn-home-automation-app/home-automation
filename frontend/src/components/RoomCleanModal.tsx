import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cleanRoombaRoom, fetchRoombaCommands } from '../api/roomba';
import { jitteredInterval } from '../hooks/useJitteredInterval';
import type { RoomSelection } from './RoombaMap';

const SUCTION: { value: string; label: string }[] = [
  { value: '', label: 'Robot default' },
  { value: 'low', label: 'Quiet (Low)' },
  { value: 'medium', label: 'Standard (Medium)' },
  { value: 'high', label: 'High' },
  { value: 'turbo', label: 'Max (Turbo)' },
];

const PASSES: { value: string; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'one', label: 'Single pass' },
  { value: 'two', label: 'Two passes' },
];

// Combo robots only; a vacuum-only robot ignores mop modes.
const MODES: { value: string; label: string }[] = [
  { value: '', label: 'Robot default' },
  { value: 'vacuum', label: 'Vacuum only' },
  { value: 'mop', label: 'Mop only' },
  { value: 'vacmop', label: 'Vacuum + mop' },
];

interface Props {
  room: RoomSelection;
  onClose: () => void;
}

/**
 * "Clean this room" dialog — a confirmed-working region clean, with optional
 * suction level + passes. After enqueueing it watches the command status.
 */
export default function RoomCleanModal({ room, onClose }: Props) {
  const [suction, setSuction] = useState('');
  const [passes, setPasses] = useState('');
  const [mode, setMode] = useState('');
  const [commandId, setCommandId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () =>
      cleanRoombaRoom(room.id, suction || undefined, passes || undefined, mode || undefined),
    onSuccess: (cmd) => setCommandId(cmd.id),
  });

  const isTerminalStatus = (s: string | undefined) => s === 'OK' || s === 'FAILED';

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
  const submitting =
    mutation.isPending || (commandId != null && !isTerminalStatus(status ?? undefined));
  const roomLabel = room.name ? `“${room.name}”` : 'this room';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Clean room"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Clean
        </p>
        <h3 className="mt-2 text-lg font-semibold text-apptext">Clean {roomLabel}</h3>
        <p className="mt-2 text-sm leading-6 text-apptext-soft">
          Send the robot to clean just this room. It’ll return to the dock when done.
        </p>

        <label className="mt-5 block text-xs font-medium text-apptext-soft">
          Suction
          <select
            value={suction}
            onChange={(e) => setSuction(e.target.value)}
            disabled={submitting || status === 'OK'}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
          >
            {SUCTION.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-xs font-medium text-apptext-soft">
          Cleaning passes
          <select
            value={passes}
            onChange={(e) => setPasses(e.target.value)}
            disabled={submitting || status === 'OK'}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
          >
            {PASSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-xs font-medium text-apptext-soft">
          Mode
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={submitting || status === 'OK'}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
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
              ? 'Cleaning started — the robot may take a moment to set off.'
              : status === 'FAILED'
                ? `The robot didn’t start${queued?.detail ? `: ${queued.detail}` : '.'}`
                : 'Sending to the robot…'}
          </div>
        )}
        {mutation.isError && (
          <p className="mt-3 text-xs text-rose-300">Couldn’t queue the clean. Try again.</p>
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
              disabled={submitting}
              onClick={() => mutation.mutate()}
              className="rounded-xl border border-appaccent-border bg-appaccent-soft px-4 py-2 text-sm font-semibold text-appaccent-text transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Starting…' : 'Start cleaning'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
