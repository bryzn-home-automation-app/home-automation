import { useRoombaNativeSchedules } from '../hooks/useRoombaNativeSchedules';

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

// Vendor operating-mode codec (poller.py::_clean_command_params / control.md).
const MODE_LABELS: Record<number, string> = { 2: 'Vacuum', 4: 'Mop', 6: 'Vac+Mop' };

function formatDays(days: number[]): string {
  if (days.length === 0) return '—';
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d] ?? `d${d}`).join('/');
}

function formatTime(hour: number | null, minute: number | null): string {
  if (hour == null || minute == null) return '—';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function formatModes(modes: number[]): string {
  if (modes.length === 0) return '—';
  return modes.map((m) => MODE_LABELS[m] ?? `mode ${m}`).join(' + ');
}

/**
 * REAL (robot/cloud-side) schedules — what the iRobot app itself reads, not an
 * app-side approximation. Replaces the old RoombaSchedules component, which
 * fired a plain "start" at the right time but never wrote the robot's own
 * schedule, so nothing it made ever showed up in the iRobot app.
 *
 * Read-only by design for now: creating/editing a native schedule is the
 * highest-risk write this integration has (see roomba-v4-integration's
 * control.md) — a malformed one is a delayed-effect failure that can start
 * the robot when nobody's home, and the API itself has sharp edges probing
 * already found (a batched create only keeps the last schedule; two
 * similarly-named ids where only one works for delete). Until that's
 * hardened enough to trust in a UI, use roomba-v4-integration/probes/
 * probe6..8_schedule_*.py to add/remove one — this view just shows what's
 * really there and lets you pull a fresh read.
 */
export default function RoombaNativeSchedules({ isAdmin }: { isAdmin: boolean }) {
  const { query, refresh } = useRoombaNativeSchedules(true);
  const schedules = query.data ?? [];

  return (
    <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
            Real schedules
          </p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Native Schedule</h3>
        </div>
        {isAdmin && (
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            className="rounded-xl border border-appborder bg-appinset px-3 py-2 text-xs font-medium text-apptext-soft transition-colors hover:border-appborder-hover hover:bg-appinset-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refresh.isPending ? 'Refreshing…' : 'Refresh from robot'}
          </button>
        )}
      </div>

      {schedules.length === 0 ? (
        <p className="text-xs text-apptext-dim">
          {query.isLoading
            ? 'Loading…'
            : 'No schedules read yet — click "Refresh from robot" to pull what the iRobot app currently has set.'}
        </p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div
              key={s.householdScheduleId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-appborder bg-appinset px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-apptext">{s.name ?? '(unnamed)'}</p>
                <p className="text-xs text-apptext-muted">
                  {formatDays(s.days)} · {formatTime(s.hour, s.minute)} · {formatModes(s.operatingModes)}
                  {s.roomCount > 0 ? ` · ${s.roomCount} room(s)` : ''}
                </p>
              </div>
              <span
                className={`text-xs font-medium ${s.enabled ? 'text-emerald-300' : 'text-apptext-dim'}`}
              >
                {s.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-apptext-dim">
        Read-only — this mirrors exactly what the iRobot app has, including
        schedules created there directly. Adding or removing one isn't built
        into the app yet; ask for a change and it'll be done via a checked
        script rather than a live edit here.
      </p>
    </section>
  );
}
