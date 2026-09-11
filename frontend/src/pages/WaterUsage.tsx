import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import type { EnergyUsage, WaterBill } from '../types';
import DeferredRender from '../components/DeferredRender';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import { buildUsagePeriods, summarizeUsageRange } from '../utils/usageSummary';
import WeatherContextCard from '../components/WeatherContextCard';
import Weather24HourCard from '../components/Weather24HourCard';
import { fetchWaterBills } from '../api/waterBills';

/** Map itemized water bills (one row/billing period) into the EnergyUsage shape
 *  the shared chart/summary components expect, so those components don't need
 *  a water-specific variant. `usageKwh` carries `usageThousands`; `cost` carries
 *  `totalDue`. */
function billsToUsageRecords(bills: WaterBill[]): EnergyUsage[] {
  return bills.map((bill) => ({
    id: bill.id,
    meterId: 99,
    timestamp: bill.billingDate ?? bill.billingPeriodEnd,
    usageKwh: bill.usageThousands ?? 0,
    cost: bill.totalDue,
    source: bill.source,
    sourceProvider: bill.sourceProvider,
    ingestionBatchId: bill.ingestionBatchId,
    processingVersion: bill.processingVersion,
    createdAt: bill.createdAt,
  }));
}

const money = (n?: number) => (n == null ? '—' : `$${n.toFixed(2)}`);

export default memo(function WaterUsage() {
  const waterBills = useQuery({
    queryKey: ['water-bills'],
    queryFn: fetchWaterBills,
    staleTime: 30_000,
  });

  const bills = useMemo(
    () =>
      [...(waterBills.data ?? [])].sort(
        (a, b) => new Date(b.billingPeriodStart).getTime() - new Date(a.billingPeriodStart).getTime()
      ),
    [waterBills.data]
  );
  const loading = waterBills.isLoading;
  const hasData = bills.length > 0;

  const data = useMemo(() => billsToUsageRecords(bills), [bills]);

  const latestBill = bills[0];
  const avgMonthlyBill = hasData ? bills.reduce((s, b) => s + b.totalDue, 0) / bills.length : 0;

  const periodDefinitions = useMemo(
    () => buildUsagePeriods(bills[bills.length - 1]?.billingPeriodStart),
    [bills]
  );

  const summaryCards = useMemo(
    () =>
      periodDefinitions.map((period) => ({
        label: period.label,
        rangeStart: period.displayStart,
        rangeEnd: period.displayEnd,
        summary: summarizeUsageRange(99, data, period.start, period.end),
      })),
    [data, periodDefinitions]
  );

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile
          label="Latest Bill"
          value={latestBill ? latestBill.totalDue.toFixed(2) : '—'}
          unit="$"
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Latest Usage"
          value={latestBill?.usageThousands != null ? latestBill.usageThousands.toFixed(0) : '—'}
          unit="gal (×1k)"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Avg Monthly Bill"
          value={hasData ? avgMonthlyBill.toFixed(2) : '—'}
          unit="$"
          loading={loading}
          icon={Icons.Calendar}
        />
      </section>

      {/* Weather Context */}
      {periodDefinitions.length > 0 && (
        <WeatherContextCard
          startDate={periodDefinitions[0].start}
          endDate={periodDefinitions[0].end}
          showPrecipitation
        />
      )}

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
          <UsageChart
            data={data}
            loading={loading}
            title="Water usage trend"
            emptyText="Water usage data will appear here once a bill has been synced from Gmail."
            unitLabel="gal (×1k)"
            accentColor="#22d3ee"
          />
        </DeferredRender>
        <DeferredRender minHeight={360}>
          <MonthlyComparison
            data={data}
            loading={loading}
            title="Monthly water comparison"
            emptyText="Monthly water comparisons need more billing history."
            unitLabel="gal (×1k)"
            barColor="#06b6d4"
          />
        </DeferredRender>
      </section>

      {/* 24-Hour Weather Detail */}
      {periodDefinitions.length > 0 && (
        <Weather24HourCard
          startDate={periodDefinitions[0].start}
          endDate={periodDefinitions[0].end}
        />
      )}

      <UsageSummaryGrid
        title="Water highs, lows, and rolling period totals"
        unitLabel="gal (×1k)"
        summaries={summaryCards}
      />

      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <h3 className="mb-2 text-lg font-semibold text-apptext">
          Billing History
        </h3>
        {!hasData && !loading && (
          <p className="text-sm leading-6 text-apptext-muted">
            No water bills synced yet. Bills are pulled from the "Water Bill" Gmail
            label once a day.
          </p>
        )}
        {hasData && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-appborder text-left text-apptext-muted">
                  <th className="py-2 pr-3 font-medium">Period</th>
                  <th className="py-2 pr-3 font-medium">Usage (gal ×1k)</th>
                  <th className="py-2 pr-3 font-medium">Water</th>
                  <th className="py-2 pr-3 font-medium">Sewer</th>
                  <th className="py-2 pr-3 font-medium">Refuse</th>
                  <th className="py-2 pr-3 font-medium">Tax</th>
                  <th className="py-2 pr-3 font-medium">Stormwater</th>
                  <th className="py-2 pr-3 font-medium">Discount</th>
                  <th className="py-2 pr-3 font-medium">Total Due</th>
                  <th className="py-2 font-medium">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-b border-appborder/50 text-apptext">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {bill.billingPeriodStart} → {bill.billingPeriodEnd}
                    </td>
                    <td className="py-2 pr-3">{bill.usageThousands?.toFixed(0) ?? '—'}</td>
                    <td className="py-2 pr-3">{money(bill.waterCharge)}</td>
                    <td className="py-2 pr-3">{money(bill.sewerCharge)}</td>
                    <td className="py-2 pr-3">{money(bill.refuseCharge)}</td>
                    <td className="py-2 pr-3">{money(bill.taxCharge)}</td>
                    <td className="py-2 pr-3">{money(bill.stormwaterCharge)}</td>
                    <td className="py-2 pr-3">{bill.achDiscount != null ? money(bill.achDiscount) : '—'}</td>
                    <td className="py-2 pr-3 font-semibold">{money(bill.totalDue)}</td>
                    <td className="py-2 whitespace-nowrap">{bill.dueDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
});
