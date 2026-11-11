import { memo, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchHostHealth, fetchHostHistory } from '../../api/host';
import {
  Badge,
  Chips,
  DialLegend,
  Disclosure,
  EmptyState,
  ErrorState,
  Gauge,
  InstrumentPanel,
  KeyValue,
  KV,
  Lamp,
  List,
  Loading,
  Meter,
  MeterRow,
  Num,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Row,
  Screen,
  SkelBlock,
  SkelInstrumentPanel,
  SkelPanel,
  Split,
  Verdict,
  useChartTheme,
  type ChartTone,
  type LegendItem,
} from '../../components/ui';
import { usePageMeta } from '../../components/shell/PageMeta';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import {
  formatDateTime,
  formatDuration,
  formatDurationBetween,
  formatHour,
  formatRelative,
  formatShortDate,
  formatStamp,
  formatTime,
  formatWeekday,
  plural,
} from '../../utils/format';
import { checkStatus, worstTone, type Tone } from '../../utils/status';
import { bits, bytes, eventDetail, eventLabel, pct, perSecond, powerEvents, processLabel, usedPct } from '../../utils/host';
import type { HostCheck, HostContainer, HostHealth, HostHistory, HostPoint, HostProcess, HostRange, HostSnapshot } from '../../types';

/*
 * Admin → Server health. The NUC's monitor (scripts/host-metrics.ps1) reports once a minute.
 * Temperatures come from Windows in Celsius and are shown in °C, labelled, as the monitor and
 * its alerts state them (converting would make the thresholds below disagree with the alerts).
 */

/** "Just now" mid-sentence; a date keeps its capital. */
const inSentence = (rel: string) => (rel === 'Just now' || rel === 'Yesterday' ? rel.toLowerCase() : rel);

/** The heads-up and problem lines for each vital (the same ones the old tiles coloured at). */
const LIMITS = {
  cpu: [85, 95],
  memory: [90, 95],
  disk: [85, 95],
  temp: [85, 95],
} as const;

function levelTone(v: number | null | undefined, [warn, bad]: readonly [number, number]): Tone {
  if (v == null) return 'neutral';
  return v >= bad ? 'problem' : v >= warn ? 'headsup' : 'ok';
}
const GAUGE_TONE: Record<Tone, ChartTone> = { ok: 'ink', neutral: 'ink', info: 'ink', headsup: 'warn', problem: 'problem' };
const zones = ([warn, bad]: readonly [number, number], max: number) => [
  { from: warn, to: bad, tone: 'warn' as const },
  { from: bad, to: max, tone: 'problem' as const },
];

// ── The instrument: six gauges ──

interface Vital {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  /** The centre figure, already formatted. */
  shown: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone: Tone;
  zones?: Array<{ from: number; to: number; tone: ChartTone }>;
  /** What a screen reader hears for the gauge. */
  spoken: string;
}

function VitalGauge({ v }: { v: Vital }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <Gauge value={v.value} min={v.min} max={v.max} tone={GAUGE_TONE[v.tone]} zones={v.zones} size={132} label={v.spoken}>
        <div className="fp-dial-centre pt-[6%]">
          <Num size="m" value={v.shown} unit={v.unit} className="whitespace-nowrap" />
        </div>
      </Gauge>
      <span className="fp-label inline-flex items-center gap-1.5">
        {v.tone === 'headsup' || v.tone === 'problem' ? <Lamp tone={v.tone} size="s" label /> : null}
        {v.label}
      </span>
      {v.sub != null && <span className="text-xs leading-tight text-apptext-muted">{v.sub}</span>}
    </div>
  );
}

