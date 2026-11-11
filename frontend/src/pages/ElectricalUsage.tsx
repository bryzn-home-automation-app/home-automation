import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUsageData } from '../hooks/useUsageData';
import TrendOutlookChart from '../components/TrendOutlookChart';
import MonthlyComparison from '../components/MonthlyComparison';
import DeferredRender from '../components/DeferredRender';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import UsageWeatherChart from '../components/UsageWeatherChart';
import ForecastChart, { ForecastModelFacts } from '../components/ForecastChart';
import CoservBillingHistory from '../components/CoservBillingHistory';
import { fetchBatchSummaries } from '../api/energy';
import { fetchForecast } from '../api/forecast';
import { fetchWeatherForRange } from '../api/weather';
import { fetchCoservBills } from '../api/coservBills';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { usePageMeta } from '../components/shell/PageMeta';
import {
  buildUsagePeriods,
  createEmptyUsageSummary,
  dailyTrendSeries,
  averageCompleteDailyKwh,
  COMPLETE_DAY_MIN_HOURS,
} from '../utils/usageSummary';
import { isHourlySource } from '../utils/usageSource';
import { addDays, currentBillingCycle, daysBetween, projectElectricBill, type BillProjection } from '../utils/billProjection';
import {
  DASH,
  formatAbout,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayName,
  formatMoney,
  formatNumber,
  formatShortDate,
  formatTemp,
  formatTime,
  homeToday,
  plural,
} from '../utils/format';
import type { Tone } from '../utils/status';
import type { EnergyUsage } from '../types';
import { Badge, Button, Chips, DataTable, Dial, DialCentre, DialLegend, Disclosure, EmptyState, InstrumentPanel, KeyValue, KV, Lamp, Loading, Num, Panel, QueryState, Readout, Readouts, Seg, SegPanel, ShowMore, SkelInstrumentPanel, Split, useSearchParamState, Verdict, type Column } from '../components/ui';
import { DEFERRED_CHART, meterGated } from './utility/parts';

type LogFilter = 'daily' | 'hourly';

const TABS = ['usage', 'forecast'] as const;
const TAB_OPTIONS = [
  { value: 'usage', label: 'Usage & bills' },
  { value: 'forecast', label: 'Forecast & stats' },
] as const;
const LOG_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'hourly', label: 'Hourly' },
] as const;

/** A projected bill this far over the last one turns the verdict to a heads-up. */
const HEADSUP_OVER_LAST = 0.15;

const kwh = (n: number | null | undefined, decimals = 1) => formatNumber(n, { decimals, fixed: true });

interface DayTotal {
  date: string;
  total: number;
}

