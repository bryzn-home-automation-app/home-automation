import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cleanRoombaRooms, fetchRoombaCommands } from '../api/roomba';
import { jitteredInterval } from '../hooks/useJitteredInterval';

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

export interface CleanRoomOption {
  id: string;
  name: string | null;
}

interface Props {
  rooms: CleanRoomOption[];
  onClose: () => void;
}

/**
 * "Start a clean" dialog. Choose scope — the whole house (every mapped room) or
 * a hand-picked selection — plus suction / passes / mode, then start. Both scopes
 * use the same confirmed region-clean path (one region per room).
 */
export default function CleanModal({ rooms, onClose }: Props) {
  const [scope, setScope] = useState<'all' | 'select'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const roomIds = useMemo(
    () => (scope === 'all' ? rooms.map((r) => r.id) : rooms.filter((r) => selected.has(r.id)).map((r) => r.id)),
    [scope, rooms, selected],
  );

  const mutation = useMutation({
    mutationFn: () =>
      cleanRoombaRooms(roomIds, suction || undefined, passes || undefined, mode || undefined),
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
  const done = status === 'OK';
  const canStart = roomIds.length > 0 && !submitting && !done;

  const toggleRoom = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectLabel =
    scope === 'all'
      ? `the whole house · ${rooms.length} room${rooms.length === 1 ? '' : 's'}`
      : `${roomIds.length} room${roomIds.length === 1 ? '' : 's'} selected`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Start a clean"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Clean</p>
        <h3 className="mt-2 text-lg font-semibold text-apptext">Start a clean</h3>
        <p className="mt-2 text-sm leading-6 text-apptext-soft">
          Pick what to clean and how, then send the robot off. It’ll return to the dock when done.
        </p>

        {/* Scope toggle */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          {(['all', 'select'] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={submitting || done}
              onClick={() => setScope(s)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                scope === s
                  ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                  : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover'
              }`}
            >
              {s === 'all' ? 'Whole house' : 'Pick rooms'}
            </button>
          ))}
        </div>

        {/* Room checklist (scrollable) */}
        {scope === 'select' && (
          <div className="mt-3 max-h-44 overflow-y-auto rounded-xl border border-appborder bg-appinset p-1.5">
            {rooms.length === 0 ? (
              <p className="px-2 py-3 text-xs text-apptext-muted">No mapped rooms yet.</p>
            ) : (
              rooms.map((r) => {
                const checked = selected.has(r.id);
                return (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-apptext hover:bg-appinset-strong"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={submitting || done}
                      onChange={() => toggleRoom(r.id)}
                      className="h-4 w-4 accent-appaccent"
                    />
                    <span className={r.name ? '' : 'italic text-apptext-muted'}>
                      {r.name ?? 'Unnamed room'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        )}

        <div className="mt-2 text-xs text-apptext-dim">Cleaning {selectLabel}.</div>

        {/* Options */}
        <label className="mt-4 block text-xs font-medium text-apptext-soft">
          Suction
          <select
            value={suction}
            onChange={(e) => setSuction(e.target.value)}
            disabled={submitting || done}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
          >
            {SUCTION.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-apptext-soft">
            Passes
            <select
              value={passes}
              onChange={(e) => setPasses(e.target.value)}
              disabled={submitting || done}
              className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
            >
              {PASSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-apptext-soft">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={submitting || done}
              className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border disabled:opacity-60"
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

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
            {done ? 'Done' : 'Cancel'}
          </button>
          {!done && (
            <button
              type="button"
              disabled={!canStart}
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
