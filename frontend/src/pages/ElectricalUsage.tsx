import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';
import DeferredRender from '../components/DeferredRender';
import VirtualizedList from '../components/VirtualizedList';
import UsageSummaryGrid from '../components/UsageSummaryGrid';
import { fetchBatchSummaries } from '../api/energy';
import { fetchWeatherForRange } from '../api/weather';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { buildUsagePeriods, createEmptyUsageSummary, dailyTrendSeries, averageCompleteDailyKwh } from '../utils/usageSummary';
import { isHourlySource } from '../utils/usageSource';
import UsageWeatherChart from '../components/UsageWeatherChart';
import { useTheme, CHART_SERIES } from '../context/ThemeContext';

type LogFilter = 'daily' | 'hourly';

export default memo(function ElectricalUsage() {
  const { electricUsage, electricTotal, electricMeter, config, electricDaily } = useUsageData();
  const [logFilter, setLogFilter] = useState<LogFilter>('daily');
  const weatherInterval = useJitteredInterval(3_600_000, 60_000);

  // Usage visuals (trend line + monthly bars) follow the theme accent so they
  // match the palette instead of a hardcoded green (see CHART_SERIES).
  const { theme, palette } = useTheme();
  const usageColor = (CHART_SERIES[palette] ?? CHART_SERIES.default)[theme].usage;

  const data = electricUsage.data ?? [];
  const loading = electricUsage.isLoading;
  const monthKwh = electricTotal.data?.totalKwh ?? 0;
  const kwhRate = config.data?.kwhRate ?? 0.1171;

  const today = new Date().toISOString().split('T')[0];
  const realData = useMemo(
    () =>
      data.filter((d) => {
        if (!d || typeof d.timestamp !== 'string' || d.timestamp.length < 10) return false;
        const usage = Number(d.usageKwh);
        return Number.isFinite(usage) && usage > 0;
      }),
    [data]
  );

  const timestampMs = (timestamp: string): number => {
    const ms = new Date(timestamp).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };

  // Daily trend line is driven by the server's pre-aggregated per-day totals
  // (a single GROUP BY on the backend), NOT a client-side sum of point-capped
  // hourly rows — the latter downsampled ~1,440 hourly rows to 500 before summing,
  // so each day showed only ~1/3 of its real kWh (see git history / ISSUES).
  const trendPoints = useMemo(
    () => dailyTrendSeries(electricDaily.data ?? []),
    [electricDaily.data]
  );

  // ── Daily aggregates from hourly data ──────────────────────────
  const dailyFromHourly = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const d of realData) {
      if (!isHourlySource(d.source)) continue;
      const date = d.timestamp.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + Number(d.usageKwh));
    }
    return Array.from(byDate.entries())
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first
  }, [realData]);

  // ── Hourly record counts per date (single scan, reused by latestDaily + dailyLogData) ──
  const hourlyCountByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of realData) {
      if (!isHourlySource(r.source)) continue;
      const date = r.timestamp.slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return counts;
  }, [realData]);

  // Last reading = most recent day that has 24 complete hourly records
  const latestDaily = useMemo(() => {
    for (const d of dailyFromHourly) {
      if ((hourlyCountByDate.get(d.date) ?? 0) >= 20) return d;
    }
    return dailyFromHourly.length > 0 ? dailyFromHourly[0] : null;
  }, [dailyFromHourly, hourlyCountByDate]);

  // ── 7-day and 30-day averages ──────────────────────────────────
  // Count only COMPLETE days (>= COMPLETE_DAY_MIN_HOURS hourly rows) from the
  // server's daily aggregates, so the still-syncing current day and any
  // under-posted day don't get averaged in as if they were full days.
  const avg7 = useMemo(() => averageCompleteDailyKwh(electricDaily.data ?? [], 7), [electricDaily.data]);
  const avg30 = useMemo(() => averageCompleteDailyKwh(electricDaily.data ?? [], 30), [electricDaily.data]);

  // ── Date periods for summaries ─────────────────────────────────
  const todayDate = new Date().toISOString().split('T')[0];
  const periodDefinitions = useMemo(
    () => buildUsagePeriods(config.data?.dataStartDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.data?.dataStartDate, todayDate]
  );

  // ── Weather query ──────────────────────────────────────────────
  const weatherStart = periodDefinitions.length > 0
    ? periodDefinitions[periodDefinitions.length - 1].start.slice(0, 10)
    : '';
  const weatherEnd = today;

  const { data: weather } = useQuery({
    queryKey: ['weather', weatherStart, weatherEnd],
    queryFn: () => fetchWeatherForRange(weatherStart, weatherEnd),
    enabled: weatherStart !== '' && weatherEnd !== '',
    staleTime: 3_600_000,
    refetchInterval: weatherInterval,
    refetchIntervalInBackground: false,
  });

  const weatherByDate = useMemo(() => {
    const map = new Map<string, { mean: number; high: number; low: number }>();
    if (weather?.daily) {
      for (const w of weather.daily) {
        if (typeof w.date !== 'string' || !w.date) continue;
        map.set(w.date, {
          mean: w.meanTemperature,
          high: w.maxTemperature,
          low: w.minTemperature,
        });
      }
    }
    return map;
  }, [weather]);

  const weatherByHour = useMemo(() => {
    const map = new Map<string, number>();
    if (weather?.hourly) {
      for (const h of weather.hourly) {
        if (h.time && h.time.length >= 13) {
          map.set(h.time.substring(0, 13), h.temperature);
        }
      }
    }
    return map;
  }, [weather]);

  // ── Summary query ───────────────────────────────────────────────
  // One batched HTTP call for all periods instead of N parallel ones —
  // same data, same shape, fewer round-trips.
  const periodsKey = periodDefinitions.map((p) => `${p.start}:${p.end}`).join('|');
  const batchSummary = useQuery({
    queryKey: ['usage-summaries', electricMeter?.id, periodsKey],
    queryFn: () =>
      electricMeter
        ? fetchBatchSummaries(electricMeter.id, periodDefinitions.map((p) => ({ start: p.start, end: p.end })))
        : Promise.resolve(periodDefinitions.map((p) => createEmptyUsageSummary(0, p.start, p.end))),
    enabled: !!electricMeter && periodDefinitions.length > 0,
    staleTime: 30_000,
  });

  // Memoized — the per-period weather reductions (O(periods × weatherDays))
  // otherwise re-run on every render (60s usage poll, theme change, daily/hourly
  // toggle) and hand a fresh array to the un-memoized UsageSummaryGrid.
  const summaryCards = useMemo(() => periodDefinitions.map((period, index) => {
    const s = batchSummary.data?.[index] ??
      createEmptyUsageSummary(electricMeter?.id ?? 0, period.start, period.end);
    const periodWx = Array.from(weatherByDate.entries())
      .filter(([date]) => date >= period.start.slice(0, 10) && date <= period.end.slice(0, 10));
    const temps = periodWx.flatMap(([, w]) => [w.high, w.low, w.mean]).filter((t) => t > 0);
    const wxAvg = temps.length ? Math.round(temps.reduce((s, t) => s + t, 0) / temps.length) : null;
    const wxHigh = periodWx.length ? Math.round(Math.max(...periodWx.map(([, w]) => w.high))) : null;
    const wxLow = periodWx.length ? Math.round(Math.min(...periodWx.map(([, w]) => w.low))) : null;
    return {
      label: period.label,
      rangeStart: period.displayStart,
      rangeEnd: period.displayEnd,
      summary: s,
      wxAvg,
      wxHigh,
      wxLow,
    };
  }), [periodDefinitions, batchSummary.data, weatherByDate, electricMeter?.id]);

  const summaryLoading = batchSummary.isLoading;

  // ── Usage log table ────────────────────────────────────────────
  // Daily filter: one row per date (sum of hourly), newest first
  const dailyLogData = useMemo(() => {
    return dailyFromHourly
      .filter((d) => (hourlyCountByDate.get(d.date) ?? 0) >= 18)
      .slice(0, 30);
  }, [dailyFromHourly, hourlyCountByDate]);

  // Hourly filter: raw records, newest first
  const hourlyLogData = useMemo(() => {
    return realData
      .filter((d) => isHourlySource(d.source))
      .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))
      .slice(0, 48);
  }, [realData]);

  // Hourly color bands: green < 2, yellow 2-4, red 5+
  const getHourlyLevel = (kwh: number) => {
    if (kwh >= 5) return { badgeClass: 'border border-rose-300/20 bg-rose-300/10 text-rose-300' };
    if (kwh >= 2) return { badgeClass: 'border border-amber-300/20 bg-amber-300/10 text-amber-300' };
    return { badgeClass: 'border border-emerald-300/20 bg-emerald-300/10 text-emerald-300' };
  };

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Electric Module
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Daily electricity usage with quick cost context.
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Compare recent consumption patterns, track short-term averages, and scan the latest readings without leaving the dashboard workflow.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-appborder bg-appinset p-3 sm:p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-apptext-dim sm:text-[11px]">Rate</p>
              <p className="mt-2 text-base font-semibold text-apptext sm:text-lg">
                ${kwhRate.toFixed(4)}<span className="text-sm text-apptext-muted">/kWh</span>
              </p>
            </div>
            <div className="rounded-2xl border border-appborder bg-appinset p-3 sm:p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-apptext-dim sm:text-[11px]">60-Day Spend</p>
              <p className="mt-2 text-base font-semibold text-apptext sm:text-lg">
                ${(monthKwh * kwhRate).toFixed(2)}
              </p>
            </div>
            <div className="rounded-2xl border border-appborder bg-appinset p-3 sm:p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-apptext-dim sm:text-[11px]">Active Readings</p>
              <p className="mt-2 text-base font-semibold text-apptext sm:text-lg">{realData.length}</p>
            </div>
            {(config.data?.lastSyncCheck || config.data?.lastElectricReading) && (
              <div className="rounded-2xl border border-sky-300/30 bg-sky-300/15 p-3 sm:p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-apptext-muted sm:text-[11px]">Last Updated</p>
                {config.data?.lastElectricReading && (
                  <p className="mt-1 text-xs text-apptext-dim">
                    Data: {new Date(config.data.lastElectricReading).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
                {config.data?.lastSyncCheck && (
                  <p className="text-xs text-apptext-dim">
                    Checked: {new Date(config.data.lastSyncCheck).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <StatTile
          label="Last Reading"
          value={latestDaily ? latestDaily.total.toFixed(1) : '—'}
          unit="kWh"
          loading={loading}
          icon={Icons.Bolt}
          subtitle={latestDaily
            ? new Date(latestDaily.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : undefined}
        />
        <StatTile
          label="60-Day Total"
          value={monthKwh.toFixed(0)}
          unit="kWh"
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="7-Day Avg"
          value={avg7.toFixed(1)}
          unit="kWh/day"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="30-Day Avg"
          value={avg30.toFixed(1)}
          unit="kWh/day"
          loading={loading}
          icon={Icons.Bolt}
        />
      </section>

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
          <UsageChart
            data={realData}
            dailyPoints={trendPoints}
            loading={loading}
            title="Electric usage trend"
            emptyText="No electric usage data yet — readings sync automatically each evening once your utility posts the day's data."
            unitLabel="kWh"
            accentColor={usageColor}
          />
        </DeferredRender>
        <DeferredRender minHeight={360}>
          <MonthlyComparison
            data={realData}
            loading={loading}
            title="Monthly electric comparison"
            emptyText="Not enough electric history for a monthly comparison yet."
            unitLabel="kWh"
            barColor={usageColor}
          />
        </DeferredRender>
      </section>

      {periodDefinitions.length > 0 && (
        <DeferredRender minHeight={380}>
          <UsageWeatherChart
            usageData={realData}
            loading={loading}
            startDate={periodDefinitions[periodDefinitions.length - 1].start}
            endDate={periodDefinitions[periodDefinitions.length - 1].end}
          />
        </DeferredRender>
      )}

      <UsageSummaryGrid
        title="Electric highs, lows, and rolling period totals"
        unitLabel="kWh"
        summaries={summaryCards}
        loading={summaryLoading}
      />

      {/* Usage Log with Daily/Hourly filter */}
      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Usage Log</p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">Recent electric readings</h3>
          </div>
          <div className="flex items-center gap-2">
            {(['daily', 'hourly'] as LogFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  logFilter === f
                    ? 'bg-appaccent-soft text-appaccent-text border border-appaccent-border'
                    : 'text-apptext-muted hover:text-apptext-soft border border-transparent hover:border-appborder'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {/* Legend for the hourly threshold color bands (daily rows are single-color) */}
        {logFilter === 'hourly' && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-apptext-muted">
            <span className="uppercase tracking-[0.14em] text-apptext-dim">Per hour:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-300" /> Low · under 2 kWh
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-300" /> Moderate · 2–4 kWh
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-300" /> High · 5 kWh and up
            </span>
          </div>
        )}
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-2xl bg-appinset" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="text-sm">
              {/* Table header: 3 cols on mobile, 5 cols on md+ */}
              <div className="grid grid-cols-[1.5fr_1fr_0.8fr] md:grid-cols-[1.5fr_1fr_1fr_1fr_0.8fr] border-b border-appborder pb-2 text-left text-apptext-dim">
                <div className="font-medium">Date</div>
                <div className="text-right font-medium">kWh</div>
                <div className="hidden text-right font-medium md:block">Est. Cost</div>
                <div className="hidden text-right font-medium md:block">Temp</div>
                <div className="text-right font-medium">Source</div>
              </div>
              {logFilter === 'daily' ? (
                <VirtualizedList
                  items={dailyLogData}
                  height={432}
                  itemHeight={58}
                  overscan={4}
                  className="mt-1"
                  renderItem={(d) => {
                    const wx = weatherByDate.get(d.date);
                    const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    });
                    return (
                      <div
                        key={d.date}
                        className="grid grid-cols-[1.5fr_1fr_0.8fr] md:grid-cols-[1.5fr_1fr_1fr_1fr_0.8fr] items-center border-b border-appborder-light pr-1 transition-colors hover:bg-appinset"
                      >
                        <div className="py-3 text-apptext-soft">{label}</div>
                        <div className="py-3 text-right tabular-nums">
                          <span className="inline-flex items-center justify-end rounded-full border px-2 py-1 text-sm font-semibold bg-emerald-300/10 border-emerald-300/20 text-emerald-300">
                            {d.total.toFixed(2)}
                          </span>
                        </div>
                        <div className="hidden py-3 text-right tabular-nums text-apptext-soft md:block">
                          ${(d.total * kwhRate).toFixed(2)}
                        </div>
                        <div className="hidden py-3 text-right tabular-nums text-[11px] leading-tight text-apptext-muted md:block">
                          {wx ? (
                            <span>
                              <span className="text-sky-300/70">{Math.round(wx.low)}°</span>{' '}
                              <span className="text-amber-300/70">{Math.round(wx.mean)}°</span>{' '}
                              <span className="text-rose-300/70">{Math.round(wx.high)}°</span>
                            </span>
                          ) : '—'}
                        </div>
                        <div className="py-3 text-right text-apptext-dim">coserv</div>
                      </div>
                    );
                  }}
                />
              ) : (
                <VirtualizedList
                  items={hourlyLogData}
                  height={432}
                  itemHeight={58}
                  overscan={6}
                  className="mt-1"
                  renderItem={(d) => {
                    const level = getHourlyLevel(Number(d.usageKwh));
                    const temp = weatherByHour.get(d.timestamp.replace(' ', 'T').substring(0, 13));
                    const parsed = new Date(d.timestamp);
                    const label = Number.isNaN(parsed.getTime())
                      ? 'Unknown'
                      : parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

                    return (
                      <div
                        key={d.id}
                        className="grid grid-cols-[1.5fr_1fr_0.8fr] md:grid-cols-[1.5fr_1fr_1fr_1fr_0.8fr] items-center border-b border-appborder-light pr-1 transition-colors hover:bg-appinset"
                      >
                        <div className="py-3 text-apptext-soft truncate">{label}</div>
                        <div className="py-3 text-right tabular-nums">
                          <span className={`inline-flex items-center justify-end rounded-full border px-2 py-1 text-sm font-semibold ${level.badgeClass}`}>
                            {Number(d.usageKwh).toFixed(2)}
                          </span>
                        </div>
                        <div className="hidden py-3 text-right tabular-nums text-apptext-soft md:block">
                          ${(Number(d.usageKwh) * kwhRate).toFixed(2)}
                        </div>
                        <div className="hidden py-3 text-right text-[11px] text-apptext-muted md:block">
                          {temp != null ? `${Math.round(temp)}°` : '—'}
                        </div>
                        <div className="py-3 text-right text-apptext-dim">
                          {d.sourceProvider}
                        </div>
                      </div>
                    );
                  }}
                />
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
});