export default memo(function ElectricalUsage() {
  const { meters, electricUsage, electricTotal, electricMeter, config, electricDaily } = useUsageData();
  const [logFilter, setLogFilter] = useState<LogFilter>('daily');
  // The sub-view is in the URL too (?tab=forecast), like the utility view (B-075).
  const [tab, setTab] = useSearchParamState('tab', TABS, 'usage');
  const weatherInterval = useJitteredInterval(3_600_000, 60_000);

  const hasMeter = !!electricMeter;
  const usageQ = meterGated(meters, hasMeter, electricUsage);
  const dailyQ = meterGated(meters, hasMeter, electricDaily);

  const lastSync = config.data?.lastSyncCheck as string | undefined;
  const lastReading = config.data?.lastElectricReading as string | undefined;
  usePageMeta({
    subtitle: lastSync
      ? `Checked ${formatTime(lastSync)}`
      : electricDaily.dataUpdatedAt
        ? `Updated ${formatTime(electricDaily.dataUpdatedAt)}`
        : undefined,
  });

  const data = useMemo(() => electricUsage.data ?? [], [electricUsage.data]);
  const kwhRate: number = config.data?.kwhRate ?? 0.1171;
  const today = homeToday();

  const realData = useMemo(
    () =>
      data.filter((d) => {
        if (!d || typeof d.timestamp !== 'string' || d.timestamp.length < 10) return false;
        const usage = Number(d.usageKwh);
        return Number.isFinite(usage) && usage > 0;
      }),
    [data]
  );

  // Daily trend line is driven by the server's pre-aggregated per-day totals
  // (a single GROUP BY on the backend), NOT a client-side sum of point-capped
  // hourly rows — the latter downsampled ~1,440 hourly rows to 500 before summing,
  // so each day showed only ~1/3 of its real kWh (see git history / ISSUES).
  const trendPoints = useMemo(() => dailyTrendSeries(electricDaily.data ?? []), [electricDaily.data]);

  // ── Daily totals and hour counts from the hourly rows ──────────
  const { dailyFromHourly, hourlyCountByDate } = useMemo(() => {
    const totals = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const d of realData) {
      if (!isHourlySource(d.source)) continue;
      const date = d.timestamp.slice(0, 10);
      totals.set(date, (totals.get(date) ?? 0) + Number(d.usageKwh));
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    const days: DayTotal[] = Array.from(totals.entries())
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first
    return { dailyFromHourly: days, hourlyCountByDate: counts };
  }, [realData]);

  // The last reading is the newest COMPLETE day, by the same rule Home and the
  // averages use (COMPLETE_DAY_MIN_HOURS hourly rows), so the three agree (B-081).
  const latestDaily = useMemo(
    () => dailyFromHourly.find((d) => (hourlyCountByDate.get(d.date) ?? 0) >= COMPLETE_DAY_MIN_HOURS) ?? null,
    [dailyFromHourly, hourlyCountByDate]
  );

  // CoServ bills — same query key as the Bills panel, so the page fetches them
  // once. They anchor the bill projection's cycle + pricing.
  const coservBills = useQuery({ queryKey: ['coserv-bills'], queryFn: fetchCoservBills, staleTime: 30_000 });
  const billCycle = useMemo(() => currentBillingCycle(coservBills.data ?? [], today), [coservBills.data, today]);

  // One forecast fetch serves both the last-reading readout and the bill
  // projection: it must reach the end of the billing cycle (the endpoint pads
  // past the weather horizon), and it always carries the trailing 14 days of
  // snapshots (see ForecastController), which cover latestDaily's date. At the
  // usual 14-day horizon this shares one cached request with the trend chart.
  const forecastDays = Math.min(90, Math.max(14, daysBetween(today, billCycle.end)));
  const forecastQ = useQuery({
    queryKey: ['forecast', forecastDays],
    queryFn: () => fetchForecast(forecastDays),
    staleTime: 600_000,
    refetchInterval: weatherInterval,
    refetchIntervalInBackground: false,
  });
  const latestForecast = forecastQ.data;
  const latestPredicted = useMemo(() => {
    if (!latestDaily || latestForecast?.status !== 'ok') return null;
    const snap = latestForecast.snapshots?.find((s) => s.targetDate === latestDaily.date);
    return snap?.predictedKwh ?? null;
  }, [latestDaily, latestForecast]);

  const billProjection = useMemo(
    () =>
      projectElectricBill({
        today,
        bills: coservBills.data ?? [],
        daily: electricDaily.data ?? [],
        forecasts: latestForecast?.status === 'ok' ? latestForecast.forecasts ?? [] : [],
        snapshots: latestForecast?.status === 'ok' ? latestForecast.snapshots ?? [] : [],
        kwhRate,
      }),
    [today, coservBills.data, electricDaily.data, latestForecast, kwhRate]
  );

  // ── 7-day and 30-day averages (complete days only) ─────────────
  const hasDaily = electricDaily.data !== undefined;
  const avg7 = useMemo(() => averageCompleteDailyKwh(electricDaily.data ?? [], 7), [electricDaily.data]);
  const avg30 = useMemo(() => averageCompleteDailyKwh(electricDaily.data ?? [], 30), [electricDaily.data]);

  // ── Periods and weather for the summaries and the log ──────────
  const periodDefinitions = useMemo(
    () => buildUsagePeriods(config.data?.dataStartDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.data?.dataStartDate, today]
  );
  const weatherStart = periodDefinitions.length > 0 ? periodDefinitions[periodDefinitions.length - 1].start.slice(0, 10) : '';
  const { data: weather } = useQuery({
    queryKey: ['weather', weatherStart, today],
    queryFn: () => fetchWeatherForRange(weatherStart, today),
    enabled: weatherStart !== '',
    staleTime: 3_600_000,
    refetchInterval: weatherInterval,
    refetchIntervalInBackground: false,
  });

  const weatherByDate = useMemo(() => {
    const map = new Map<string, { mean: number; high: number; low: number }>();
    for (const w of weather?.daily ?? []) {
      if (typeof w.date !== 'string' || !w.date) continue;
      map.set(w.date, { mean: w.meanTemperature, high: w.maxTemperature, low: w.minTemperature });
    }
    return map;
  }, [weather]);

  const weatherByHour = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of weather?.hourly ?? []) {
      if (h.time && h.time.length >= 13) map.set(h.time.substring(0, 13), h.temperature);
    }
    return map;
  }, [weather]);

  // One batched HTTP call for all periods instead of N parallel ones.
  const periodsKey = periodDefinitions.map((p) => `${p.start}:${p.end}`).join('|');
  const batchSummary = useQuery({
    queryKey: ['usage-summaries', electricMeter?.id, periodsKey],
    queryFn: () =>
      electricMeter
        ? fetchBatchSummaries(electricMeter.id, periodDefinitions.map((p) => ({ start: p.start, end: p.end })))
        : Promise.resolve(periodDefinitions.map((p) => createEmptyUsageSummary(0, p.start, p.end))),
    enabled: hasMeter && periodDefinitions.length > 0,
    staleTime: 30_000,
  });
  const summaryQ = meterGated(meters, hasMeter, batchSummary);

  // Memoized — the per-period weather reductions (O(periods × weatherDays))
  // otherwise re-run on every render (usage poll, theme change, log toggle).
  const summaryCards = useMemo(() => periodDefinitions.map((period, index) => {
    const s = batchSummary.data?.[index] ?? createEmptyUsageSummary(electricMeter?.id ?? 0, period.start, period.end);
    const periodWx = Array.from(weatherByDate.entries())
      .filter(([date]) => date >= period.start.slice(0, 10) && date <= period.end.slice(0, 10));
    const temps = periodWx.flatMap(([, w]) => [w.high, w.low, w.mean]).filter((t) => t > 0);
    return {
      key: period.key,
      label: period.label,
      rangeStart: period.displayStart,
      rangeEnd: period.displayEnd,
      summary: s,
      wxAvg: temps.length ? temps.reduce((sum, t) => sum + t, 0) / temps.length : null,
      wxHigh: periodWx.length ? Math.max(...periodWx.map(([, w]) => w.high)) : null,
      wxLow: periodWx.length ? Math.min(...periodWx.map(([, w]) => w.low)) : null,
    };
  }), [periodDefinitions, batchSummary.data, weatherByDate, electricMeter?.id]);

  // ── Readings log ───────────────────────────────────────────────
  const dailyLogData = useMemo(
    () => dailyFromHourly.filter((d) => (hourlyCountByDate.get(d.date) ?? 0) >= COMPLETE_DAY_MIN_HOURS).slice(0, 30),
    [dailyFromHourly, hourlyCountByDate]
  );
  const hourlyLogData = useMemo(
    () =>
      realData
        .filter((d) => isHourlySource(d.source))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 48),
    [realData]
  );

  // ── The answer ────────────────────────────────────────────────
  const answerLoading =
    (coservBills.data === undefined && !coservBills.isError) ||
    (dailyQ.data === undefined && !dailyQ.isError) ||
    (latestForecast === undefined && forecastQ.isLoading);
  const failed = [
    coservBills.isError && !coservBills.data ? coservBills : null,
    dailyQ.isError && dailyQ.data === undefined ? dailyQ : null,
    forecastQ.isError && !forecastQ.data ? forecastQ : null,
  ].filter((q): q is NonNullable<typeof q> => q != null);

  const rate = billProjection?.pricing.energyRate ?? kwhRate;
  const latestIsYesterday = latestDaily != null && formatDayName(latestDaily.date) === 'Yesterday';
  const vsPredicted =
    latestDaily && latestPredicted != null && latestPredicted > 0
      ? (latestDaily.total - latestPredicted) / latestPredicted
      : null;

  return (
    <>
      {answerLoading ? (
        <Loading label="Loading the bill prediction"><SkelInstrumentPanel readouts={4} /></Loading>
      ) : (
        <InstrumentPanel
          instrument={<CycleDial p={billProjection} />}
          verdict={<BillVerdict p={billProjection} failed={failed.length > 0} />}
          readouts={
            <Readouts>
              <Readout
                label={latestIsYesterday ? 'Yesterday' : 'Last full day'}
                value={latestDaily ? kwh(latestDaily.total) : DASH}
                unit="kWh"
                noteIcon={vsPredicted == null ? undefined : vsPredicted >= 0 ? 'arrow-up' : 'arrow-down'}
                note={
                  latestDaily
                    ? [
                        latestIsYesterday ? null : formatDate(latestDaily.date),
                        vsPredicted != null
                          ? `${formatNumber(Math.abs(vsPredicted) * 100)}% ${vsPredicted >= 0 ? 'over' : 'under'} the ${kwh(latestPredicted)} forecast`
                          : null,
                      ].filter(Boolean).join(' · ') || undefined
                    : usageQ.isError ? "Couldn't load the readings" : 'No complete day yet'
                }
              />
              <Readout
                label="So far"
                value={billProjection ? formatNumber(billProjection.meteredKwh) : DASH}
                unit="kWh"
                note={
                  billProjection
                    ? `Since ${formatShortDate(billProjection.cycle.start)}, ${formatAbout(soFarCost(billProjection))}${
                        billProjection.pricing.method === 'calibrated' ? ' with the fixed charge' : ''
                      }`
                    : undefined
                }
              />
              <Readout
                label="Daily average"
                value={hasDaily && avg7 > 0 ? kwh(avg7) : DASH}
                unit="kWh"
                note={hasDaily && avg7 > 0 ? `Last 7 days. 30-day average ${kwh(avg30)}` : undefined}
              />
              <Readout
                label="Rate"
                value={`$${formatNumber(rate, { decimals: 4, fixed: true })}`}
                unit="/kWh"
                note={
                  billProjection?.pricing.method === 'calibrated'
                    ? `Plus ${formatMoney(billProjection.pricing.fixedCharge)} a month, fixed`
                    : billProjection?.pricing.method === 'effective-rate'
                      ? 'Your recent bills’ average, fixed charges included'
                      : 'Energy only, before fixed charges'
                }
              />
            </Readouts>
          }
          foot={
            <>
              <span className="fp-mono">{lastReading ? `Meter data through ${formatDateTime(lastReading)}` : 'No meter data yet'}</span>
              {lastSync && (
                <span className="fp-cluster">
                  <Lamp tone="ok" size="s" />
                  <span className="fp-mono">Checked {formatTime(lastSync)}</span>
                </span>
              )}
            </>
          }
        >
          {failed.length > 0 && (
            <Button size="sm" icon="refresh" onClick={() => failed.forEach((q) => void q.refetch())}>Try again</Button>
          )}
          {billProjection && <BillWorking p={billProjection} />}
        </InstrumentPanel>
      )}

      <Seg id="utility-electric" label="Electric view" value={tab} onChange={setTab} options={TAB_OPTIONS} />
      <SegPanel id="utility-electric" value={tab}>
        {tab === 'usage' ? (
          <>
            <Split ratio="wide">
              <DeferredRender placeholder={DEFERRED_CHART}>
                <TrendOutlookChart daily={dailyQ} points={trendPoints} />
              </DeferredRender>
              <DeferredRender placeholder={DEFERRED_CHART}>
                <MonthlyComparison usage={usageQ} />
              </DeferredRender>
            </Split>

            <CoservBillingHistory service="electric" />

            <Panel
              title="Readings"
              subtitle="From the CoServ meter, once a day"
              action={<Chips label="Readings" value={logFilter} onChange={setLogFilter} options={LOG_OPTIONS} />}
            >
              <QueryState query={usageQ} what="the readings" loading={<SkelRowsBlock />}>
                {() =>
                  logFilter === 'daily' ? (
                    <DailyLog rows={dailyLogData} rate={kwhRate} weatherByDate={weatherByDate} />
                  ) : (
                    <HourlyLog rows={hourlyLogData} rate={kwhRate} weatherByHour={weatherByHour} />
                  )
                }
              </QueryState>
            </Panel>
          </>
        ) : (
          <>
            {periodDefinitions.length > 0 && (
              <DeferredRender placeholder={DEFERRED_CHART}>
                <UsageWeatherChart
                  usage={usageQ}
                  startDate={periodDefinitions[periodDefinitions.length - 1].start}
                  endDate={periodDefinitions[periodDefinitions.length - 1].end}
                />
              </DeferredRender>
            )}

            <DeferredRender placeholder={DEFERRED_CHART}>
              <ForecastChart />
            </DeferredRender>

            <UsageSummaryGrid unitLabel="kWh" summaries={summaryCards} query={summaryQ} />

            <ForecastModelFacts>
              <KV label="Hourly readings, last 60 days" value={usageQ.data ? formatNumber(realData.length) : DASH} />
              <KV label="Use, last 60 days" value={electricTotal.data ? formatNumber(electricTotal.data.totalKwh, { unit: 'kWh' }) : DASH} />
              <KV
                label="Energy cost, last 60 days"
                value={electricTotal.data ? formatMoney(electricTotal.data.totalKwh * kwhRate) : DASH}
              />
            </ForecastModelFacts>
          </>
        )}
      </SegPanel>
    </>
  );
});

