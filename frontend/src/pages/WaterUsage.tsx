import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import StatTile, { Icons } from '../components/StatTile';
import DeferredRender from '../components/DeferredRender';
import type { WaterBill } from '../types';
import { fetchWaterBills } from '../api/waterBills';

const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 } as const;
const TICK_PROPS = { fontSize: 11 } as const;
const CHART_THEME = {
  grid: 'var(--appchart-grid)',
  tick: 'var(--appchart-tick)',
} as const;
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--appchart-bg)',
  border: '1px solid var(--appchart-border)',
  borderRadius: '16px',
  fontSize: '13px',
  color: 'var(--apptext)',
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;
const TOOLTIP_LABEL_STYLE = { color: 'var(--apptext-muted)', marginBottom: 4 } as const;
const LEGEND_STYLE = { fontSize: 12 } as const;

const CHARGE_SERIES = [
  { key: 'water', label: 'Water', color: '#22d3ee' },
  { key: 'sewer', label: 'Sewer', color: '#0ea5e9' },
  { key: 'refuse', label: 'Refuse', color: '#6366f1' },
  { key: 'tax', label: 'Tax', color: '#a855f7' },
  { key: 'stormwater', label: 'Stormwater', color: '#14b8a6' },
] as const;

const money = (n?: number) => (n == null ? '—' : `$${n.toFixed(2)}`);

function periodLabel(bill: WaterBill) {
  return new Date(`${bill.billingPeriodStart}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  });
}

function EmptyChart({ title, emptyText }: { title: string; emptyText: string }) {
  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <h3 className="mb-4 text-xl font-semibold text-apptext">{title}</h3>
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
        {emptyText}
      </div>
    </div>
  );
}

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

  const latestBill = bills[0];
  const avgMonthlyBill = hasData ? bills.reduce((s, b) => s + b.totalDue, 0) / bills.length : 0;

  // Oldest -> newest for left-to-right chronological reading.
  const chronological = useMemo(() => [...bills].reverse(), [bills]);

  const usageChartData = useMemo(
    () =>
      chronological.map((bill) => ({
        period: periodLabel(bill),
        gallons: bill.usageThousands ?? 0,
      })),
    [chronological]
  );

  const chargesChartData = useMemo(
    () =>
      chronological.map((bill) => ({
        period: periodLabel(bill),
        water: bill.waterCharge ?? 0,
        sewer: bill.sewerCharge ?? 0,
        refuse: bill.refuseCharge ?? 0,
        tax: bill.taxCharge ?? 0,
        stormwater: bill.stormwaterCharge ?? 0,
      })),
    [chronological]
  );

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile
          label="Latest Bill"
          value={latestBill ? `$${latestBill.totalDue.toFixed(2)}` : '—'}
          unit=""
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Latest Usage"
          value={latestBill?.usageThousands != null ? latestBill.usageThousands.toFixed(0) : '—'}
          unit="gal"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Avg Monthly Bill"
          value={hasData ? `$${avgMonthlyBill.toFixed(2)}` : '—'}
          unit=""
          loading={loading}
          icon={Icons.Calendar}
        />
      </section>

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
          {!hasData && !loading ? (
            <EmptyChart
              title="Usage by billing period"
              emptyText='No water bills synced yet. Bills are pulled from the "Water Bill" Gmail label once a day.'
            />
          ) : (
            <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
              <h3 className="mb-4 text-xl font-semibold text-apptext">Usage by billing period</h3>
              <ResponsiveContainer width="100%" height={280} debounce={80}>
                <BarChart data={usageChartData} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="period" tick={{ fill: CHART_THEME.tick, ...TICK_PROPS }} axisLine={{ stroke: CHART_THEME.grid }} tickLine={false} />
                  <YAxis tick={{ fill: CHART_THEME.tick, ...TICK_PROPS }} axisLine={{ stroke: CHART_THEME.grid }} tickLine={false} unit=" gal" />
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(value: number) => [`${value.toFixed(0)} gal`, 'Usage']}
                  />
                  <Bar dataKey="gallons" fill="#22d3ee" radius={[10, 10, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </DeferredRender>
        <DeferredRender minHeight={360}>
          {!hasData && !loading ? (
            <EmptyChart
              title="Charges breakdown"
              emptyText="Itemized Water/Sewer/Refuse/Tax/Stormwater charges will appear here once a bill has been synced."
            />
          ) : (
            <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
              <h3 className="mb-4 text-xl font-semibold text-apptext">Charges breakdown</h3>
              <ResponsiveContainer width="100%" height={280} debounce={80}>
                <BarChart data={chargesChartData} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                  <XAxis dataKey="period" tick={{ fill: CHART_THEME.tick, ...TICK_PROPS }} axisLine={{ stroke: CHART_THEME.grid }} tickLine={false} />
                  <YAxis tick={{ fill: CHART_THEME.tick, ...TICK_PROPS }} axisLine={{ stroke: CHART_THEME.grid }} tickLine={false} unit="$" />
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name]}
                  />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  {CHARGE_SERIES.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} stackId="charges" fill={s.color} isAnimationActive={false} maxBarSize={48} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </DeferredRender>
      </section>

      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <h3 className="mb-2 text-xl font-semibold text-apptext">
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
                  <th className="py-2 pr-3 font-medium">Usage (gal)</th>
                  <th className="py-2 pr-3 font-medium">Water</th>
                  <th className="py-2 pr-3 font-medium">Sewer</th>
                  <th className="py-2 pr-3 font-medium">Refuse</th>
                  <th className="py-2 pr-3 font-medium">Tax</th>
                  <th className="py-2 pr-3 font-medium">Stormwater</th>
                  <th className="py-2 pr-3 font-medium">Discount</th>
                  <th className="py-2 pr-3 font-medium">Total Due</th>
                  <th className="py-2 pr-3 font-medium">Due Date</th>
                  <th className="py-2 font-medium">Bill</th>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
});
