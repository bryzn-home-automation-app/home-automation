import type { ChangeType, ReleaseChange } from '../api/releases';
import { Badge, type IconName } from './ui';

/** The three kinds, in the order a release reads best: what's new first. */
const KINDS: { type: ChangeType; label: string; icon: IconName }[] = [
  { type: 'new', label: 'New', icon: 'sparkles' },
  { type: 'improved', label: 'Improved', icon: 'arrow-up' },
  { type: 'fixed', label: 'Fixed', icon: 'check' },
];

/** Changes of each kind, known kinds first and anything the backend adds later after them. */
export function groupChanges(changes: readonly ReleaseChange[]): { type: string; label: string; icon: IconName; items: ReleaseChange[] }[] {
  const groups = KINDS.map((k) => ({ ...k, items: changes.filter((c) => c.type === k.type) as ReleaseChange[] }));
  const other = changes.filter((c) => !KINDS.some((k) => k.type === c.type));
  const extra = [...new Set(other.map((c) => c.type))].map((t) => ({
    type: t,
    label: t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other',
    icon: 'info' as IconName,
    items: other.filter((c) => c.type === t),
  }));
  return [...groups, ...extra].filter((g) => g.items.length > 0);
}

/**
 * A release's changes grouped New / Improved / Fixed: a plain badge per kind (a word and an
 * icon, never colour alone) beside its sentences. Used by What's new and the What's new dialog.
 */
export default function ReleaseChangeList({ changes }: { changes: ReleaseChange[] }) {
  return (
    <div className="flex flex-col">
      {groupChanges(changes).map((g, i) => (
        <section
          key={g.type}
          aria-label={`${g.label}, ${g.items.length}`}
          className={`grid grid-cols-1 gap-x-4 sm:grid-cols-[112px_minmax(0,1fr)] ${i > 0 ? 'mt-3 border-t border-appborder pt-3' : ''}`}
        >
          <p className="flex min-h-[28px] items-center gap-2 self-start sm:mt-2.5">
            <Badge plain ink={g.type === 'new'} icon={g.icon}>{g.label}</Badge>
            <span className="fp-mono text-xs text-apptext-muted" aria-hidden="true">{g.items.length}</span>
          </p>
          <ul className="fp-list">
            {g.items.map((c, j) => (
              <li key={j}>
                <div className="fp-row fp-row--compact">
                  <span className="fp-row-main">
                    <span className="fp-row-title fp-row-title--regular break-words leading-snug">{c.text}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