// ─── The billing-cycle dial and its words ───────────────────────────────

/** Metered so far, priced: the fixed charge plus the energy used. */
function soFarCost(p: BillProjection): number {
  return p.pricing.fixedCharge + p.pricing.energyRate * p.meteredKwh;
}

/** The cycle's last day as people read it: the meter read, or a calendar month's last day. */
function cycleEnd(p: BillProjection): string {
  return p.cycle.basis === 'calendar-month' ? addDays(p.cycle.end, -1) : p.cycle.end;
}

/** A round top for the money scale, clear of the bill and the last bill. */
function moneyScale(...values: number[]): number {
  const top = Math.max(1, ...values) * 1.25;
  const step = top > 200 ? 50 : top > 60 ? 25 : 10;
  return Math.ceil(top / step) * step;
}

/**
 * Two rings: the outer one is the cycle's days with a pointer at today; the inner one is the
 * money, solid for what has been metered and hatched for the forecast, with a tick at the
 * last bill. Open at the bottom, where the two dates sit.
 */
function CycleDial({ p }: { p: BillProjection | null }) {
  if (!p) {
    return (
      <Dial start={-150} sweep={300} rings={[{ r: 98, w: 3, min: 0, max: 30, ticks: 30, major: 5 }, { r: 78, w: 14 }]}>
        <DialCentre label="Predicted bill" note="Not yet"><Num size="xl" value={DASH} /></DialCentre>
      </Dial>
    );
  }
  const soFar = soFarCost(p);
  const last = p.lastBill?.charge;
  const top = moneyScale(p.projectedCost, last ?? 0);
  const end = cycleEnd(p);
  const label =
    `Day ${p.daysElapsed} of the ${formatDateRange(p.cycle.start, end)} billing cycle. ` +
    `${formatMoney(soFar, { cents: false })} metered so far, ${formatAbout(p.projectedCost - soFar)} more forecast, ` +
    `${formatMoney(p.projectedCost, { cents: false })} in all.` +
    (last != null ? ` Last bill was ${formatMoney(last, { cents: false })}.` : '');
  return (
    <>
      <Dial
        start={-150}
        sweep={300}
        label={label}
        className="[&_.fp-dial-centre]:pt-[7%]"
        rings={[
          {
            r: 98, w: 3, min: 0, max: p.daysTotal, ticks: p.daysTotal, major: 5,
            labels: [[0, formatShortDate(p.cycle.start)], [p.daysTotal, formatShortDate(end)]],
            segments: [{ from: 0, to: p.daysElapsed, tone: 'ink' }],
            needle: { at: p.daysElapsed },
          },
          {
            r: 78, w: 14, min: 0, max: top, ticks: 15, major: 5, tickSide: 'in',
            segments: [
              { from: 0, to: soFar, tone: 'ink' },
              { from: soFar, to: p.projectedCost, tone: 'graphite', dash: true },
            ],
            marks: last != null ? [{ at: last, inset: 2, out: 4 }] : [],
          },
        ]}
      >
        <DialCentre label="Predicted bill" note={p.daysLeft > 0 ? `${plural(p.daysLeft, 'day')} left` : 'Bill pending'} noteMono>
          <Num size="xl" value={formatMoney(p.projectedCost, { cents: false })} />
        </DialCentre>
      </Dial>
      <DialLegend
        items={[
          { label: 'So far', value: formatMoney(soFar, { cents: false }), tone: 'ink', key: 'box' },
          { label: 'Forecast', value: formatMoney(p.projectedCost - soFar, { cents: false }), tone: 'graphite', key: 'seg' },
          ...(last != null ? [{ label: 'Last bill', value: formatMoney(last, { cents: false }), tone: 'ink' as const, key: 'mark' as const }] : []),
          { label: 'Day', value: `${p.daysElapsed} of ${p.daysTotal}`, tone: 'ink', key: 'line' },
        ]}
      />
    </>
  );
}