function vitals(s: HostSnapshot, now: number): Vital[] {
  const memUsed = usedPct(s.memory?.totalBytes, s.memory?.availableBytes);
  const sys = s.disks?.find((d) => d.name === 'C:') ?? s.disks?.[0];
  const diskUsed = usedPct(sys?.totalBytes, sys?.freeBytes);
  const cpuTemp = s.temperatures?.length ? Math.max(...s.temperatures.map((t) => t.celsius)) : null;
  const ssdTemp = s.physicalDisks?.find((d) => d.temperatureC != null)?.temperatureC ?? null;
  const cpu = s.cpu?.usagePct ?? null;
  const rx = s.network?.rxBps;
  // Network spans kbps to Gbps, so its gauge is logarithmic: 1 kbps at the bottom, 1 Gbps at the top.
  const rxLog = rx != null && rx > 0 ? Math.max(0, Math.log10((rx * 8) / 1000)) : 0;
  const upMin = s.host?.bootTime ? (now - new Date(s.host.bootTime).getTime()) / 60_000 : null;
  return [
    {
      key: 'cpu', label: 'Processor', value: cpu ?? 0, min: 0, max: 100, shown: cpu == null ? '—' : Math.round(cpu), unit: cpu == null ? undefined : '%',
      sub: 'Last minute', tone: levelTone(cpu, LIMITS.cpu), zones: zones(LIMITS.cpu, 100), spoken: `Processor ${pct(cpu)}`,
    },
    {
      key: 'mem', label: 'Memory', value: memUsed ?? 0, min: 0, max: 100, shown: memUsed == null ? '—' : Math.round(memUsed), unit: memUsed == null ? undefined : '%',
      sub: s.memory?.totalBytes ? `${bytes((s.memory.totalBytes ?? 0) - (s.memory.availableBytes ?? 0))} of ${bytes(s.memory.totalBytes)}` : undefined,
      tone: levelTone(memUsed, LIMITS.memory), zones: zones(LIMITS.memory, 100), spoken: `Memory ${pct(memUsed)} in use`,
    },
    {
      key: 'disk', label: sys ? `Drive ${sys.name}` : 'Drive', value: diskUsed ?? 0, min: 0, max: 100,
      shown: diskUsed == null ? '—' : Math.round(diskUsed), unit: diskUsed == null ? undefined : '%',
      sub: sys ? `${bytes(sys.freeBytes)} free` : undefined, tone: levelTone(diskUsed, LIMITS.disk), zones: zones(LIMITS.disk, 100),
      spoken: `${sys ? `Drive ${sys.name}` : 'Drive'} ${pct(diskUsed)} full`,
    },
    {
      key: 'temp', label: 'Temperature', value: cpuTemp ?? 20, min: 20, max: 100,
      shown: cpuTemp == null ? '—' : Math.round(cpuTemp), unit: cpuTemp == null ? undefined : '°C',
      sub: ssdTemp != null ? `SSD ${Math.round(ssdTemp)} °C` : 'Processor', tone: levelTone(cpuTemp, LIMITS.temp), zones: zones(LIMITS.temp, 100),
      spoken: cpuTemp == null ? 'Temperature unknown' : `Processor ${Math.round(cpuTemp)} degrees Celsius`,
    },
    {
      key: 'net', label: 'Network', value: rxLog, min: 0, max: 6, shown: bits(rx).split(' ')[0], unit: bits(rx).split(' ')[1],
      sub: `Up ${bits(s.network?.txBps)}${s.network?.wifi?.signalPct != null ? ` · Wi‑Fi ${s.network.wifi.signalPct}%` : ''}`,
      tone: 'neutral', spoken: `Download ${bits(rx)}, upload ${bits(s.network?.txBps)}`,
    },
    {
      key: 'up', label: 'Up for', value: upMin == null ? 0 : Math.min(30, upMin / 1440), min: 0, max: 30,
      // The centre has room for one figure: whole days (hours on the first day); the sub line has it all.
      shown: upMin == null ? '—' : upMin >= 1440 ? Math.floor(upMin / 1440) : Math.floor(upMin / 60),
      unit: upMin == null ? undefined : upMin >= 1440 ? (upMin < 2880 ? 'day' : 'days') : 'hr',
      sub: s.host?.bootTime ? `${formatDurationBetween(s.host.bootTime, now)}, since ${formatStamp(s.host.bootTime)}` : undefined, tone: 'neutral',
      spoken: upMin == null ? 'Uptime unknown' : `Up for ${formatDurationBetween(s.host?.bootTime, now)}`,
    },
  ];
}

function Cluster({ s, now }: { s: HostSnapshot; now: number }) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="grid w-full max-w-[480px] grid-cols-3 gap-x-2.5 gap-y-4 lg:gap-x-4 lg:gap-y-5">
        {vitals(s, now).map((v) => <VitalGauge key={v.key} v={v} />)}
      </div>
      <DialLegend items={[{ label: 'Heads-up', tone: 'warn', key: 'mark' }, { label: 'Problem', tone: 'problem', key: 'mark' }]} />
    </div>
  );
}

