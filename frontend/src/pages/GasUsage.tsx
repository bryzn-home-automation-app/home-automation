import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CoservBillingHistory from '../components/CoservBillingHistory';
import DeferredRender from '../components/DeferredRender';
import { fetchCoservBills } from '../api/coservBills';
import { fetchWeatherForRange } from '../api/weather';
import { usePageMeta } from '../components/shell/PageMeta';
import type { GasLineItem } from '../types';
import { cycleTemperature, gasCycles, gasPricing, nextGasBill, type GasCycle } from '../utils/gasBills';
import {
  DASH,
  formatDate,
  formatDateRange,
  formatMoney,
  formatMonthYear,
  formatNumber,
  formatShortDate,
  formatTemp,
  formatTime,
  homeToday,
} from '../utils/format';
import { ChartLegend, Dial, DialCentre, DialLegend, EmptyState, InstrumentPanel, KeyValue, KV, Notice, Num, Panel, QueryState, Readout, Readouts, SkelInstrumentPanel, Split, toneColor, TooltipCard, TooltipLine, useChartTheme, Verdict, type ChartTone } from '../components/ui';
import { DEFERRED_CHART } from './utility/parts';

const MARGIN = { top: 12, right: 8, left: 0, bottom: 0 } as const;

const KINDS = [
  { key: 'fixed', label: 'Flat charges', tone: 'ink' },
  { key: 'usage', label: 'Gas used', tone: 'gas' },
  { key: 'taxes', label: 'Taxes and city fee', tone: 'soft' },
] as const satisfies ReadonlyArray<{ key: keyof NonNullable<GasCycle['split']>; label: string; tone: ChartTone }>;

const perDay = (n: number) => formatNumber(n, { decimals: 2, fixed: true });
const period = (c: GasCycle) => formatDateRange(c.start, c.end);

/**
 * A unit rate as CoServ prints it: at least two decimals, more when the tariff has them
 * ("$1.30", not "$1.3"; "$0.1401" stays). B-092.
 */
export function formatUnitRate(rate: number): string {
  const printed = (String(rate).split('.')[1] ?? '').length;
  return `$${formatNumber(rate, { decimals: Math.max(2, printed), fixed: true })}`;
}

interface Row {
  label: string;
  cycle: GasCycle;
  ccf: number;
  temp: number | null;
  fixed: number;
  usage: number;
  taxes: number;
  unitemized: number;
}

function GasTooltip({ active, payload, money }: { active?: boolean; payload?: { payload: Row }[]; money?: boolean }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const { cycle } = row;
  return (
    <TooltipCard title={`${row.label} bill · ${period(cycle)}`}>
      {money ? (
        cycle.split ? (
          <>
            {KINDS.map((k) => <TooltipLine key={k.key} label={k.label} value={formatMoney(cycle.split![k.key])} />)}
            <TooltipLine strong label="Gas total" value={formatMoney(cycle.charge)} />
          </>
        ) : (
          <TooltipLine label="Gas total (not itemized)" value={formatMoney(cycle.charge)} />
        )
      ) : (
        <>
          <TooltipLine label="Used" value={formatNumber(cycle.ccf, { unit: 'CCF' })} />
          <TooltipLine label="A day" value={formatNumber(cycle.perDay, { decimals: 2, fixed: true, unit: 'CCF' })} />
          {row.temp != null && <TooltipLine label="Outside, average" value={formatTemp(row.temp)} />}
        </>
      )}
    </TooltipCard>
  );
}

/** The last bill's gas lines, grouped the way the dial splits them, and what gas really costs. */
function LastBill({ cycle }: { cycle: GasCycle }) {
  const items = cycle.items ?? [];
  const pricing = gasPricing(cycle);
  const describe = (item: GasLineItem) =>
    item.ccf != null && item.rate != null ? ` · ${formatNumber(item.ccf)} CCF × ${formatUnitRate(item.rate)}` : '';
  return (
    <Panel title="What the last gas bill paid for" subtitle={`${period(cycle)}, ${formatNumber(cycle.ccf, { unit: 'CCF' })}`}>
      <Split ratio="even">
        <KeyValue>
          {KINDS.map((k) => {
            const lines = items.filter((i) => i.kind === k.key);
            if (!lines.length) return null;
            return [
              <KV key={k.key} kind="group" label={k.label} value={formatMoney(cycle.split![k.key])} swatch={toneColor(k.tone)} />,
              ...lines.map((item) => (
                <KV key={`${k.key}-${item.label}`} kind="sub" label={`${item.label}${describe(item)}`} value={formatMoney(item.amount)} />
              )),
            ];
          })}
          <KV kind="total" label="Gas total" value={formatMoney(cycle.charge)} />
        </KeyValue>
        {pricing && (
          <div className="fp-readout justify-center gap-2.5 p-5">
            <span className="fp-label">In plain terms</span>
            <p className="text-lead leading-snug">
              With no gas used at all, this bill would still have been about <b className="font-semibold">{formatMoney(pricing.withoutGas)}</b>.
            </p>
            <p className="text-lead leading-snug">
              Each CCF added about <b className="font-semibold">{formatMoney(pricing.perCcf)}</b>, taxes included.
            </p>
          </div>
        )}
      </Split>
    </Panel>
  );
}