function BillVerdict({ p, failed }: { p: BillProjection | null; failed: boolean }) {
  if (!p) {
    return failed ? (
      <Verdict tone="problem" note="The home server didn't answer for the bills or the meter readings. Nothing was lost.">
        Couldn&rsquo;t work out this cycle&rsquo;s bill.
      </Verdict>
    ) : (
      <Verdict tone="info" note="The prediction starts once the meter has posted a day of this billing cycle.">
        No bill to predict yet.
      </Verdict>
    );
  }
  const last = p.lastBill?.charge;
  const change = last ? (p.projectedCost - last) / last : null;
  const tone: Tone = change != null && change > HEADSUP_OVER_LAST ? 'headsup' : 'ok';
  const range = formatDateRange(p.cycle.start, cycleEnd(p));
  const compare =
    change == null || last == null
      ? null
      : Math.round(Math.abs(change) * 100) === 0
        ? `About the same as the last electric charge of ${formatMoney(last)}`
        : `That's ${formatNumber(Math.abs(change) * 100)}% ${change > 0 ? 'more' : 'less'} than the last electric charge of ${formatMoney(last)}`;
  const note =
    p.daysLeft > 0
      ? compare
        ? `${compare}, with ${plural(p.daysLeft, 'day')} to go (${range}).`
        : `${plural(p.daysLeft, 'day')} to go (${range}).`
      : `${compare ? `${compare}. ` : ''}The cycle ended ${formatDate(cycleEnd(p))}; its bill usually arrives within a few days.`;
  return (
    <Verdict tone={tone} note={note}>
      {p.daysLeft > 0 ? `Heading for ${formatAbout(p.projectedCost)} this cycle.` : `This cycle's bill should be ${formatAbout(p.projectedCost)}.`}
    </Verdict>
  );
}

