import { memo } from 'react';
import type { RoombaPart } from '../types';

/**
 * Consumable / maintenance counters from the robot's cloud record — the same
 * numbers the iRobot app's Maintenance screen shows (filter, brushes, mop pad,
 * dock bag, routine clean-ups). Read-only: after servicing a part you mark it
 * done in the iRobot app, which resets the counter; the dock resets the bag
 * counter itself when a new bag is fitted.
 */

const STATUS_STYLE: Record<string, { label: string; pill: string; bar: string }> = {
  overdue: {
    label: 'Overdue',
    pill: 'border-rose-300/25 bg-rose-300/10 text-rose-300',
    bar: 'bg-rose-400',
  },
  due_soon: {
    label: 'Due soon',
    pill: 'border-amber-300/25 bg-amber-300/10 text-amber-300',
    bar: 'bg-amber-400',
  },
  ok: {
    label: 'OK',
    pill: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-300',
    bar: 'bg-emerald-400',
  },
  unknown: {
    label: '—',
    pill: 'border-appborder bg-appinset text-apptext-muted',
    bar: 'bg-apptext-dim',
  },
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "40 hr left", "27 missions left", "Bag full" … per the part's unit. */
export function remainingText(p: RoombaPart): string {
  if (p.countRemaining == null) return 'No counter';
  const n = Math.max(0, p.countRemaining);
  switch (p.unit) {
    case 'hours': {
      if (n === 0) return 'Replace now';
      const hrs = n / 60;
      return hrs < 1 ? 'Under 1 hr left' : `${Math.round(hrs)} hr left`;
    }
    case 'missions':
      return n === 0 ? 'Due now' : `${plural(n, 'mission', 'missions')} left`;
    case 'empties':
      return n === 0 ? 'Bag full' : `${plural(n, 'empty', 'empties')} left`;
    case 'washes':
      return `${plural(n, 'wash', 'washes')} left`;
    default:
      return `${n} left`;
  }
}

export function usedText(p: RoombaPart): string | null {
  if (p.countUsed == null) return null;
  const n = Math.max(0, p.countUsed);
  switch (p.unit) {
    case 'hours':
      return `${Math.round(n / 60)} hr used`;
    case 'missions':
      return `${plural(n, 'mission', 'missions')} used`;
    case 'empties':
      return `${plural(n, 'empty', 'empties')} used`;
    case 'washes':
      return `${plural(n, 'wash', 'washes')} used`;
    default:
      return `${n} used`;
  }
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.round((Date.now() - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function actionLabel(action: string | null): string {
  if (action === 'replace') return 'Replace';
  if (action === 'clean') return 'Clean';
  return 'Service';
}

function PartTile({ part }: { part: RoombaPart }) {
  const st = STATUS_STYLE[part.status] ?? STATUS_STYLE.unknown;
  const pct = part.pctRemaining ?? 0;
  const used = usedText(part);
  const meta = [used, part.lastUpdatedAt ? `updated ${relative(part.lastUpdatedAt)}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rounded-2xl border border-appborder bg-appinset p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-apptext">{part.label}</p>
          <p className="text-2xs text-apptext-dim">
            {actionLabel(part.action)} · part {part.partId}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium ${st.pill}`}>
          {st.label}
        </span>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-appsurface"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={part.pctRemaining ?? undefined}
        aria-label={`${part.label} life remaining`}
      >
        <div
          className={`h-full rounded-full ${st.bar}`}
          style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-apptext-soft">{remainingText(part)}</span>
        {part.pctRemaining != null && (
          <span className="tabular-nums text-apptext-dim">{part.pctRemaining}%</span>
        )}
      </div>
      {meta && <p className="mt-1 text-2xs text-apptext-dim">{meta}</p>}
      {part.hint && <p className="mt-2 text-2xs leading-4 text-apptext-muted">{part.hint}</p>}
    </div>
  );
}

interface Props {
  parts: RoombaPart[];
  loading: boolean;
  error?: boolean;
}

function RoombaMaintenance({ parts, loading, error }: Props) {
  const overdue = parts.filter((p) => p.status === 'overdue').length;
  const dueSoon = parts.filter((p) => p.status === 'due_soon').length;
  const summary = overdue
    ? `${plural(overdue, 'part', 'parts')} overdue`
    : dueSoon
      ? `${plural(dueSoon, 'part', 'parts')} due soon`
      : parts.length
        ? 'Everything is within its service life'
        : null;
  const summaryTone = overdue ? 'text-rose-300' : dueSoon ? 'text-amber-300' : 'text-apptext-muted';

  return (
    <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">
            Maintenance
          </p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">Parts &amp; upkeep</h3>
          {summary && <p className={`mt-1 text-sm ${summaryTone}`}>{summary}</p>}
        </div>
        {parts.length > 0 && (
          <span className="shrink-0 text-xs text-apptext-dim">
            {parts.length} item{parts.length === 1 ? '' : 's'} tracked
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid animate-pulse grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-appinset" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-2.5 text-xs text-rose-200">
          Couldn't load the maintenance counters. They'll reappear once the service is reachable.
        </p>
      ) : parts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-appborder bg-appinset px-4 py-3 text-xs leading-5 text-apptext-muted">
          No maintenance data yet — the poller reads the robot's part counters when it connects,
          shortly after each clean, and every few hours.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {parts.map((p) => (
            <PartTile key={p.partId} part={p} />
          ))}
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-apptext-dim">
        These counters come straight from the robot's cloud record — the same ones the iRobot
        app's Maintenance screen shows. After replacing or cleaning a part, mark it done in the
        iRobot app to reset its counter (the dock resets the bag counter itself).
      </p>
    </section>
  );
}

export default memo(RoombaMaintenance);
