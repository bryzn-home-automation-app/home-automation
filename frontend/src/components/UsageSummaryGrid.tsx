import { memo } from 'react';
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
    wxAvg?: number | null;
    wxHigh?: number | null;
    wxLow?: number | null;
  }>;
  loading?: boolean;
}

function UsageSummaryGrid({
  title,
  unitLabel,
  summaries,
  loading,
}: UsageSummaryGridProps) {
  return (
    <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Usage Insights
        </p>
        <h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {summaries.map(({ label, rangeStart, rangeEnd, summary, wxAvg, wxHigh, wxLow }) => (
          <div
            key={label}
            className="rounded-[24px] border border-appborder bg-appinset p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-apptext">{label}</h4>
                <p className="mt-1 text-xs text-apptext-dim">
                  {formatPeriodRange(rangeStart, rangeEnd)}
                </p>
              </div>
              <span className="text-xs text-apptext-dim text-right">
                {loading ? 'Loading...' : `${summary.readingCount} readings`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-appborder-light bg-appinset-strong p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-apptext-dim">Total</p>
                <p className="mt-2 text-lg font-semibold text-apptext">
                  {loading ? '...' : summary.totalKwh.toFixed(1)}
                  <span className="ml-1 text-sm text-apptext-muted">{unitLabel}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-appborder-light bg-appinset-strong p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-apptext-dim">Average</p>
                <p className="mt-2 text-lg font-semibold text-apptext">
                  {loading ? '...' : summary.averageKwh.toFixed(1)}
                  <span className="ml-1 text-sm text-apptext-muted">{unitLabel}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-300/55 bg-emerald-300/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-apptext-muted">Low</p>
                <p className="mt-2 text-base font-semibold text-apptext">
                  {loading || !summary.lowest ? '...' : `${summary.lowest.usageKwh.toFixed(1)} ${unitLabel}`}
                </p>
                <p className="mt-1 text-xs text-apptext-muted">
                  {loading ? '...' : formatSummaryDate(summary.lowest?.timestamp)}
                </p>
              </div>

              <div className="rounded-2xl border border-rose-300/55 bg-rose-300/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-apptext-muted">High</p>
                <p className="mt-2 text-base font-semibold text-apptext">
                  {loading || !summary.highest ? '...' : `${summary.highest.usageKwh.toFixed(1)} ${unitLabel}`}
                </p>
                <p className="mt-1 text-xs text-apptext-muted">
                  {loading ? '...' : formatSummaryDate(summary.highest?.timestamp)}
                </p>
              </div>
            </div>

            {(wxAvg != null || wxHigh != null || wxLow != null) && (
              <div className="mt-3 rounded-2xl border border-amber-300/50 bg-amber-300/28 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-apptext-muted">Temperature</p>
                <p className="mt-1 text-sm text-apptext-soft">
                  {wxAvg != null && `${wxAvg}° avg`}
                  {wxHigh != null && ` · ${wxHigh}° high`}
                  {wxLow != null && ` · ${wxLow}° low`}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default memo(UsageSummaryGrid);
