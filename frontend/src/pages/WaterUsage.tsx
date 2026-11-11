import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import DeferredRender from '../components/DeferredRender';
import type { WaterBill } from '../types';
import { fetchWaterBills } from '../api/waterBills';
import { usePageMeta } from '../components/shell/PageMeta';
import {
  DASH,
  daysBetween,
  formatDate,
  formatDateRange,
  formatMoney,
  formatMonthYear,
  formatNumber,
  formatTime,
  homeToday,
  plural,
} from '../utils/format';
import type { Tone } from '../utils/status';
import { Button, ChartLegend, DataTable, Dial, DialCentre, DialLegend, EmptyState, InstrumentPanel, Num, Panel, QueryState, Readout, Readouts, ShowMore, SkelInstrumentPanel, Split, TooltipCard, TooltipLine, useChartTheme, Verdict, type ChartTone, type Column } from '../components/ui';
import { DEFERRED_CHART, niceTicks } from './utility/parts';

// BillPdfModal pulls in react-pdf + its ~1.3MB pdf.js worker. It's only
// mounted when someone opens a bill, so keep that weight out of this chunk.
const BillPdfModal = lazy(() => import('../components/BillPdfModal'));

const MARGIN = { top: 18, right: 8, left: 0, bottom: 0 } as const;

const CHARGES = [
  { key: 'water', field: 'waterCharge', label: 'Water', tone: 'water' },
  { key: 'sewer', field: 'sewerCharge', label: 'Sewer', tone: 'ink' },
  { key: 'refuse', field: 'refuseCharge', label: 'Refuse', tone: 'graphite' },
  { key: 'stormwater', field: 'stormwaterCharge', label: 'Stormwater', tone: 'cool' },
  { key: 'tax', field: 'taxCharge', label: 'Tax', tone: 'soft' },
] as const satisfies ReadonlyArray<{ key: string; field: keyof WaterBill; label: string; tone: ChartTone }>;

/** Due within this many days: a heads-up. */
const DUE_SOON_DAYS = 3;

/** A bill goes by the month its period ends, like the gas bills ("Aug ’26", B-098). */
const billLabel = (b: WaterBill) => formatMonthYear(b.billingPeriodEnd);
const gallons = (n: number | null | undefined) => formatNumber(n, { unit: 'gal' });

interface ChartRow {
  id: number;
  label: string;
  bill: WaterBill;
  gallons: number;
  water: number;
  sewer: number;
  refuse: number;
  stormwater: number;
  tax: number;
}

function WaterTooltip({ active, payload, money }: { active?: boolean; payload?: { payload: ChartRow }[]; money?: boolean }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <TooltipCard title={`${row.label} bill · ${formatDateRange(row.bill.billingPeriodStart, row.bill.billingPeriodEnd)}`}>
      {money ? (
        <>
          {CHARGES.map((c) => <TooltipLine key={c.key} label={c.label} value={formatMoney(row.bill[c.field])} />)}
          {row.bill.achDiscount != null && <TooltipLine label="Autopay discount" value={formatMoney(row.bill.achDiscount)} />}
          <TooltipLine strong label="Total" value={formatMoney(row.bill.totalDue)} />
        </>
      ) : (
        <TooltipLine label="Used" value={gallons(row.gallons)} />
      )}
    </TooltipCard>
  );
}

/** The ring: the latest bill's five charges round the dial, the total in the centre. */
function WaterDial({ bill }: { bill: WaterBill }) {
  const parts = CHARGES.map((c) => ({ ...c, value: bill[c.field] ?? 0 })).filter((p) => p.value > 0);
  const sum = parts.reduce((s, p) => s + p.value, 0);
  let at = 0;
  const segments = parts.map((p) => {
    const from = at;
    at += p.value;
    return { from, to: at, tone: p.tone as ChartTone };
  });
  return (
    <>
      <Dial
        start={0}
        sweep={360}
        label={`Latest water bill ${formatMoney(bill.totalDue)}: ${parts.map((p) => `${p.label} ${formatMoney(p.value)}`).join(', ')}.`}
        rings={[{ r: 88, w: 16, min: 0, max: sum || 1, gap: 1.6, ticks: 40, major: 10, segments }]}
      >
        <DialCentre label="Latest bill" note={bill.dueDate ? `Due ${formatDate(bill.dueDate)}` : undefined} noteMono>
          <Num size="xl" value={formatMoney(bill.totalDue)} />
        </DialCentre>
      </Dial>
      <DialLegend items={parts.map((p) => ({ label: p.label, value: formatMoney(p.value), tone: p.tone, key: 'box' as const }))} />
    </>
  );
}

