import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCoservBills } from '../api/coservBills';

const money = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

/** Shared by the Electric and Gas tabs — both read the same coserv_bills row, each showing its own usage/charge column. */
export default memo(function CoservBillingHistory({ service }: { service: 'electric' | 'gas' }) {
  const coservBills = useQuery({
    queryKey: ['coserv-bills'],
    queryFn: fetchCoservBills,
    staleTime: 30_000,
  });

  const bills = useMemo(
    () =>
      [...(coservBills.data ?? [])].sort(
        (a, b) => new Date(b.billingPeriodStart).getTime() - new Date(a.billingPeriodStart).getTime()
      ),
    [coservBills.data]
  );
  const loading = coservBills.isLoading;
  const hasData = bills.length > 0;

  const usageLabel = service === 'electric' ? 'Usage (kWh)' : 'Usage (CCF)';
  const chargeLabel = service === 'electric' ? 'Electric Charge' : 'Gas Charge';

  return (
    <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <h3 className="mb-2 text-xl font-semibold text-apptext">Billing History</h3>
      {!hasData && !loading && (
        <p className="text-sm leading-6 text-apptext-muted">
          No CoServ bills synced yet. Bills are pulled from SmartHub Billing History once a day.
        </p>
      )}
      {hasData && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-appborder text-left text-apptext-muted">
                <th className="py-2 pr-3 font-medium">Period</th>
                <th className="py-2 pr-3 font-medium">{usageLabel}</th>
                <th className="py-2 pr-3 font-medium">{chargeLabel}</th>
                <th className="py-2 pr-3 font-medium">Total Due</th>
                <th className="py-2 pr-3 font-medium">Due Date</th>
                <th className="py-2 font-medium">Bill</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => {
                const usage = service === 'electric' ? bill.electricUsageKwh : bill.gasUsageCcf;
                const charge = service === 'electric' ? bill.electricCharge : bill.gasCharge;
                return (
                  <tr key={bill.id} className="border-b border-appborder/50 text-apptext">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {bill.billingPeriodStart} → {bill.billingPeriodEnd}
                    </td>
                    <td className="py-2 pr-3">{usage != null ? usage.toFixed(0) : '—'}</td>
                    <td className="py-2 pr-3">{money(charge)}</td>
                    <td className="py-2 pr-3 font-semibold">{money(bill.totalDue)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{bill.dueDate ?? '—'}</td>
                    <td className="py-2">
                      {bill.pdfPath ? (
                        <a
                          href={`/uploads/${bill.pdfPath}`}
                          download={bill.pdfPath.split('/').pop()}
                          className="text-appaccent-text underline decoration-appaccent-border underline-offset-2 hover:opacity-80"
                        >
                          View Bill
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
