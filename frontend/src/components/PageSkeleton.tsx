import { memo } from 'react';

/**
 * PageSkeleton — shape-matched placeholder pages shown while a lazy chunk
 * is downloading. The visual language matches the existing loading states
 * in `StatTile.tsx` (lines 22-32) and `UsageChart.tsx` (lines 92-99):
 * rounded-[20-28px] cards, `bg-appinset` placeholder blocks, `animate-pulse`,
 * `border-appborder` / `bg-appsurface-raised` surfaces.
 */

export type PageSkeletonVariant =
  | 'stats-charts'
  | 'list'
  | 'form'
  | 'hero'
  | 'default';

interface PageSkeletonProps {
  variant: PageSkeletonVariant;
}

/** A small bar that renders as a placeholder line. */
function SkeletonBar({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-appinset ${className}`}
      aria-hidden
    />
  );
}

/** A "page header" — title block + small subtitle line. */
function PageHeaderSkeleton() {
  return (
    <div className="mb-6">
      <SkeletonBar className="h-7 w-48 sm:h-8" />
      <SkeletonBar className="mt-3 h-4 w-72" />
    </div>
  );
}

function StatsChartsSkeleton() {
  return (
    <div className="min-h-screen bg-appbg text-apptext">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeaderSkeleton />

        {/* 4 stat-tile grid — mirrors `StatTile` loading layout (icon + label + value + subtitle). */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-[20px] border border-appborder bg-appsurface-raised p-4 sm:rounded-[24px] sm:p-5"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-appinset sm:h-11 sm:w-11 sm:rounded-2xl" />
                <div className="h-4 w-24 rounded bg-appinset" />
              </div>
              <div className="mb-2 h-8 w-28 rounded bg-appinset" />
              <div className="h-3 w-16 rounded bg-appinset" />
            </div>
          ))}
        </div>

        {/* Chart panel — mirrors `UsageChart` loading card. */}
        <div className="mt-6 animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-5">
          <div className="mb-4 h-5 w-40 rounded bg-appinset" />
          <div className="h-72 rounded-2xl bg-appinset" />
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="min-h-screen bg-appbg text-apptext">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeaderSkeleton />

        {/* 6 row placeholders — mimics a list/table card. */}
        <div className="animate-pulse rounded-[24px] border border-appborder bg-appsurface-raised p-2 sm:p-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-appborder px-3 py-3 last:border-b-0"
            >
              <div className="h-9 w-9 shrink-0 rounded-xl bg-appinset" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 rounded bg-appinset" />
                <div className="h-3 w-1/3 rounded bg-appinset" />
              </div>
              <div className="h-6 w-16 rounded-full bg-appinset" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="min-h-screen bg-appbg text-apptext">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-12">
        <div className="w-full animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-6 shadow-[0_10px_30px_var(--appshadow)] sm:p-8">
          {/* Card title */}
          <div className="mx-auto mb-6 h-6 w-40 rounded bg-appinset" />
          <div className="mx-auto mb-8 h-3 w-56 rounded bg-appinset" />

          {/* 2 stacked input fields */}
          <div className="space-y-4">
            <div>
              <div className="mb-2 h-3 w-20 rounded bg-appinset" />
              <div className="h-11 w-full rounded-xl bg-appinset" />
            </div>
            <div>
              <div className="mb-2 h-3 w-24 rounded bg-appinset" />
              <div className="h-11 w-full rounded-xl bg-appinset" />
            </div>
          </div>

          {/* Submit button */}
          <div className="mt-6 h-11 w-full rounded-xl bg-appinset" />

          {/* Footer link */}
          <div className="mx-auto mt-6 h-3 w-44 rounded bg-appinset" />
        </div>
      </div>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="min-h-screen bg-appbg text-apptext">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Hero banner */}
        <div className="animate-pulse rounded-[28px] border border-appborder bg-appsurface-raised p-8 sm:p-12">
          <div className="mx-auto max-w-2xl space-y-5 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-appinset" />
            <div className="mx-auto h-8 w-72 rounded bg-appinset" />
            <div className="mx-auto h-4 w-96 rounded bg-appinset" />
            <div className="mx-auto h-4 w-80 rounded bg-appinset" />
            <div className="mx-auto mt-4 h-11 w-44 rounded-xl bg-appinset" />
          </div>
        </div>

        {/* Sub-cards under the hero */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-[24px] border border-appborder bg-appsurface-raised p-5"
            >
              <div className="mb-3 h-9 w-9 rounded-xl bg-appinset" />
              <div className="mb-2 h-4 w-3/4 rounded bg-appinset" />
              <div className="h-3 w-full rounded bg-appinset" />
              <div className="mt-2 h-3 w-5/6 rounded bg-appinset" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DefaultSkeleton() {
  return (
    <div className="min-h-screen bg-appbg text-apptext">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4">
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised px-6 py-5 text-sm text-apptext-soft shadow-[0_10px_30px_var(--appshadow)]">
          Loading...
        </div>
      </div>
    </div>
  );
}

function PageSkeleton({ variant }: PageSkeletonProps) {
  switch (variant) {
    case 'stats-charts':
      return <StatsChartsSkeleton />;
    case 'list':
      return <ListSkeleton />;
    case 'form':
      return <FormSkeleton />;
    case 'hero':
      return <HeroSkeleton />;
    case 'default':
    default:
      return <DefaultSkeleton />;
  }
}

export default memo(PageSkeleton);
