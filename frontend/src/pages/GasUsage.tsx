import { memo, useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import StatTile, { Icons } from '../components/StatTile';
import DeferredRender from '../components/DeferredRender';
import CoservBillingHistory from '../components/CoservBillingHistory';
import { fetchCoservBills } from '../api/coservBills';
import { fetchWeatherForRange } from '../api/weather';
import { useTheme, DATA_SERIES } from '../context/ThemeContext';
import type { GasLineItem } from '../types';
import {
  billMonth,
  cycleTemperature,
  gasCycles,
  gasPricing,
  nextGasBill,
  shortDate,
  type GasCycle,
} from '../utils/gasBills';

const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 } as const;
const TICK = { fill: 'var(--appchart-tick)', fontSize: 11 } as const;
const AXIS_LINE = { stroke: 'var(--appchart-grid)' } as const;
const LEGEND_STYLE = { fontSize: 12 } as const;
const CARD = 'rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]';

const money = (n: number) => `$${n.toFixed(2)}`;
const perDay = (n: number) => n.toFixed(2);
const period = (c: GasCycle) => `${shortDate(c.start)} – ${shortDate(c.end)}`;

const KINDS = [
  { key: 'fixed', label: 'Flat charges', color: 'gasFixed' },
  { key: 'usage', label: 'Gas used', color: 'gasUsed' },
  { key: 'taxes', label: 'Taxes & city fee', color: 'gasTaxes' },
] as const;

// Legend text stays in text ink; the swatch carries the series color.
const legendLabel = (value: string) => <span style={{ color: 'var(--apptext-soft)' }}>{value}</span>;

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

function TooltipCard({ active, payload, money: asMoney }: { active?: boolean; payload?: { payload: Row }[]; money?: boolean }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const { cycle } = row;
  return (
    <div className="rounded-2xl border border-appchart-border bg-appchart-bg px-3 py-2 text-xs text-apptext shadow-[0_20px_50px_var(--appshadow-lg)]">
      <p className="font-medium">{row.label} bill</p>
      <p className="text-apptext-muted">{period(cycle)} · {cycle.days} days</p>
      {asMoney ? (
        cycle.split ? (
          <ul className="mt-1 space-y-0.5">
            {KINDS.map((k) => (
              <li key={k.key} className="flex justify-between gap-4">
                <span className="text-apptext-soft">{k.label}</span>
                <span>{money(cycle.split![k.key])}</span>
              </li>
            ))}
            <li className="flex justify-between gap-4 font-medium">
              <span>Gas total</span>
              <span>{money(cycle.charge)}</span>
            </li>
          </ul>
        ) : (
          <p className="mt-1">Gas total {money(cycle.charge)}</p>
        )
      ) : (
        <>
          <p className="mt-1">
            {cycle.ccf} CCF · {perDay(cycle.perDay)} a day
          </p>
          {row.temp != null && <p className="text-apptext-muted">Averaged {Math.round(row.temp)}°F outside</p>}
        </>
      )}
    </div>
  );
}

