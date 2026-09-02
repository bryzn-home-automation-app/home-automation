import { useEffect, useMemo, useState } from 'react';
import type { CleanRoomOption } from './CleanModal';
import type { RoombaSchedule, RoombaScheduleInput } from '../types';

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

// ISO-8601 weekday numbers (1 = Monday … 7 = Sunday).
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

interface Props {
  rooms: CleanRoomOption[];
  initial?: RoombaSchedule | null;
  onClose: () => void;
  onSubmit: (input: RoombaScheduleInput) => void;
  submitting: boolean;
  error?: string | null;
}

/**
 * Add/edit dialog for a recurring cleaning schedule. Mirrors the "Start a clean"
 * dialog (scope + suction/passes/mode, same room checklist) and adds a name, a
 * weekday picker, a time, and an enable toggle. On submit it hands a
 * {@link RoombaScheduleInput} to the parent, which owns the mutation.
 */
export default function RoombaScheduleModal({
  rooms,
  initial,
  onClose,
  onSubmit,
  submitting,
  error,
}: Props) {
  const editing = initial != null;
  const [name, setName] = useState(initial?.name ?? '');
  const [days, setDays] = useState<Set<number>>(new Set(initial?.daysOfWeek ?? []));
  const [time, setTime] = useState(initial?.time ?? '09:00');
  const [scope, setScope] = useState<'all' | 'select'>(
    initial?.targetType === 'ROOMS' ? 'select' : 'all',
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.roomIds ?? []));
  const [suction, setSuction] = useState(initial?.suction ?? '');
  const [passes, setPasses] = useState(initial?.passes ?? '');
  const [mode, setMode] = useState(initial?.mode ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleDay = (d: number) =>
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const toggleRoom = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedRoomIds = useMemo(
    () => rooms.filter((r) => selected.has(r.id)).map((r) => r.id),
    [rooms, selected],
  );

  const canSubmit =
    name.trim().length > 0 &&
    days.size > 0 &&
    /^\d{2}:\d{2}$/.test(time) &&
    (scope === 'all' || selectedRoomIds.length > 0) &&
    !submitting;

  const submit = () => {
    setLocalError(null);
    if (name.trim().length === 0) return setLocalError('Give the schedule a name.');
    if (days.size === 0) return setLocalError('Pick at least one day.');
    if (!/^\d{2}:\d{2}$/.test(time)) return setLocalError('Choose a valid time.');
    if (scope === 'select' && selectedRoomIds.length === 0) {
      return setLocalError('Pick at least one room, or clean the whole house.');
    }

    const roomLabels =
      scope === 'select'
        ? rooms
            .filter((r) => selected.has(r.id))
            .map((r) => r.name ?? 'Unnamed room')
        : undefined;

    onSubmit({
      name: name.trim(),
      enabled,
      daysOfWeek: [...days].sort((a, b) => a - b),
      time,
      targetType: scope === 'all' ? 'WHOLE_HOUSE' : 'ROOMS',
      roomIds: scope === 'select' ? selectedRoomIds : undefined,
      roomLabels,
      suction: suction || undefined,
      passes: passes || undefined,
      mode: mode || undefined,
    });
  };

  const shownError = localError ?? error ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit schedule' : 'New schedule'}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-y-auto rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Automation
        </p>
        <h3 className="mt-2 text-lg font-semibold text-apptext">
          {editing ? 'Edit schedule' : 'New schedule'}
        </h3>
        <p className="mt-2 text-sm leading-6 text-apptext-soft">
          The robot will start this clean automatically on the days and time you pick.
        </p>

        {/* Name */}
        <label className="mt-5 block text-xs font-medium text-apptext-soft">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekday mornings"
            maxLength={120}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border"
          />
        </label>

        {/* Day picker */}
        <div className="mt-4">
          <p className="text-xs font-medium text-apptext-soft">Days</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = days.has(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`h-9 w-11 rounded-xl border text-xs font-semibold transition-colors ${
                    on
                      ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                      : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time */}
        <label className="mt-4 block text-xs font-medium text-apptext-soft">
          Time (America/Chicago)
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border"
          />
        </label>

        {/* Scope toggle */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(['all', 'select'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
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

        {/* Options */}
        <label className="mt-4 block text-xs font-medium text-apptext-soft">
          Suction
          <select
            value={suction}
            onChange={(e) => setSuction(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border"
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
              className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border"
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
              className="mt-1.5 w-full rounded-xl border border-appborder bg-appinset px-3 py-2.5 text-sm text-apptext outline-none focus:border-appaccent-border"
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Enable toggle */}
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-apptext-soft">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-appaccent"
          />
          Enabled
        </label>

        {shownError && <p className="mt-4 text-xs text-rose-300">{shownError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-appborder bg-appinset px-4 py-2 text-sm font-medium text-apptext-soft transition-colors hover:bg-appinset-strong"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="rounded-xl border border-appaccent-border bg-appaccent-soft px-4 py-2 text-sm font-semibold text-appaccent-text transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