/** How the prediction was built, in a disclosure that works by tap and keyboard (B-082). */
function BillWorking({ p }: { p: BillProjection }) {
  const usd = (n: number) => formatMoney(n);
  const pricing =
    p.pricing.method === 'calibrated'
      ? 'Priced like your last full bill.'
      : p.pricing.method === 'effective-rate'
        ? "Priced at your recent bills' average per kWh, fixed charges included."
        : "No bill has synced yet, so this is the energy charge alone, before fixed charges.";
  return (
    <Disclosure
      summary={`How the ${formatMoney(p.projectedCost, { cents: false })} is worked out`}
      openSummary="Hide the working"
    >
      <div className="fp-stack fp-stack--s">
        <KeyValue>
          <KV label={`Metered so far, from ${formatShortDate(p.cycle.start)}`} value={formatNumber(p.meteredKwh, { unit: 'kWh' })} />
          <KV
            label={p.daysLeft > 0 ? `Forecast for the ${plural(p.daysLeft, 'day')} left` : 'Estimated for days not posted yet'}
            value={formatNumber(p.forecastKwh, { unit: 'kWh' })}
          />
          <KV label="Whole cycle" value={formatNumber(p.projectedKwh, { unit: 'kWh' })} />
          <KV
            label={`Energy at $${formatNumber(p.pricing.energyRate, { decimals: 4, fixed: true })} a kWh`}
            value={usd(p.pricing.energyRate * p.projectedKwh)}
          />
          {p.pricing.method === 'calibrated' && <KV label="Fixed monthly charge" value={usd(p.pricing.fixedCharge)} />}
          <KV kind="total" label="Predicted electric charge" value={usd(p.projectedCost)} />
        </KeyValue>
        <p className="fp-small fp-muted">{pricing} Gas is billed separately on the same CoServ statement.</p>
      </div>
    </Disclosure>
  );
}

