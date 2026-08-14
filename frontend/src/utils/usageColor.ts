// Shared badge helpers. Returns Tailwind class strings built from the
// raw -300/-200 shades defined in index.css. The theme block remaps those
// shades (300→500, 200→400) so the 10%/20% opacity backgrounds are
// actually visible on the light surface and the text is legible.

interface UsageBadge {
  textClass: string;
  badgeClass: string;
}

export function getUsageLevel(value: number): UsageBadge {
  if (value >= 50) {
    return {
      textClass: 'text-rose-300',
      badgeClass: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
    };
  }

  if (value >= 40) {
    return {
      textClass: 'text-amber-300',
      badgeClass: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
    };
  }

  if (value >= 30) {
    return {
      textClass: 'text-amber-300',
      badgeClass: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
    };
  }

  return {
    textClass: 'text-emerald-300',
    badgeClass: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
  };
}

// Log/event level badge — ERROR/WARN/INFO/other.
// Replaces inline maps in DebugDashboard and similar pages.
export function levelBadge(level: string): string {
  switch (level) {
    case 'ERROR':
      return 'border-rose-300/20 bg-rose-300/10 text-rose-200';
    case 'WARN':
      return 'border-amber-300/20 bg-amber-300/10 text-amber-200';
    case 'INFO':
      return 'border-sky-300/20 bg-sky-300/10 text-sky-200';
    default:
      return 'border-appborder bg-appinset text-apptext-soft';
  }
}

// Category badge for non-severity labels (sync, system, auth, etc.).
// Uses the slate tone for "no severity meaning".
export function categoryBadge(): string {
  return 'border-slate-300/20 bg-slate-300/10 text-slate-200';
}
