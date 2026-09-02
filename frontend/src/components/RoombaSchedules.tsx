import { useState } from 'react';
import type { CleanRoomOption } from './CleanModal';
import RoombaScheduleModal from './RoombaScheduleModal';
import { useRoombaSchedules } from '../hooks/useRoombaSchedules';
import type { RoombaSchedule, RoombaScheduleInput } from '../types';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WORKWEEK = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

/** Compact day summary: "Every day", "Weekdays", "Weekends", or "Mon, Wed, Fri". */
function daysLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const eq = (a: number[]) => a.length === sorted.length && a.every((v, i) => v === sorted[i]);
  if (eq(WEEKDAYS)) return 'Every day';
  if (eq(WORKWEEK)) return 'Weekdays';
  if (eq(WEEKEND)) return 'Weekends';
  return sorted.map((d) => DAY_LABELS[d]).join(', ');
}

/** "9:00 AM" from a 24-hour "HH:mm". */
function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function targetLabel(s: RoombaSchedule): string {
  if (s.targetType === 'WHOLE_HOUSE') return 'Whole house';
  const labels = s.roomLabels.length ? s.roomLabels : s.roomIds;
  const count = labels.length;
  const preview = labels.slice(0, 2).join(', ');
  return count <= 2 ? preview : `${preview} +${count - 2}`;
}

function lastRunLabel(iso: string | null): string {
  if (!iso) return 'Never run';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never run';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'Ran just now';
  if (diffMin < 60) return `Ran ${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Ran ${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  return `Ran ${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

/**
 * ADMIN-only "Automation" section on the Roomba tab: lists recurring cleaning
 * schedules with an enable toggle + last-run, and an add/edit modal + delete
 * confirm. A schedule fires the same clean the manual UI does, on its own timer.
 */
export default function RoombaSchedules({ rooms }: { rooms: CleanRoomOption[] }) {
  const { query, create, update, toggle, remove } = useRoombaSchedules(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RoombaSchedule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoombaSchedule | null>(null);

  const schedules = query.data ?? [];
  const busy = create.isPending || update.isPending;
  const submitError =
    (create.isError || update.isError) ? 'Couldn’t save the schedule. Try again.' : null;

  const openNew = () => {
    setEditing(null);
    setShowModal(true);
  };
  const openEdit = (s: RoombaSchedule) => {
    setEditing(s);
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    create.reset();
    update.reset();
  };

  const handleSubmit = (input: RoombaScheduleInput) => {
    const onDone = { onSuccess: () => closeModal() };
    if (editing) update.mutate({ id: editing.id, input }, onDone);
    else create.mutate(input, onDone);
  };

  return (
    <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
            Automation
          </p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Cleaning schedules</h3>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="rounded-xl border border-appaccent-border bg-appaccent-soft px-3 py-2 text-xs font-semibold text-appaccent-text transition-colors hover:brightness-110"
        >
          + New schedule
        </button>
      </div>

      {query.isLoading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-appinset" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-2.5 text-xs text-rose-200">
          Couldn’t load schedules.
        </p>
      ) : schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-appborder bg-appinset p-8 text-center">
          <p className="text-sm font-medium text-apptext-soft">No schedules yet</p>
          <p className="max-w-xs text-xs leading-5 text-apptext-muted">
            Add a schedule to have the robot clean automatically — the whole house or just
            the rooms you pick, on the days and time you choose.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-2xl border border-appborder bg-appinset p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-apptext">{s.name}</p>
                  {!s.enabled && (
                    <span className="rounded-full border border-appborder bg-appsurface-raised px-2 py-0.5 text-[10px] font-medium text-apptext-muted">
                      Paused
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-apptext-soft">
                  {daysLabel(s.daysOfWeek)} · {timeLabel(s.time)} · {targetLabel(s)}
                </p>
                <p className="mt-0.5 text-[11px] text-apptext-dim">{lastRunLabel(s.lastFiredAt)}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: s.id, nextEnabled: !s.enabled })}
                  disabled={toggle.isPending}
                  aria-pressed={s.enabled}
                  aria-label={s.enabled ? 'Disable schedule' : 'Enable schedule'}
                  className={`relative h-6 w-11 rounded-full border transition-colors disabled:opacity-60 ${
                    s.enabled
                      ? 'border-appaccent-border bg-appaccent-soft'
                      : 'border-appborder bg-appsurface-raised'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-apptext transition-all ${
                      s.enabled ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  className="rounded-lg border border-appborder bg-appsurface-raised px-2.5 py-1.5 text-xs font-medium text-apptext-soft transition-colors hover:bg-appinset-strong"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(s)}
                  className="rounded-lg border border-rose-300/25 bg-rose-300/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-300/20"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <RoombaScheduleModal
          rooms={rooms}
          initial={editing}
          onClose={closeModal}
          onSubmit={handleSubmit}
          submitting={busy}
          error={submitError}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delete schedule"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-apptext">Delete schedule?</h3>
            <p className="mt-2 text-sm leading-6 text-apptext-soft">
              “{confirmDelete.name}” will be removed and won’t run again. This can’t be undone.
            </p>
            {remove.isError && (
              <p className="mt-3 text-xs text-rose-300">Couldn’t delete. Try again.</p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-appborder bg-appinset px-4 py-2 text-sm font-medium text-apptext-soft transition-colors hover:bg-appinset-strong"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })
                }
                className="rounded-xl border border-rose-300/30 bg-rose-300/15 px-4 py-2 text-sm font-semibold text-rose-200 transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