// ─── The readings log ───────────────────────────────────────────────────

function SkelRowsBlock() {
  return <div className="fp-stack fp-stack--s"><span className="fp-skel fp-skel-block" style={{ height: 220 }} /></div>;
}

function DailyLog({ rows, rate, weatherByDate }: {
  rows: DayTotal[];
  rate: number;
  weatherByDate: Map<string, { mean: number; high: number; low: number }>;
}) {
  if (!rows.length) {
    return (
      <EmptyState icon="list" title="No full days of readings yet" compact>
        A day shows here the morning after, once CoServ has posted all of it.
      </EmptyState>
    );
  }
  const columns: Column<DayTotal>[] = [
    { key: 'day', header: 'Day', kind: 'title', cell: (d) => formatDate(d.date) },
    { key: 'used', header: 'Used', kind: 'key', num: true, strong: true, cell: (d) => <>{kwh(d.total, 2)} <span className="fp-unit">kWh</span></> },
    { key: 'cost', header: 'Cost', num: true, cell: (d) => formatMoney(d.total * rate) },
    {
      key: 'temp',
      header: 'Low / avg / high',
      num: true,
      cell: (d) => {
        const wx = weatherByDate.get(d.date);
        return <span className="fp-mono">{wx ? `${formatTemp(wx.low)} / ${formatTemp(wx.mean)} / ${formatTemp(wx.high)}` : DASH}</span>;
      },
    },
  ];
  return (
    <ShowMore
      items={rows}
      first={7}
      noun="days"
      render={(part) => <DataTable rowKey={(d) => d.date} rows={part} columns={columns} caption="Daily readings" />}
    />
  );
}