/** The last bill's gas lines, grouped the way the chart splits them. */
function LastBill({ cycle }: { cycle: GasCycle }) {
  const items = cycle.items ?? [];
  const pricing = gasPricing(cycle);
  const describe = (item: GasLineItem) =>
    item.ccf != null && item.rate != null ? `${item.ccf} CCF × $${item.rate}` : null;
  return (
    <section className={CARD}>
      <h3 className="text-xl font-semibold text-apptext">What the last gas bill paid for</h3>
      <p className="mt-1 text-sm text-apptext-muted">
        {period(cycle)}, {cycle.ccf} CCF
      </p>
      <div className="mt-4 space-y-4 text-sm">
        {KINDS.map((k) => {
          const lines = items.filter((i) => i.kind === k.key);
          if (!lines.length) return null;
          return (
            <div key={k.key}>
              <div className="flex items-baseline justify-between gap-3 font-medium text-apptext">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `var(--gas-${k.key})` }} />
                  {k.label}
                </span>
                <span>{money(cycle.split![k.key])}</span>
              </div>
              <ul className="mt-1 space-y-0.5 pl-[18px] text-apptext-soft">
                {lines.map((item) => (
                  <li key={item.label} className="flex items-baseline justify-between gap-3">
                    <span>
                      {item.label}
                      {describe(item) && <span className="text-apptext-muted"> · {describe(item)}</span>}
                    </span>
                    <span>{money(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="flex items-baseline justify-between gap-3 border-t border-appborder pt-3 font-semibold text-apptext">
          <span>Gas total</span>
          <span>{money(cycle.charge)}</span>
        </div>
      </div>
      {pricing && (
        <p className="mt-4 rounded-2xl bg-appinset px-4 py-3 text-sm leading-6 text-apptext-soft">
          With no gas used at all, this bill would still have been about{' '}
          <span className="font-medium text-apptext">{money(pricing.withoutGas)}</span>. Each CCF added about{' '}
          <span className="font-medium text-apptext">{money(pricing.perCcf)}</span>, taxes included.
        </p>
      )}
    </section>
  );
}

export default memo(function GasUsage() {
  const { theme } = useTheme();
  const ds = DATA_SERIES[theme];
  const bills = useQuery({ queryKey: ['coserv-bills'], queryFn: fetchCoservBills, staleTime: 30_000 });
  const cycles = useMemo(() => gasCycles(bills.data ?? []), [bills.data]);
  const loading = bills.isLoading;
  const first = cycles[0];
  const latest = cycles[cycles.length - 1];
  const previous = cycles[cycles.length - 2];

  const weather = useQuery({
    queryKey: ['weather', first?.start, latest?.end],
    queryFn: () => fetchWeatherForRange(first!.start, latest!.end),
    enabled: !!first && !!latest,
    staleTime: 3_600_000,
  });

  const rows = useMemo<Row[]>(
    () =>
      cycles.map((c) => ({
        label: billMonth(c),
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
  const nextBillPassed = next != null && new Date().toISOString().slice(0, 10) > next.bill;

  const usageNote = (() => {
    if (!latest) return undefined;
    const now = `${perDay(latest.perDay)} CCF a day`;
    if (!previous) return now;
    const change = latest.perDay - previous.perDay;
    if (Math.abs(change) < 0.005) return `${now}, same as before`;
    return `${now}, ${change > 0 ? 'up' : 'down'} from ${perDay(previous.perDay)}`;
  })();

  if (!loading && !latest) {
    return (
      <div className="space-y-6 sm:space-y-7">
        <section className={`${CARD} p-8 text-center`}>
          <div className="mb-3 text-4xl">🔥</div>
          <h3 className="mb-2 text-xl font-semibold text-apptext">No gas bills yet</h3>
          <p className="mx-auto max-w-md text-sm leading-6 text-apptext-muted">
            Gas shows up here once a CoServ bill with gas service arrives. Bills are pulled from SmartHub once a day.
          </p>
        </section>
        <CoservBillingHistory service="gas" />
      </div>
    );
  }

  return (
    <div
      className="space-y-6 sm:space-y-7"
      style={{ '--gas-fixed': ds.gasFixed, '--gas-usage': ds.gasUsed, '--gas-taxes': ds.gasTaxes } as CSSProperties}
    >
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Last gas bill"
          value={latest ? money(latest.charge) : '—'}
          unit=""
          subtitle={latest ? period(latest) : undefined}
          loading={loading}
          icon={Icons.Dollar}
        />
        <StatTile
          label="Gas used"
          value={latest ? String(latest.ccf) : '—'}
          unit="CCF"
          subtitle={usageNote}
          loading={loading}
          icon={Icons.Flame}
        />
        <StatTile
          label="Flat charges"
          value={latest?.split ? money(latest.split.fixed) : '—'}
          unit=""
          subtitle={
            latest?.split
              ? `${Math.round((latest.split.fixed / latest.charge) * 100)}% of that bill, however much gas you use`
              : 'Itemized after the next bill sync'
          }
          loading={loading}
          icon={Icons.Dollar}
        />
        <StatTile
          label="Next bill"
          value={next ? (nextBillPassed ? 'Any day' : shortDate(next.bill)) : '—'}
          unit=""
          subtitle={next ? (nextBillPassed ? `Usually here by ${shortDate(next.bill)}` : `Meter read around ${shortDate(next.read)}`) : undefined}
          loading={loading}
          icon={Icons.Calendar}
        />
      </section>

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
          <div className={CARD}>
            <h3 className="text-xl font-semibold text-apptext">Gas used per bill</h3>
            <p className="mb-4 mt-1 text-sm text-apptext-muted">CCF for each billing cycle, by the month CoServ read the meter.</p>
            <ResponsiveContainer width="100%" height={260} debounce={80}>
              <BarChart data={rows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--appchart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={TICK} axisLine={AXIS_LINE} tickLine={false} />
                <YAxis tick={TICK} axisLine={AXIS_LINE} tickLine={false} allowDecimals={false} unit=" CCF" width={56} />
                <Tooltip content={<TooltipCard />} cursor={{ fill: 'var(--appinset)' }} />
                <Bar dataKey="ccf" name="Gas used" fill={ds.gasUsed} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DeferredRender>
        <DeferredRender minHeight={360}>
          <div className={CARD}>
            <h3 className="text-xl font-semibold text-apptext">Gas charge per bill</h3>
            <p className="mb-4 mt-1 text-sm text-apptext-muted">What each bill's gas charge went to.</p>
            <ResponsiveContainer width="100%" height={260} debounce={80}>
              <BarChart data={rows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--appchart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={TICK} axisLine={AXIS_LINE} tickLine={false} />
                <YAxis tick={TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={44} />
                <Tooltip content={<TooltipCard money />} cursor={{ fill: 'var(--appinset)' }} />
                <Legend wrapperStyle={LEGEND_STYLE} formatter={legendLabel} />
                {anyItemized && KINDS.map((k) => (
                  <Bar
                    key={k.key}
                    dataKey={k.key}
                    name={k.label}
                    stackId="gas"
                    fill={ds[k.color]}
                    stroke="var(--appchart-bg)"
                    strokeWidth={2}
                    radius={k.key === 'taxes' ? [4, 4, 0, 0] : undefined}
                    maxBarSize={48}
                    isAnimationActive={false}
                  />
                ))}
                {anyUnitemized && (
                  <Bar
                    dataKey="unitemized"
                    name="Not itemized yet"
                    stackId="gas"
                    fill="var(--apptext-muted)"
                    stroke="var(--appchart-bg)"
                    strokeWidth={2}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                    isAnimationActive={false}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DeferredRender>
      </section>

      {latest?.split && <LastBill cycle={latest} />}

      <CoservBillingHistory service="gas" />
    </div>
  );
});