/** The half dial: the last gas bill as flat charges, gas used, and taxes, end to end. */
function GasDial({ cycle }: { cycle: GasCycle }) {
  const top = Math.max(10, Math.ceil((cycle.charge * 1.08) / 10) * 10);
  let at = 0;
  const segments = cycle.split
    ? KINDS.map((k) => {
        const from = at;
        at += cycle.split![k.key];
        return { from, to: at, tone: k.tone as ChartTone };
      })
    : [{ from: 0, to: cycle.charge, tone: 'gas' as ChartTone }];
  return (
    <>
      <Dial
        half
        start={-90}
        sweep={180}
        label={
          cycle.split
            ? `Last gas bill ${formatMoney(cycle.charge)}: flat charges ${formatMoney(cycle.split.fixed)}, gas used ${formatMoney(cycle.split.usage)}, taxes and city fee ${formatMoney(cycle.split.taxes)}.`
            : `Last gas bill ${formatMoney(cycle.charge)}, not itemized.`
        }
        rings={[{
          r: 92, w: 18, min: 0, max: top, ticks: 8, major: 2, gap: 1.2,
          labels: [[0, '$0'], [top / 2, formatMoney(top / 2, { cents: false })], [top, formatMoney(top, { cents: false })]],
          segments,
        }]}
      >
        <DialCentre label="Last gas bill" note={period(cycle)} noteMono>
          <Num size="l" value={formatMoney(cycle.charge)} />
        </DialCentre>
      </Dial>
      {cycle.split && (
        <DialLegend items={KINDS.map((k) => ({ label: k.label, value: formatMoney(cycle.split![k.key]), tone: k.tone, key: 'box' as const }))} />
      )}
    </>
  );
}