/** Per-hour levels: under 2 kWh low, 2 to under 5 moderate, 5 and up high (B-087). */
function hourLevel(kwhUsed: number): { tone: Tone; word: string } {
  if (kwhUsed >= 5) return { tone: 'problem', word: 'High' };
  if (kwhUsed >= 2) return { tone: 'headsup', word: 'Moderate' };
  return { tone: 'neutral', word: 'Low' };
}

function HourlyLog({ rows, rate, weatherByHour }: { rows: EnergyUsage[]; rate: number; weatherByHour: Map<string, number> }) {
  if (!rows.length) {
    return (
      <EmptyState icon="list" title="No hourly readings yet" compact>
        Hours show here the morning after, once CoServ posts the day.
      </EmptyState>
    );
  }
  const columns: Column<EnergyUsage>[] = [
    { key: 'hour', header: 'Hour', kind: 'title', cell: (d) => formatDateTime(d.timestamp.replace(' ', 'T')) },
    { key: 'used', header: 'Used', kind: 'key', num: true, strong: true, cell: (d) => <>{kwh(Number(d.usageKwh), 2)} <span className="fp-unit">kWh</span></> },
    {
      key: 'level',
      header: 'Level',
      cell: (d) => {
        const l = hourLevel(Number(d.usageKwh));
        return <Badge tone={l.tone}>{l.word}</Badge>;
      },
    },
    { key: 'cost', header: 'Cost', num: true, cell: (d) => formatMoney(Number(d.usageKwh) * rate) },
    {
      key: 'outside',
      header: 'Outside',
      num: true,
      cell: (d) => <span className="fp-mono">{formatTemp(weatherByHour.get(d.timestamp.replace(' ', 'T').substring(0, 13)))}</span>,
    },
  ];
  return (
    <div className="fp-stack fp-stack--m">
      <p className="fp-small fp-muted fp-cluster">
        <Badge>Low</Badge> under 2 kWh <Badge tone="headsup">Moderate</Badge> 2 to under 5 <Badge tone="problem">High</Badge> 5 and up
      </p>
      <ShowMore
        items={rows}
        first={8}
        noun="hours"
        render={(part) => <DataTable rowKey={(d) => d.id} rows={part} columns={columns} caption="Hourly readings" />}
      />
    </div>
  );
}