function Answer({ data, s, now }: { data: HostHealth; s: HostSnapshot | null; now: number }) {
  const online = data.status === 'ONLINE';
  const checks = data.checks;
  // The verdict's lamp is the worst thing listed under it.
  const tone: Tone = worstTone(checks.map((c) => checkStatus(c.level).tone));
  const first = checks[0];
  const sys = s?.disks?.find((d) => d.name === 'C:') ?? s?.disks?.[0];
  const containers = s?.docker?.containers ?? [];
  const running = containers.filter((c) => c.state === 'running').length;
  const events = powerEvents(s?.events);
  const restarts = events.filter((e) => e.kind === 'boot' || e.kind === 'unexpected');
  const unexpected = events.filter((e) => e.kind === 'unexpected').length;
  const diskTone = levelTone(usedPct(sys?.totalBytes, sys?.freeBytes), LIMITS.disk);

  const verdict = !online ? (
    <Verdict
      tone="problem"
      note={s ? `Last readings, from ${formatDateTime(s.collectedAt)}. They update once the monitor reports again.` : 'Nothing has come in yet.'}
    >
      The health monitor stopped reporting.
    </Verdict>
  ) : first ? (
    <Verdict tone={tone} note={checks.length > 1 ? `${first.detail} ${plural(checks.length - 1, 'other thing')} below.` : first.detail}>
      {first.title}.
    </Verdict>
  ) : (
    <Verdict tone="ok" note="All good: nothing on the NUC needs attention.">The home server is healthy.</Verdict>
  );

  return (
    <InstrumentPanel
      instrument={s ? <Cluster s={s} now={now} /> : <EmptyState compact icon="server" title="No readings yet" />}
      verdict={verdict}
      readouts={
        s ? (
          <Readouts count={3}>
            <Readout
              label={sys ? `Free on ${sys.name}` : 'Free space'}
              tone={diskTone === 'ok' ? undefined : diskTone}
              value={bytes(sys?.freeBytes).split(' ')[0]}
              unit={bytes(sys?.freeBytes).split(' ')[1]}
              note={sys ? `Of ${bytes(sys.totalBytes)}` : undefined}
            />
            <Readout
              label="Containers"
              value={s.docker?.ok ? running : '—'}
              unit={s.docker?.ok ? `of ${containers.length}` : undefined}
              note={s.docker?.ok ? 'Running' : "Docker isn't answering"}
            />
            <Readout label="Restarts" value={restarts.length} note={`Last 30 days${unexpected ? `, ${unexpected} unexpected` : ''}`} />
          </Readouts>
        ) : undefined
      }
      foot={
        <>
          <span className="fp-cluster">
            <Lamp tone={online ? 'ok' : 'problem'} size="s" />
            <span className="fp-mono">
              {online
                ? `Reported ${inSentence(formatRelative(data.lastReportAt))}`
                : `Monitor offline · last report ${data.lastReportAt ? inSentence(formatRelative(data.lastReportAt)) : 'never'}`}
            </span>
          </span>
          {s?.agent?.durationMs != null && <span className="fp-mono">Report took {(s.agent.durationMs / 1000).toFixed(1)} s</span>}
        </>
      }
    >
      {checks.length > 0 && <Checks checks={checks} />}
    </InstrumentPanel>
  );
}

/** Everything the server flags, worst first, each with its word as well as its lamp. */
function Checks({ checks }: { checks: HostCheck[] }) {
  return (
    <section aria-label="Needs attention">
      <List inset>
        {checks.map((c, i) => (
          <Row key={`${c.key}-${i}`} compact lamp={checkStatus(c.level).tone} title={c.title} meta={c.detail} />
        ))}
      </List>
    </section>
  );
}

// ── History charts ──

const CHART_MARGIN = { top: 5, right: 8, left: 0, bottom: 0 } as const;

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
] as const;

function formatTick(t: number, range: HostRange): string {
  if (range === '24h') return formatHour(t);
  if (range === '7d') return formatWeekday(t);
  return formatShortDate(t);
}

interface Series { key: keyof HostPoint; label: string; tone: 'ink' | 'heat' | 'cool' | 'graphite'; dashed?: boolean }