function WaterVerdict({ bill, average, count }: { bill: WaterBill; average: number; count: number }) {
  const today = homeToday();
  const left = bill.dueDate ? daysBetween(today, bill.dueDate) : null;
  const tone: Tone = left == null ? 'info' : left < 0 ? 'neutral' : left <= DUE_SOON_DAYS ? 'headsup' : 'ok';
  const sentence =
    left == null
      ? `The latest water bill is ${formatMoney(bill.totalDue)}.`
      : left < 0
        ? `${formatMoney(bill.totalDue)} was due ${formatDate(bill.dueDate)}.`
        : left === 0
          ? `${formatMoney(bill.totalDue)} is due today.`
          : `${formatMoney(bill.totalDue)} is due ${formatDate(bill.dueDate)}.`;
  const diff = bill.totalDue - average;
  const compare =
    count < 2
      ? null
      : Math.abs(diff) < 1
        ? `That's about your ${formatMoney(average)} average.`
        : `That's ${diff < 0 ? 'below' : 'above'} your ${formatMoney(average)} average.`;
  const used =
    bill.usageThousands != null
      ? `You used ${gallons(bill.usageThousands)} from ${formatDateRange(bill.billingPeriodStart, bill.billingPeriodEnd)}.`
      : null;
  return (
    <Verdict tone={tone} note={[compare, used].filter(Boolean).join(' ') || undefined}>
      {sentence}
    </Verdict>
  );
}

