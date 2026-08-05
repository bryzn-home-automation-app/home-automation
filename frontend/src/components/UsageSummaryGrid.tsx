import type { UsageRangeSummary } from '../types';
import { formatPeriodRange, formatSummaryDate } from '../utils/usageSummary';

interface UsageSummaryGridProps {
  title: string;
  unitLabel: string;
  summaries: Array<{
    label: string;
    rangeStart: string;
    rangeEnd: string;
    summary: UsageRangeSummary;
  }>;
  loading?: boolean;
}

export default function UsageSummaryGrid({
  title,
  unitLabel,
  summaries,
  loading,
}: UsageSummaryGridProps) {
  return (
    <section className="perf-section rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
      <div className="mb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          Usage Insights
        </p>
        <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {summaries.map(({ label, rangeStart, rangeEnd, summary }) => (
          <div
            key={label}
            className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white">{label}</h4>
                <p className="mt-1 text-xs text-slate-500">
                  {formatPeriodRange(rangeStart, rangeEnd)}
                </p>
              </div>
              <span className="text-xs text-slate-500 text-right">
                {loading ? 'Loading...' : `${summary.readingCount} readings`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/8 bg-slate-950/45 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Total</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {loading ? '...' : summary.totalKwh.toFixed(1)}
                  <span className="ml-1 text-sm text-slate-400">{unitLabel}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-slate-950/45 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Average</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {loading ? '...' : summary.averageKwh.toFixed(1)}
                  <span className="ml-1 text-sm text-slate-400">{unitLabel}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/8 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/60">Low</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {loading || !summary.lowest ? '...' : `${summary.lowest.usageKwh.toFixed(1)} ${unitLabel}`}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {loading ? '...' : formatSummaryDate(summary.lowest?.timestamp)}
                </p>
              </div>

              <div className="rounded-2xl border border-rose-300/10 bg-rose-300/8 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-rose-100/60">High</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {loading || !summary.highest ? '...' : `${summary.highest.usageKwh.toFixed(1)} ${unitLabel}`}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {loading ? '...' : formatSummaryDate(summary.highest?.timestamp)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}