const MetricChart = memo(function MetricChart({ title, note, series, data, domain, ticks, unit, range, digits = 0 }: {
  title: string;
  note?: string;
  series: Series[];
  data: Array<Record<string, number | null>>;
  domain: [number | string, number | string];
  ticks?: number[];
  unit: string;
  range: HostRange;
  digits?: number;
}) {
  // Hooks first (the chart rule), then the drawing.
  const t = useChartTheme();
  const narrow = useMediaQuery('(max-width: 639px)');
  const hasData = data.some((p) => series.some((s) => p[s.key] != null));
  const legend: LegendItem[] = series.map((s) => ({ label: s.label, tone: s.tone, key: s.dashed ? 'dash' : 'line' }));
  return (
    <figure className="m-0 min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <figcaption className="fp-label">{title}</figcaption>
        {note && <span className="fp-mono text-xs text-apptext-muted">{note}</span>}
      </div>
      {series.length > 1 && <DialLegend items={legend} className="mb-2 justify-start" />}
      {!hasData ? (
        <EmptyState compact title="Nothing to draw yet">The line fills in as the NUC reports, once a minute.</EmptyState>
      ) : (
        <ResponsiveContainer width="100%" height={150} debounce={80}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...t.grid} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} {...t.axis}
              tickFormatter={(v: number) => formatTick(v, range)} minTickGap={narrow ? 48 : 32} />
            <YAxis domain={ticks ? [ticks[0], ticks[ticks.length - 1]] : domain} ticks={ticks} width={40} {...t.axis} allowDecimals={digits > 0} />
            <Tooltip
              {...t.tooltip}
              // B-039: a 7- or 30-day chart names the date, not only a weekday.
              labelFormatter={(v: number) => formatDateTime(v)}
              formatter={(value: number, key: string) => [
                `${Number(value).toFixed(digits)} ${unit}`.trim(),
                series.find((s) => s.key === key)?.label ?? key,
              ]}
            />
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} type="monotone" stroke={t.series[s.tone]} strokeWidth={2} dot={false}
                strokeDasharray={s.dashed ? t.dash : undefined} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
});

