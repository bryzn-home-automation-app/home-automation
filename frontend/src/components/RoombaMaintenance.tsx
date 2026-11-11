import { memo } from 'react';
import type { RoombaPart } from '../types';
import { plural } from '../utils/format';
import { relativeInSentence } from '../utils/roombaStatus';
import type { Tone } from '../utils/status';
import { Badge, EmptyState, ErrorState, Loading, MeterRow, Panel, Progress, SkelRows } from './ui';

/**
 * Consumable / maintenance counters from the robot's cloud record: the same numbers the iRobot
 * app's Maintenance screen shows (filter, brushes, mop pad, dock bag, routine clean-ups).
 * Read-only: after servicing a part you mark it done in the iRobot app, which resets the
 * counter; the dock resets the bag counter itself when a new bag is fitted.
 */

const PART_STATUS: Record<string, { tone: Tone; label: string }> = {
  overdue: { tone: 'headsup', label: 'Overdue' },
  due_soon: { tone: 'headsup', label: 'Due soon' },
  ok: { tone: 'ok', label: 'OK' },
};
const UNKNOWN = { tone: 'neutral' as Tone, label: 'No reading' };

/** A part's status as a tone and a word. */
export function partStatus(status: string | null | undefined): { tone: Tone; label: string } {
  return (status && PART_STATUS[status]) || UNKNOWN;
}

const RANK: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2 };

/** Worst first, then least life left: the order people should look at them in. */
export function sortParts(parts: readonly RoombaPart[]): RoombaPart[] {
  return [...parts].sort(
    (a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || (a.pctRemaining ?? 101) - (b.pctRemaining ?? 101),
  );
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
      return n === 0 ? 'Due now' : `${plural(n, 'mission')} left`;
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
      return `${plural(n, 'mission')} used`;
    case 'empties':
      return `${plural(n, 'empty', 'empties')} used`;
    case 'washes':
      return `${plural(n, 'wash', 'washes')} used`;
    default:
      return `${n} used`;
  }
}

function actionLabel(action: string | null): string {
  if (action === 'replace') return 'Replace';
  if (action === 'clean') return 'Clean';
  return 'Service';
}

function PartItem({ part }: { part: RoombaPart }) {
  const st = partStatus(part.status);
  const used = usedText(part);
  const meta = [used, part.lastUpdatedAt ? `updated ${relativeInSentence(part.lastUpdatedAt)}` : null]
    .filter(Boolean)
    .join(' · ');
  const progressTone: Tone = part.status === 'overdue' || part.status === 'due_soon' ? 'headsup' : st.tone;
  return (
    <li className="flex flex-col gap-2 px-[var(--apppanel-pad)] py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="fp-strong">{part.label}</p>
          <p className="fp-small fp-muted">{actionLabel(part.action)} · part {part.partId}</p>
        </div>
        <Badge status={st} />
      </div>
      <MeterRow label={remainingText(part)} value={part.pctRemaining != null ? `${part.pctRemaining}%` : '—'}>
        <Progress value={part.pctRemaining ?? 0} label={`${part.label} life left`} tone={progressTone} />
      </MeterRow>
      {meta && <p className="fp-small fp-muted">{meta}</p>}
      {part.hint && <p className="fp-small">{part.hint}</p>}
    </li>
  );
}

interface Props {
  parts: RoombaPart[];
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}

function RoombaMaintenance({ parts, loading, error, onRetry, retrying }: Props) {
  const overdue = parts.filter((p) => p.status === 'overdue').length;
  const dueSoon = parts.filter((p) => p.status === 'due_soon').length;
  const counts = [overdue ? `${plural(overdue, 'part')} overdue` : null, dueSoon ? `${plural(dueSoon, 'part')} due soon` : null]
    .filter(Boolean)
    .join(', ');
  const summary = parts.length ? `${counts || 'Every part is within its service life'}. Life left in each part, worst first` : undefined;

  let body;
  if (loading && parts.length === 0) {
    body = <Loading label="Loading the robot's parts"><SkelRows count={3} /></Loading>;
  } else if (error && parts.length === 0) {
    body = <ErrorState compact title="Couldn't load the robot's parts" onRetry={onRetry} retrying={retrying} />;
  } else if (parts.length === 0) {
    body = (
      <EmptyState compact icon="tool" title="No maintenance data yet">
        The robot's part counters are read when it connects, shortly after each clean, and every few hours.
      </EmptyState>
    );
  } else {
    body = (
      <ul className="fp-list fp-list--cols">
        {sortParts(parts).map((p) => <PartItem key={p.partId} part={p} />)}
      </ul>
    );
  }

  return (
    <Panel
      title="Parts and upkeep"
      subtitle={summary}
      footer={<span className="fp-small fp-muted">After you replace or clean a part, mark it done in the iRobot app to reset its counter. The dock resets the bag counter itself.</span>}
    >
      {body}
    </Panel>
  );
}

export default memo(RoombaMaintenance);
