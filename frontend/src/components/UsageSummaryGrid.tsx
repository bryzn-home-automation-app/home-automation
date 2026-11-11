import { memo } from 'react';
import type { UsageRangeSummary } from '../types';
import { DASH, formatDateRange, formatNumber, formatShortDate, formatTemp, plural } from '../utils/format';
import { DataTable, Panel, QueryState, type Column, type QueryLike } from './ui';

export interface UsageSummaryRow {
  key: string;
  label: string;
  /** YYYY-MM-DD, or "Today" for an open end. */
  rangeStart: string;
  rangeEnd: string;
  summary: UsageRangeSummary;
  wxAvg?: number | null;
  wxHigh?: number | null;
  wxLow?: number | null;
}

interface UsageSummaryGridProps {
  unitLabel: string;
  summaries: UsageSummaryRow[];
  /** The summaries request, for its loading and error states. */
  query: QueryLike<unknown[]>;
}

/**
 * Highs and lows: each period's total, daily average, lowest and highest day, and the weather
 * over it. The server's summary is per day, so its count is days (B-085), and a period with
 * no readings shows a dash rather than "…" or 0 (B-083).
 */
function UsageSummaryGrid({ unitLabel, summaries, query }: UsageSummaryGridProps) {
  const val = (n: number) => <>{formatNumber(n, { decimals: 1, fixed: true })} <span className="fp-unit">{unitLabel}</span></>;
  const day = (point: UsageRangeSummary['lowest']) =>
    point ? <>{val(point.usageKwh)} <span className="fp-muted">{formatShortDate(point.timestamp.slice(0, 10))}</span></> : DASH;

  const columns: Column<UsageSummaryRow>[] = [
    {
      key: 'period',
      header: 'Period',
      kind: 'title',
      cell: (r) => (
        <>
          {r.label}
          <span className="fp-small fp-muted" style={{ display: 'block', fontWeight: 400 }}>
            {r.rangeEnd === 'Today'
              ? `${formatShortDate(r.rangeStart)} to today`
              : formatDateRange(r.rangeStart, r.rangeEnd)}
            {r.summary.readingCount > 0 && ` · ${plural(r.summary.readingCount, 'day')}`}
          </span>
        </>
      ),
    },
    { key: 'total', header: 'Total', kind: 'key', num: true, strong: true, cell: (r) => (r.summary.readingCount ? val(r.summary.totalKwh) : DASH) },
    { key: 'avg', header: 'Daily average', num: true, cell: (r) => (r.summary.readingCount ? val(r.summary.averageKwh) : DASH) },
    { key: 'low', header: 'Lowest day', cell: (r) => day(r.summary.lowest) },
    { key: 'high', header: 'Highest day', cell: (r) => day(r.summary.highest) },
    {
      key: 'wx',
      header: 'Outside, avg / high / low',
      cell: (r) =>
        r.wxAvg == null && r.wxHigh == null && r.wxLow == null ? (
          DASH
        ) : (
          <span className="fp-mono">{`${formatTemp(r.wxAvg)} / ${formatTemp(r.wxHigh)} / ${formatTemp(r.wxLow)}`}</span>
        ),
    },
  ];

  return (
    <Panel title="Highs and lows" subtitle="Totals and extremes for each period">
      <QueryState query={query} what="the period totals" isEmpty={() => false}>
        {() => <DataTable rowKey={(r) => r.key} rows={summaries} columns={columns} caption="Electric use by period" />}
      </QueryState>
    </Panel>
  );
}

export default memo(UsageSummaryGrid);
