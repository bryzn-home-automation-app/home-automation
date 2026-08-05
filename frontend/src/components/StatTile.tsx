interface StatTileProps {
  label: string;
  value: string;
  unit: string;
  trend?: { direction: 'up' | 'down'; pct: number };
  loading?: boolean;
  icon: React.ReactNode;
}

export default function StatTile({
  label,
  value,
  unit,
  trend,
  loading,
  icon,
}: StatTileProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 animate-pulse">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-gray-800" />
          <div className="h-4 w-20 bg-gray-800 rounded" />
        </div>
        <div className="h-8 w-28 bg-gray-800 rounded mb-1" />
        <div className="h-3 w-16 bg-gray-800 rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-emerald-950/50 border border-emerald-800/50 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-sm text-gray-400 font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-2xl font-bold text-white tracking-tight">
          {value}
        </span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
      {trend && (
        <span
          className={`text-xs font-medium ${
            trend.direction === 'down'
              ? 'text-emerald-400'
              : trend.direction === 'up'
              ? 'text-red-400'
              : 'text-gray-500'
          }`}
        >
          {trend.direction === 'down' ? '↓' : '↑'} {trend.pct}% vs last month
        </span>
      )}
    </div>
  );
}

/** SVG icons used in stat tiles. */
export const Icons = {
  Bolt: (
    <svg
      className="w-5 h-5 text-emerald-400"
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
      className="w-5 h-5 text-emerald-400"
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
      className="w-5 h-5 text-emerald-400"
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