export default memo(function GasUsage() {
  const t = useChartTheme();
  const bills = useQuery({ queryKey: ['coserv-bills'], queryFn: fetchCoservBills, staleTime: 30_000 });
  const cycles = useMemo(() => gasCycles(bills.data ?? []), [bills.data]);
  const first = cycles[0];
  const latest = cycles[cycles.length - 1];
  const previous = cycles[cycles.length - 2];

  usePageMeta({ subtitle: bills.dataUpdatedAt ? `Updated ${formatTime(bills.dataUpdatedAt)}` : undefined });

  const weather = useQuery({
    queryKey: ['weather', first?.start, latest?.end],
    queryFn: () => fetchWeatherForRange(first!.start, latest!.end),
    enabled: !!first && !!latest,
    staleTime: 3_600_000,
  });

  const rows = useMemo<Row[]>(
    () =>
      cycles.map((c) => ({
        label: formatMonthYear(c.end),
        cycle: c,
        ccf: c.ccf,
        temp: weather.data ? cycleTemperature(c, weather.data.daily ?? []) : null,
        fixed: c.split?.fixed ?? 0,
        usage: c.split?.usage ?? 0,
        taxes: c.split?.taxes ?? 0,
        unitemized: c.split ? 0 : c.charge,
      })),
    [cycles, weather.data]
  );
  const anyItemized = cycles.some((c) => c.split);
  const anyUnitemized = cycles.some((c) => !c.split);
  const next = nextGasBill(cycles);
  // Compared as home calendar days, so the evening of the expected day isn't "any day" yet (B-093).
  const nextBillPassed = next != null && homeToday() > next.bill;

  const change = latest && previous ? latest.perDay - previous.perDay : null;
  const usageNote = latest
    ? change == null
      ? `${perDay(latest.perDay)} a day`
      : Math.abs(change) < 0.005
        ? `${perDay(latest.perDay)} a day, same as before`
        : `${perDay(latest.perDay)} a day, ${change > 0 ? 'up' : 'down'} from ${perDay(previous!.perDay)}`
    : undefined;

  const monthly = (
    <Notice tone="neutral" title="Gas is only read once a month.">
      CoServ reads the gas meter once a billing cycle, so this view changes when a new bill comes in.
    </Notice>
  );

  return (
    <>
      <QueryState
        query={bills}
        what="the gas bills"
        loading={<SkelInstrumentPanel readouts={3} />}
        isEmpty={() => !latest}
        empty={
          <EmptyState icon="flame" title="No gas bills yet">
            Gas shows up here once a CoServ bill with gas service arrives. Bills are pulled from SmartHub once a day.
          </EmptyState>
        }
      >
        {() => {
          // isEmpty guarantees a latest cycle here.
          const latest = cycles[cycles.length - 1];
          const share = latest.split ? latest.split.fixed / latest.charge : null;
          const nextWords = next
            ? nextBillPassed
              ? `The next bill is due any day; it's usually here by ${formatDate(next.bill)}.`
              : `The next bill should arrive around ${formatDate(next.bill)}.`
            : '';
          return (
            <InstrumentPanel
              instrument={<GasDial cycle={latest} />}
              verdict={
                latest.split && share != null ? (
                  <Verdict
                    tone="ok"
                    note={`${formatMoney(latest.split.fixed)} of the ${formatMoney(latest.charge)} is charged however much gas you use. ${nextWords}`}
                  >
                    {share > 0.5
                      ? 'More than half of the last gas bill was flat charges.'
                      : latest.split.usage / latest.charge > 0.5
                        ? 'More than half of the last gas bill was for gas used.'
                        : `About ${formatNumber(share * 100)}% of the last gas bill was flat charges.`}
                  </Verdict>
                ) : (
                  <Verdict tone="ok" note={`For ${period(latest)}. ${nextWords}`}>
                    The last gas bill was {formatMoney(latest.charge)}.
                  </Verdict>
                )
              }
              readouts={
                <Readouts>
                  <Readout
                    label="Gas used"
                    value={formatNumber(latest.ccf)}
                    unit="CCF"
                    note={usageNote}
                    noteIcon={change == null || Math.abs(change) < 0.005 ? undefined : change > 0 ? 'arrow-up' : 'arrow-down'}
                  />
                  <Readout
                    label="Flat charges"
                    value={share != null ? formatNumber(share * 100) : DASH}
                    unit={share != null ? '%' : undefined}
                    note={
                      latest.split
                        ? `${formatMoney(latest.split.fixed)}, however much gas you use`
                        : 'Itemized after the next bill sync'
                    }
                  />
                  <Readout
                    label="Next bill"
                    value={next ? (nextBillPassed ? 'Any day' : formatShortDate(next.bill)) : DASH}
                    note={next ? (nextBillPassed ? `Usually here by ${formatShortDate(next.bill)}` : `Meter read around ${formatShortDate(next.read)}`) : undefined}
                  />
                </Readouts>
              }
            >
              {monthly}
            </InstrumentPanel>
          );
        }}
      </QueryState>

      {latest && (
        <>
          <Split ratio="even">
            <DeferredRender placeholder={DEFERRED_CHART}>
              <Panel title="Gas used per bill" subtitle="CCF for each billing cycle, by the month CoServ read the meter">
                <ResponsiveContainer width="100%" height={220} debounce={80}>
                  <BarChart data={rows} margin={MARGIN}>
                    <CartesianGrid {...t.grid} />
                    <XAxis dataKey="label" {...t.axis} interval={0} />
                    <YAxis {...t.axis} allowDecimals={false} width={36} />
                    <Tooltip content={<GasTooltip />} cursor={t.barCursor} wrapperStyle={t.tooltip.wrapperStyle} />
                    <Bar dataKey="ccf" name="Gas used" fill={t.series.gas} radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </DeferredRender>
            <DeferredRender placeholder={DEFERRED_CHART}>
              <Panel title="Gas charge per bill" subtitle="What each bill's gas charge went to">
                <div className="fp-stack fp-stack--s">
                  <ChartLegend
                    items={[
                      ...(anyItemized ? KINDS.map((k) => ({ label: k.label, tone: k.tone, key: 'box' as const })) : []),
                      ...(anyUnitemized ? [{ label: 'Not itemized', tone: 'empty' as const, key: 'box' as const }] : []),
                    ]}
                  />
                  <ResponsiveContainer width="100%" height={220} debounce={80}>
                    <BarChart data={rows} margin={MARGIN}>
                      <CartesianGrid {...t.grid} />
                      <XAxis dataKey="label" {...t.axis} interval={0} />
                      <YAxis {...t.axis} width={40} tickFormatter={(v: number) => formatMoney(v, { cents: false })} />
                      <Tooltip content={<GasTooltip money />} cursor={t.barCursor} wrapperStyle={t.tooltip.wrapperStyle} />
                      {anyItemized && KINDS.map((k) => (
                        <Bar key={k.key} dataKey={k.key} name={k.label} stackId="gas" fill={t.series[k.tone]} maxBarSize={48} isAnimationActive={false} />
                      ))}
                      {anyUnitemized && (
                        <Bar dataKey="unitemized" name="Not itemized" stackId="gas" fill={t.series.empty} maxBarSize={48} isAnimationActive={false} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </DeferredRender>
          </Split>

          {latest.split && <LastBill cycle={latest} />}
        </>
      )}

      {/* Shown even with no gas cycles: a statement without gas service still lists here. */}
      {bills.data !== undefined && <CoservBillingHistory service="gas" />}
    </>
  );
});
