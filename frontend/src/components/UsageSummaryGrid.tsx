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

export default function UsageSummaryGrid({
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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

              <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/8 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/60">Low</p>
                <p className="mt-2 text-base font-semibold text-apptext">
                  {loading || !summary.lowest ? '...' : `${summary.lowest.usageKwh.toFixed(1)} ${unitLabel}`}
                </p>
                <p className="mt-1 text-xs text-apptext-muted">
                  {loading ? '...' : formatSummaryDate(summary.lowest?.timestamp)}
                </p>
              </div>

              <div className="rounded-2xl border border-rose-300/10 bg-rose-300/8 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-rose-100/60">High</p>
                <p className="mt-2 text-base font-semibold text-apptext">
                  {loading || !summary.highest ? '...' : `${summary.highest.usageKwh.toFixed(1)} ${unitLabel}`}
                </p>
                <p className="mt-1 text-xs text-apptext-muted">
                  {loading ? '...' : formatSummaryDate(summary.highest?.timestamp)}
                </p>
              </div>
            </div>

            {(wxAvg != null || wxHigh != null || wxLow != null) && (
              <div className="mt-3 rounded-2xl border border-amber-300/10 bg-amber-300/5 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-amber-100/60">Temperature</p>
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
