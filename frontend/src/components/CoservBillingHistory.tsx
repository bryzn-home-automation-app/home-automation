import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCoservBills } from '../api/coservBills';
import type { CoservBill } from '../types';
import { DASH, formatDate, formatDateRange, formatMoney, formatNumber } from '../utils/format';
import { Button, DataTable, EmptyState, Panel, QueryState, ShowMore, type Column } from './ui';

// The viewer pulls in react-pdf and its pdf.js worker; load it only when a bill is opened.
const BillPdfModal = lazy(() => import('./BillPdfModal'));

/**
 * The Bills panel, shared by the Electric and Gas views: both read the same CoServ
 * statements, each with its own usage and charge, plus the statement total under its own
 * name, so the whole bill is never read as the gas bill (B-016).
 */
export default memo(function CoservBillingHistory({ service }: { service: 'electric' | 'gas' }) {
  const coservBills = useQuery({ queryKey: ['coserv-bills'], queryFn: fetchCoservBills, staleTime: 30_000 });
  const [viewing, setViewing] = useState<CoservBill | null>(null);

  const electric = service === 'electric';
  const columns = useMemo<Column<CoservBill>[]>(
    () => [
      { key: 'period', header: 'Period', kind: 'title', cell: (b) => formatDateRange(b.billingPeriodStart, b.billingPeriodEnd) },
      {
        key: 'used',
        header: 'Used',
        num: true,
        cell: (b) => {
          const used = electric ? b.electricUsageKwh : b.gasUsageCcf;
          return used == null ? DASH : <>{formatNumber(used)} <span className="fp-unit">{electric ? 'kWh' : 'CCF'}</span></>;
        },
      },
      {
        key: 'charge',
        header: electric ? 'Electric' : 'Gas',
        kind: 'key',
        num: true,
        strong: true,
        cell: (b) => formatMoney(electric ? b.electricCharge : b.gasCharge),
      },
      { key: 'total', header: 'Statement total', num: true, cell: (b) => formatMoney(b.totalDue) },
      { key: 'due', header: 'Due', cell: (b) => formatDate(b.dueDate) },
      {
        key: 'bill',
        header: 'Bill',
        hideHeader: true,
        kind: 'action',
        cell: (b) =>
          b.pdfPath ? (
            <Button size="sm" icon="file" onClick={() => setViewing(b)}>View bill</Button>
          ) : (
            <span className="fp-small fp-muted">No PDF</span>
          ),
      },
    ],
    [electric]
  );

  const bills = useMemo(
    () => [...(coservBills.data ?? [])].sort((a, b) => b.billingPeriodStart.localeCompare(a.billingPeriodStart)),
    [coservBills.data]
  );

  return (
    <Panel
      title="Bills"
      subtitle={electric ? 'Each CoServ statement covers electric and gas. Pulled from SmartHub once a day' : 'The gas part of each CoServ statement'}
    >
      <QueryState
        query={coservBills}
        what="the bills"
        empty={
          <EmptyState icon="receipt" title="No CoServ bills yet" compact>
            Bills are pulled from SmartHub once a day and show here the day after they arrive.
          </EmptyState>
        }
      >
        {() => (
          <ShowMore
            items={bills}
            first={6}
            noun="bills"
            render={(part) => (
              <DataTable rowKey={(b) => b.id} rows={part} columns={columns} caption={electric ? 'Electric bills' : 'Gas bills'} />
            )}
          />
        )}
      </QueryState>
      {viewing?.pdfPath && (
        <Suspense fallback={null}>
          <BillPdfModal
            pdfPath={viewing.pdfPath}
            title={`CoServ statement, ${formatDateRange(viewing.billingPeriodStart, viewing.billingPeriodEnd)}`}
            subtitle={`Electric and gas${viewing.dueDate ? ` · due ${formatDate(viewing.dueDate)}` : ''}`}
            onClose={() => setViewing(null)}
          />
        </Suspense>
      )}
    </Panel>
  );
});
