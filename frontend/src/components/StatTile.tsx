import { memo } from 'react';

interface StatTileProps {
  label: string;
  value: string;
  unit: string;
  trend?: { direction: 'up' | 'down'; pct: number };
  loading?: boolean;
  icon: React.ReactNode;
}

function StatTile({
  label,
  value,
  unit,
  trend,
  loading,
  icon,
}: StatTileProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-[24px] border border-appborder bg-appsurface-raised p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-appinset" />
          <div className="h-4 w-24 rounded bg-appinset" />
        </div>
        <div className="mb-2 h-8 w-28 rounded bg-appinset" />
        <div className="h-3 w-16 rounded bg-appinset" />
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-appborder bg-appsurface-raised p-5 shadow-[0_8px_24px_var(--appshadow)] transition-colors hover:border-appborder-hover hover:bg-appinset-strong">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft">
          {icon}
        </div>
        <span className="text-sm font-medium text-apptext-soft">{label}</span>
      </div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-[-0.04em] text-apptext">
          {value}
        </span>
        <span className="text-sm text-apptext-muted">{unit}</span>
      </div>
      {trend && (
        <span
          className={`text-xs font-medium ${
            trend.direction === 'down'
              ? 'text-appsuccess'
              : trend.direction === 'up'
              ? 'text-appdanger'
              : 'text-apptext-dim'
          }`}
        >
          {trend.direction === 'down' ? '↓' : '↑'} {trend.pct}% vs last month
        </span>
      )}
    </div>
  );
}

export default memo(StatTile);

/** SVG icons used in stat tiles. */
export const Icons = {
  Bolt: (
    <svg
      className="h-5 w-5 text-appaccent-text"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  ),
  Calendar: (
    <svg
      className="h-5 w-5 text-appaccent-text"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  ),
  Dollar: (
    <svg
      className="h-5 w-5 text-appaccent-text"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};
