import { memo, useMemo } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { EnergyUsage } from '../types';
import { isHourlySource } from '../utils/usageSource';
import { formatMonthYear, formatNumber, homeToday } from '../utils/format';
import { ChartLegend, EmptyState, Panel, QueryState, SkelBlock, useChartTheme, type QueryLike } from './ui';

const MARGIN = { top: 18, right: 8, left: 0, bottom: 0 } as const;

interface MonthRow {
  /** YYYY-MM: sorts by time. */
  key: string;
  label: string;
  kWh: number;
  partial: boolean;
}

/**
 * Month-over-month bars from the hourly readings (60 days of them), oldest on the left like
 * every other time chart (B-017). The first month usually starts mid-month and the current
 * one isn't over, so those bars are drawn lighter and called partial.
 */
function MonthlyComparison({ usage }: { usage: QueryLike<EnergyUsage[]> }) {
  const t = useChartTheme();
  const data = usage.data;

  // Keyed by the sortable month (the readings are home wall-clock, so the first
  // seven characters are the home's month), then sorted ascending.
  const rows = useMemo<MonthRow[]>(() => {
    const byMonth = new Map<string, { total: number; firstDay: string }>();
    for (const d of data ?? []) {
      if (!isHourlySource(d.source) || typeof d.timestamp !== 'string') continue;
      const key = d.timestamp.slice(0, 7);
      const day = d.timestamp.slice(0, 10);
      const m = byMonth.get(key) ?? { total: 0, firstDay: day };
      m.total += Number(d.usageKwh) || 0;
      if (day < m.firstDay) m.firstDay = day;
      byMonth.set(key, m);
    }
    const thisMonth = homeToday().slice(0, 7);
    const keys = [...byMonth.keys()].sort();
    return keys.map((key, i) => {
      const m = byMonth.get(key)!;
      return {
        key,
        label: formatMonthYear(`${key}-01`),
        kWh: Math.round(m.total * 10) / 10,
        // The current month isn't over; the oldest starts wherever the 60 days begin.
        partial: key === thisMonth || (i === 0 && !m.firstDay.endsWith('-01')),
      };
    });
  }, [data]);

  const firstPartial = rows[0]?.partial ? rows[0] : null;

  return (
    <Panel
      title="By month"
      subtitle={
        firstPartial
          ? `From hourly readings. ${firstPartial.label} starts partway through`
          : 'From hourly readings'
      }
    >
      <QueryState
        query={usage}
        what="the monthly totals"
        loading={<SkelBlock height={240} />}
        empty={
          <EmptyState icon="bar-chart" title="No months to compare yet" compact>
            Each month appears here as its readings come in.
          </EmptyState>
        }
      >
        {() => (
          <div className="fp-stack fp-stack--s">
            <ChartLegend
              items={[
                { label: 'Whole month', tone: 'ink', key: 'box' },
                ...(rows.some((r) => r.partial) ? [{ label: 'Partial month', tone: 'soft' as const, key: 'box' as const }] : []),
              ]}
            />
            <ResponsiveContainer width="100%" height={240} debounce={80}>
              <BarChart data={rows} margin={MARGIN}>
                <CartesianGrid {...t.grid} />
                <XAxis dataKey="label" {...t.axis} interval={0} />
                <YAxis {...t.axis} width={44} tickFormatter={(v: number) => formatNumber(v)} />
                <Tooltip
                  {...t.tooltip}
                  cursor={t.barCursor}
                  formatter={(value: number, _n: string, item: { payload?: MonthRow }) => [
                    formatNumber(value, { decimals: 1, fixed: true, unit: 'kWh' }),
                    item.payload?.partial ? 'So far (partial month)' : 'Total',
                  ]}
                />
                <Bar dataKey="kWh" isAnimationActive={false} radius={[3, 3, 0, 0]} maxBarSize={48}>
                  {rows.map((r) => (
                    <Cell key={r.key} fill={r.partial ? t.series.soft : t.series.ink} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

export default memo(MonthlyComparison);