export default memo(function WaterUsage() {
  const t = useChartTheme();
  const waterBills = useQuery({ queryKey: ['water-bills'], queryFn: fetchWaterBills, staleTime: 30_000 });
  const [viewing, setViewing] = useState<WaterBill | null>(null);

  usePageMeta({ subtitle: waterBills.dataUpdatedAt ? `Updated ${formatTime(waterBills.dataUpdatedAt)}` : undefined });

  // Newest first for the table and the answer.
  const bills = useMemo(
    () => [...(waterBills.data ?? [])].sort((a, b) => b.billingPeriodStart.localeCompare(a.billingPeriodStart)),
    [waterBills.data]
  );
  const latest = bills[0];
  const average = bills.length ? bills.reduce((s, b) => s + b.totalDue, 0) / bills.length : 0;

  // Oldest -> newest for left-to-right reading.
  const chartRows = useMemo<ChartRow[]>(
    () =>
      [...bills].reverse().map((b) => ({
        id: b.id,
        label: billLabel(b),
        bill: b,
        gallons: b.usageThousands ?? 0,
        water: b.waterCharge ?? 0,
        sewer: b.sewerCharge ?? 0,
        refuse: b.refuseCharge ?? 0,
        stormwater: b.stormwaterCharge ?? 0,
        tax: b.taxCharge ?? 0,
      })),
    [bills]
  );

  const galTicks = useMemo(() => niceTicks(chartRows.map((r) => r.gallons * 1.08), { floorZero: true }), [chartRows]);

  const columns: Column<WaterBill>[] = [
    { key: 'period', header: 'Period', kind: 'title', cell: (b) => formatDateRange(b.billingPeriodStart, b.billingPeriodEnd) },
    { key: 'used', header: 'Used', num: true, cell: (b) => (b.usageThousands == null ? DASH : <>{formatNumber(b.usageThousands)} <span className="fp-unit">gal</span></>) },
    ...CHARGES.map((c): Column<WaterBill> => ({ key: c.key, header: c.label, num: true, cell: (b) => formatMoney(b[c.field]) })),
    // A discount is negative and reads "−$1.50" (B-095).
    { key: 'discount', header: 'Discount', num: true, cell: (b) => formatMoney(b.achDiscount) },
    { key: 'total', header: 'Total', kind: 'key', num: true, strong: true, cell: (b) => formatMoney(b.totalDue) },
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
  ];

  const empty = (
    <EmptyState icon="droplet" title="No water bills yet">
      Bills are read from the &ldquo;Water Bill&rdquo; label in Gmail once a day and show here the day after they arrive.
    </EmptyState>
  );

  return (
    <>
      <QueryState query={waterBills} what="the water bills" loading={<SkelInstrumentPanel readouts={3} />} empty={empty}>
        {() => {
          const left = latest.dueDate ? daysBetween(homeToday(), latest.dueDate) : null;
          return (
            <InstrumentPanel
              instrument={<WaterDial bill={latest} />}
              verdict={<WaterVerdict bill={latest} average={average} count={bills.length} />}
              readouts={
                <Readouts>
                  <Readout
                    label="Used"
                    value={latest.usageThousands != null ? formatNumber(latest.usageThousands) : DASH}
                    unit="gal"
                    note={(() => {
                      const days = daysBetween(latest.billingPeriodStart, latest.billingPeriodEnd);
                      return latest.usageThousands != null && days ? `About ${formatNumber(latest.usageThousands / days)} a day` : undefined;
                    })()}
                  />
                  <Readout label="Average bill" value={formatMoney(average)} note={`Over the last ${plural(bills.length, 'bill')}`} />
                  <Readout
                    label={left != null && left < 0 ? 'Was due' : 'Due in'}
                    value={left == null ? DASH : left < 0 ? formatNumber(-left) : formatNumber(left)}
                    unit={left == null ? undefined : Math.abs(left) === 1 ? 'day' : 'days'}
                    note={
                      left != null && left < 0
                        ? 'ago'
                        : latest.achDiscount != null && latest.achDiscount < 0
                          ? `Autopay takes off ${formatMoney(Math.abs(latest.achDiscount))}`
                          : latest.dueDate
                            ? formatDate(latest.dueDate)
                            : undefined
                    }
                  />
                </Readouts>
              }
            />
          );
        }}
      </QueryState>

      {latest && (
        <Split ratio="even">
          <DeferredRender placeholder={DEFERRED_CHART}>
            <Panel title="Use per bill" subtitle="Gallons for each billing period, by the month it ended">
              <ResponsiveContainer width="100%" height={220} debounce={80}>
                <BarChart data={chartRows} margin={MARGIN}>
                  <CartesianGrid {...t.grid} />
                  <XAxis dataKey="label" {...t.axis} interval={0} />
                  {/* A formatter, not Recharts' `unit`, so the axis reads "12k", not "12000 / gal" (B-097). */}
                  <YAxis {...t.axis} width={40} ticks={galTicks} domain={galTicks ? [0, galTicks[galTicks.length - 1]] : undefined} tickFormatter={(v: number) => (v >= 1000 ? `${formatNumber(v / 1000)}k` : formatNumber(v))} />
                  <Tooltip content={<WaterTooltip />} cursor={t.barCursor} wrapperStyle={t.tooltip.wrapperStyle} />
                  <Bar dataKey="gallons" name="Used" fill={t.series.water} radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
                    <LabelList dataKey="gallons" position="top" formatter={(v: number) => formatNumber(v)} style={{ fill: t.axis.tick.fill, fontSize: 11, fontFamily: t.axis.tick.fontFamily }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </DeferredRender>
          <DeferredRender placeholder={DEFERRED_CHART}>
            <Panel title="Charges per bill" subtitle="Before the autopay discount">
              <div className="fp-stack fp-stack--s">
                {/* Neutral legend words in both themes; the swatch carries the colour (B-096). */}
                <ChartLegend items={CHARGES.map((c) => ({ label: c.label, tone: c.tone, key: 'box' as const }))} />
                <ResponsiveContainer width="100%" height={220} debounce={80}>
                  <BarChart data={chartRows} margin={MARGIN}>
                    <CartesianGrid {...t.grid} />
                    <XAxis dataKey="label" {...t.axis} interval={0} />
                    <YAxis {...t.axis} width={44} tickFormatter={(v: number) => formatMoney(v, { cents: false })} />
                    <Tooltip content={<WaterTooltip money />} cursor={t.barCursor} wrapperStyle={t.tooltip.wrapperStyle} />
                    {CHARGES.map((c) => (
                      <Bar key={c.key} dataKey={c.key} name={c.label} stackId="charges" fill={t.series[c.tone]} maxBarSize={48} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </DeferredRender>
        </Split>
      )}

      {latest && (
        <Panel title="Bills" subtitle="From the “Water Bill” label in Gmail, checked once a day">
          <ShowMore
            items={bills}
            first={6}
            noun="bills"
            render={(part) => <DataTable rowKey={(b) => b.id} rows={part} columns={columns} caption="Water bills" />}
          />
        </Panel>
      )}

      {viewing?.pdfPath && (
        <Suspense fallback={null}>
          <BillPdfModal
            pdfPath={viewing.pdfPath}
            title={`Water bill, ${formatDateRange(viewing.billingPeriodStart, viewing.billingPeriodEnd)}`}
            subtitle={viewing.dueDate ? `City utilities · due ${formatDate(viewing.dueDate)}` : 'City utilities'}
            onClose={() => setViewing(null)}
          />
        </Suspense>
      )}
    </>
  );
});