/** Round ticks a little beyond the data (35, 45, 55 °C) for series without a fixed 0–100 scale. */
function roundTicks(data: Array<Record<string, number | null>>, keys: string[]): number[] | undefined {
  const values = data.flatMap((p) => keys.map((k) => p[k])).filter((v): v is number => v != null);
  if (!values.length) return undefined;
  const lo = Math.floor((Math.min(...values) - 3) / 5) * 5;
  const hi = Math.ceil((Math.max(...values) + 3) / 5) * 5;
  const step = hi - lo > 30 ? 10 : 5;
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

function History({ range, onRange, history, loading, failed, onRetry, retrying }: {
  range: HostRange;
  onRange: (r: HostRange) => void;
  history: HostHistory | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const data = useMemo(
    () => (history?.points ?? []).map((p) => ({ ...p, t: new Date(p.t).getTime() }) as unknown as Record<string, number | null>),
    [history],
  );
  const tempTicks = useMemo(() => roundTicks(data, ['cpuTempC', 'diskTempC']), [data]);
  const sum = history?.summary;
  const fresh = history?.firstSampleAt && new Date(history.firstSampleAt).getTime() > new Date(history.from).getTime() + 3_600_000;
  return (
    <Panel
      title="History"
      subtitle={fresh ? `Recording since ${formatDateTime(history?.firstSampleAt)}; earlier times are blank` : 'Averages for each stretch of the range'}
      action={<Chips label="History range" value={range} onChange={onRange} options={RANGES} />}
    >
      {!history && failed ? (
        <ErrorState compact title="Couldn't load the history" onRetry={onRetry} retrying={retrying} />
      ) : loading && !history ? (
        <Loading label="Loading the history"><SkelBlock height={200} /></Loading>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
          <MetricChart title="Processor" unit="%" range={range} data={data} domain={[0, 100]}
            note={sum?.cpuAvg != null ? `avg ${pct(sum.cpuAvg)} · busiest minute ${pct(sum.cpuPeak)}` : undefined}
            series={[{ key: 'cpuAvg', label: 'Processor', tone: 'ink' }]} />
          <MetricChart title="Memory in use" unit="%" range={range} data={data} domain={[0, 100]}
            note={sum?.memAvgPct != null ? `avg ${pct(sum.memAvgPct)} · peak ${pct(sum.memPeakPct)}` : undefined}
            series={[{ key: 'memPct', label: 'Memory', tone: 'ink' }]} />
          <MetricChart title="Temperature, °C" unit="°C" range={range} data={data} domain={['auto', 'auto']} ticks={tempTicks}
            note={sum?.cpuTempPeak != null ? `hottest ${Math.round(sum.cpuTempPeak)} °C` : undefined}
            series={[{ key: 'cpuTempC', label: 'Processor', tone: 'heat' }, { key: 'diskTempC', label: 'SSD', tone: 'cool' }]} />
          <MetricChart title="Home network, Mbps" unit="Mbps" digits={2} range={range} data={data} domain={[0, 'auto']}
            note={sum?.rxBytes != null ? `↓ ${bytes(sum.rxBytes)} · ↑ ${bytes(sum.txBytes)}` : undefined}
            series={[{ key: 'rxMbps', label: 'Download', tone: 'ink' }, { key: 'txMbps', label: 'Upload', tone: 'graphite', dashed: true }]} />
        </div>
      )}
      {history && history.gaps.length > 0 && (
        <div className="mt-5">
          <p className="fp-label mb-2">Times it went quiet</p>
          <List inset>
            {[...history.gaps].reverse().map((g) => (
              <Row
                key={g.from}
                compact
                lamp="neutral"
                title={`${formatDateTime(g.from)} – ${formatTime(g.to)}`}
                meta={g.restarted ? 'It restarted' : 'The monitor missed its checks'}
                value={formatDuration(g.minutes)}
              />
            ))}
          </List>
        </div>
      )}
    </Panel>
  );
}

// ── Detail panels ──

function containerStatus(c: HostContainer): { tone: Tone; label: string } {
  if (c.state === 'running') {
    return c.health === 'unhealthy' ? { tone: 'headsup', label: 'Running · unhealthy' } : { tone: 'ok', label: c.health === 'healthy' ? 'Running · healthy' : 'Running' };
  }
  if (c.state === 'restarting') return { tone: 'headsup', label: 'Restarting' };
  return { tone: c.name.startsWith('homeplatform-') ? 'problem' : 'neutral', label: c.status ?? c.state ?? 'Stopped' };
}

function Containers({ docker }: { docker: HostSnapshot['docker'] }) {
  if (!docker) return null;
  const list = [...(docker.containers ?? [])].sort((a, b) =>
    (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || (b.memBytes ?? 0) - (a.memBytes ?? 0));
  const running = list.filter((c) => c.state === 'running').length;
  return (
    <Panel
      title="Containers"
      subtitle={docker.ok
        ? `${running} of ${list.length} running · Docker ${docker.version ?? ''}${docker.memTotalBytes ? ` · ${bytes(docker.memTotalBytes)} VM` : ''}`
        : undefined}
    >
      {!docker.ok ? (
        <EmptyState compact title="Docker isn't responding">
          {docker.error ?? 'No answer from Docker.'} Container details come back once it does.
        </EmptyState>
      ) : (
        <List>
          {list.map((c) => {
            const st = containerStatus(c);
            return (
              <Row
                key={c.name}
                title={<span className="break-all">{c.name}</span>}
                meta={c.state === 'running' ? `${pct(c.cpuPct, 1)} processor · ${bytes(c.memBytes)}` : c.image ?? undefined}
                trail={<Badge tone={st.tone} className="whitespace-nowrap">{st.label}</Badge>}
              />
            );
          })}
        </List>
      )}
    </Panel>
  );
}

function Storage({ s, app }: { s: HostSnapshot; app: HostHealth['app'] }) {
  return (
    <Panel title="Storage">
      <div className="fp-stack">
        {(s.disks ?? []).map((d) => {
          const used = usedPct(d.totalBytes, d.freeBytes);
          return (
            <MeterRow key={d.name} label={<strong>Drive {d.name}{d.label ? ` (${d.label})` : ''}</strong>} value={`${pct(used)} full`}>
              <Meter value={(used ?? 0) / 100} segments={20} label={`Drive ${d.name} used`} tone={levelTone(used, LIMITS.disk) === 'ok' ? 'neutral' : levelTone(used, LIMITS.disk)} valueText={`${pct(used)} full`} />
              <span className="fp-small fp-muted col-span-full">
                {bytes(d.freeBytes)} free of {bytes(d.totalBytes)} · reading {perSecond(d.readBps)}, writing {perSecond(d.writeBps)}
              </span>
            </MeterRow>
          );
        })}
        <KeyValue>
          {(s.physicalDisks ?? []).map((p) => (
            <KV
              key={p.name ?? 'disk'}
              label={`${p.mediaType && p.mediaType !== 'Unspecified' ? p.mediaType : 'Disk'}${p.name ? `, ${p.name}` : ''}`}
              tone={p.health === 'Healthy' ? undefined : 'problem'}
              value={[
                p.health ?? 'Unknown',
                p.temperatureC != null ? `${Math.round(p.temperatureC)} °C` : null,
                p.wearPct != null ? `${p.wearPct}% worn` : null,
              ].filter(Boolean).join(' · ')}
            />
          ))}
          {app?.databaseBytes != null && <KV kind="group" label="This app's database" value={bytes(app.databaseBytes)} />}
          {(app?.largestTables ?? []).slice(0, 4).map((t) => (
            <KV key={t.name} kind="sub" label={<span className="fp-mono">{t.name}</span>} value={bytes(t.bytes)} />
          ))}
        </KeyValue>
      </div>
    </Panel>
  );
}

function Power({ s }: { s: HostSnapshot }) {
  const events = powerEvents(s.events);
  const head = events.slice(0, 6);
  const rest = events.slice(6, 12);
  const row = (e: (typeof events)[number], i: number) => (
    <Row
      key={`${e.at}-${e.id}-${i}`}
      compact
      lamp={e.kind === 'unexpected' ? 'headsup' : 'neutral'}
      title={eventLabel(e.kind)}
      meta={<>{eventDetail(e) ? `${eventDetail(e)} · ` : ''}<span className="fp-mono">{formatDateTime(e.at)}</span></>}
    />
  );
  return (
    <Panel title="Power and restarts" subtitle="From the Windows event log">
      <KeyValue cols>
        <KV label="Last started" value={formatDateTime(s.host?.bootTime)} />
        <KV label="Power plan" value={s.power?.plan ?? '—'} />
        <KV label="Sleeps after" value={s.power?.sleepAfterMinutes == null ? '—' : s.power.sleepAfterMinutes === 0 ? 'Never' : `${s.power.sleepAfterMinutes} min`} />
        <KV
          label="Windows updates"
          tone={s.power?.pendingReboot ? 'headsup' : undefined}
          value={s.power?.pendingReboot ? 'Waiting on a restart' : 'Nothing pending'}
        />
      </KeyValue>
      {head.length > 0 && (
        <div className="mt-4">
          <p className="fp-label mb-2">Last 30 days</p>
          <List inset cols>{head.map(row)}</List>
          {rest.length > 0 && (
            <Disclosure summary={`Show ${plural(rest.length, 'older event')}`} openSummary="Hide older events" className="mt-2">
              <List inset cols>{rest.map(row)}</List>
            </Disclosure>
          )}
        </div>
      )}
    </Panel>
  );
}

function ProcessList({ title, rows, value }: { title: string; rows: HostProcess[]; value: (p: HostProcess) => string }) {
  return (
    <div className="min-w-0">
      <p className="fp-label mb-1">{title}</p>
      <KeyValue>
        {rows.map((p) => (
          <KV key={p.name} label={<>{processLabel(p.name)}{p.count && p.count > 1 ? <span className="fp-muted"> ×{p.count}</span> : null}</>} value={value(p)} />
        ))}
      </KeyValue>
    </div>
  );
}

function Processes({ s }: { s: HostSnapshot }) {
  if (!s.topCpu?.length && !s.topMemory?.length) return null;
  return (
    <Panel flush aria-label="What's using it">
      <Disclosure variant="row" summary="What's using it" openSummary="What's using it">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <ProcessList title="Busiest (last minute)" rows={s.topCpu ?? []} value={(p) => pct(p.cpuPct, 1)} />
          <ProcessList title="Most memory" rows={s.topMemory ?? []} value={(p) => bytes(p.memBytes)} />
        </div>
      </Disclosure>
    </Panel>
  );
}

/** The machine's particulars. KeyValue wraps a long value under itself instead of cutting it off (B-179). */
function About({ s, app }: { s: HostSnapshot; app: HostHealth['app'] }) {
  const n = s.network;
  const w = n?.wifi;
  return (
    <Panel flush aria-label="About this machine">
      <Disclosure variant="row" summary="About this machine" openSummary="About this machine">
        <KeyValue>
          <KV label="Model" value={s.host?.model ?? '—'} />
          <KV label="Windows" value={[s.host?.os, s.host?.osBuild].filter(Boolean).join(' · ') || '—'} />
          <KV
            label="Processor"
            value={`${s.host?.cpuModel ?? '—'}${s.host?.cores ? ` · ${s.host.cores} cores, ${s.host.logicalProcessors} threads` : ''}`}
          />
          <KV label="Memory" value={bytes(s.memory?.totalBytes)} />
          {(s.physicalDisks ?? []).map((p) => (
            <KV key={p.name ?? 'disk'} label="Drive" value={[p.name, bytes(p.sizeBytes)].filter(Boolean).join(' · ')} />
          ))}
          <KV label="Network" value={[n?.adapter, n?.ip].filter(Boolean).join(' · ') || '—'} />
          {w && (
            <KV
              label="Wi-Fi"
              value={[w.ssid, w.band, w.channel ? `channel ${w.channel}` : null, w.signalPct != null ? `${w.signalPct}% signal` : null,
                w.rxMbps ? `${w.rxMbps} Mbps link` : null].filter(Boolean).join(' · ')}
            />
          )}
          <KV
            label="Remote access (Tailscale)"
            tone={n?.tailscaleUp === false ? 'problem' : undefined}
            value={n?.tailscaleUp == null ? '—' : n.tailscaleUp ? 'Connected' : 'Down'}
          />
          {app && (
            <KV
              label="This app's server"
              value={`${bytes(app.heapUsedBytes)} of ${bytes(app.heapMaxBytes)} memory · up ${app.uptimeSeconds != null ? formatDuration(app.uptimeSeconds / 60) : '—'}`}
            />
          )}
          {s.agent?.durationMs != null && <KV label="Monitor" value={`checked in ${(s.agent.durationMs / 1000).toFixed(1)} s`} />}
        </KeyValue>
      </Disclosure>
    </Panel>
  );
}

function NotSetUp() {
  return (
    <Panel title="Set up the NUC's health monitor" subtitle="The page fills in once the NUC starts reporting">
      <p className="fp-small fp-muted">
        On the NUC, from an admin prompt in the repo folder, run <code className="fp-mono rounded bg-appinset px-1 py-0.5">scripts\install-host-metrics-task.cmd</code>.
        It adds a task that checks the NUC every minute. The first numbers show up within two minutes.
      </p>
    </Panel>
  );
}

export default function NucHealth() {
  const healthInterval = useJitteredInterval(30_000);
  const [range, setRange] = useState<HostRange>('24h');
  const historyInterval = useJitteredInterval(range === '24h' ? 60_000 : 300_000);
  const health = useQuery({
    queryKey: ['admin-host'],
    queryFn: fetchHostHealth,
    staleTime: 20_000,
    refetchInterval: healthInterval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const history = useQuery({
    queryKey: ['admin-host-history', range],
    queryFn: () => fetchHostHistory(range),
    staleTime: 30_000,
    refetchInterval: historyInterval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    enabled: health.data != null && health.data.status !== 'NOT_SET_UP',
  });
  usePageMeta({ subtitle: health.dataUpdatedAt ? `Checked ${formatTime(health.dataUpdatedAt)}` : undefined });

  const historyPanel = (
    <History
      range={range}
      onRange={setRange}
      history={history.data}
      loading={history.isLoading}
      failed={history.isError}
      onRetry={() => void history.refetch()}
      retrying={history.isFetching}
    />
  );

  // A failed poll keeps the last readings with a slim notice (B-187), which matters most
  // exactly when the server is struggling; only a failed first load replaces the page.
  return (
    <Screen>
      <QueryState
        query={health}
        what="the server's health"
        loading={<><SkelInstrumentPanel readouts={3} /><SkelPanel chart /></>}
        isEmpty={() => false}
      >
        {(data) => {
          if (data.status === 'NOT_SET_UP') return <NotSetUp />;
          const s = data.latest;
          const now = new Date(data.now).getTime();
          return (
            <>
              <Answer data={data} s={s} now={now} />
              {historyPanel}
              {s ? (
                <>
                  <Split ratio="even">
                    <Containers docker={s.docker} />
                    <Storage s={s} app={data.app} />
                  </Split>
                  <Power s={s} />
                  <Split ratio="even">
                    <Processes s={s} />
                    <About s={s} app={data.app} />
                  </Split>
                </>
              ) : (
                <EmptyState compact title="The latest details show up with the next report" />
              )}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
