import { memo, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchHostHealth, fetchHostHistory } from '../../api/host';
import { errorMessage } from '../../api/climate';
import { FOCUS_RING } from '../../components/ThermostatControls';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ago } from '../../utils/cameras';
import { bits, bytes, duration, eventDetail, eventLabel, pct, perSecond, powerEvents, processLabel, since, usedPct, when } from '../../utils/host';
import type { HostCheck, HostContainer, HostHealth, HostHistory, HostPoint, HostProcess, HostRange, HostSnapshot } from '../../types';

function Card({ title, aside, children }: { title?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-appborder bg-appsurface-raised p-4 shadow-[0_10px_28px_var(--appshadow)] sm:p-5">
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-apptext">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** A status word beside a dot, never color alone. */
function Dot({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'off'; children: React.ReactNode }) {
  const dot = { good: 'bg-appsuccess', warn: 'bg-appwarning', bad: 'bg-appdanger', off: 'bg-apptext-dim' }[tone];
  const text = { good: 'text-apptext-success', warn: 'text-apptext-warning', bad: 'text-apptext-danger', off: 'text-apptext-muted' }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${text}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** A labelled value; the headline numbers row. */
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-apptext-danger' : tone === 'warn' ? 'text-apptext-warning' : 'text-apptext';
  return (
    <div className="min-w-0 rounded-[20px] border border-appborder bg-appsurface-raised p-4 shadow-[0_8px_24px_var(--appshadow)] sm:rounded-[24px]">
      <p className="text-2xs font-medium uppercase tracking-[0.16em] text-apptext-muted">{label}</p>
      <p className={`mt-2 truncate text-2xl font-semibold tracking-[-0.03em] tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-apptext-dim" title={sub}>{sub}</p>}
    </div>
  );
}

/** A thin used/free bar with the share written beside it. */
function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const fill = v >= 95 ? 'bg-appdanger' : v >= 85 ? 'bg-appwarning' : 'bg-appaccent';
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-appinset" role="meter" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(v)}>
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-apptext-soft">{pct(value)}</span>
    </div>
  );
}

function Checks({ checks, online }: { checks: HostCheck[]; online: boolean }) {
  if (!checks.length) {
    return online ? (
      <Card>
        <Dot tone="good">All good: nothing on the NUC needs attention.</Dot>
      </Card>
    ) : null;
  }
  return (
    <Card title="Needs attention">
      <ul className="flex flex-col gap-3">
        {checks.map((c, i) => (
          <li key={`${c.key}-${i}`} className="flex gap-3">
            <span aria-hidden="true" className="mt-0.5 text-base leading-none">{c.level === 'critical' ? '⛔' : '⚠️'}</span>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${c.level === 'critical' ? 'text-apptext-danger' : 'text-apptext-warning'}`}>
                <span className="sr-only">{c.level === 'critical' ? 'Critical: ' : 'Warning: '}</span>
                {c.title}
              </p>
              {c.detail && <p className="mt-0.5 break-words text-xs text-apptext-muted">{c.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Headline({ s, now }: { s: HostSnapshot; now: number }) {
  const memUsed = usedPct(s.memory?.totalBytes, s.memory?.availableBytes);
  const sys = s.disks?.find((d) => d.name === 'C:') ?? s.disks?.[0];
  const diskUsed = usedPct(sys?.totalBytes, sys?.freeBytes);
  const cpuTemp = s.temperatures?.length ? Math.max(...s.temperatures.map((t) => t.celsius)) : null;
  const ssdTemp = s.physicalDisks?.find((d) => d.temperatureC != null)?.temperatureC ?? null;
  const wifi = s.network?.wifi;
  const tone = (v: number | null, warn: number, bad: number) => (v == null ? undefined : v >= bad ? 'bad' : v >= warn ? 'warn' : undefined);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6 lg:gap-4">
      <Stat label="Processor" value={pct(s.cpu?.usagePct)} tone={tone(s.cpu?.usagePct ?? null, 85, 95)}
        sub="average, last minute" />
      <Stat label="Memory" value={pct(memUsed)} tone={tone(memUsed, 90, 95)}
        sub={s.memory?.totalBytes ? `${bytes((s.memory.totalBytes ?? 0) - (s.memory.availableBytes ?? 0))} of ${bytes(s.memory.totalBytes)}` : undefined} />
      <Stat label={sys ? `Drive ${sys.name}` : 'Drive'} value={pct(diskUsed)} tone={tone(diskUsed, 85, 95)}
        sub={sys ? `${bytes(sys.freeBytes)} free` : undefined} />
      <Stat label="Temperature" value={cpuTemp == null ? '—' : `${Math.round(cpuTemp)} °C`} tone={tone(cpuTemp, 85, 95)}
        sub={ssdTemp != null ? `SSD ${Math.round(ssdTemp)} °C` : undefined} />
      <Stat label="Network" value={`↓ ${bits(s.network?.rxBps)}`}
        sub={`↑ ${bits(s.network?.txBps)}${wifi?.signalPct != null ? ` · Wi-Fi ${wifi.signalPct}%` : ''}`} />
      <Stat label="Up for" value={since(s.host?.bootTime, now)} sub={s.host?.bootTime ? `since ${when(s.host.bootTime)}` : undefined} />
    </div>
  );
}

// ── History charts ──

const CHART_MARGIN = { top: 5, right: 8, left: 0, bottom: 0 } as const;
const TICK = { fill: 'var(--appchart-tick)', fontSize: 11 } as const;
const AXIS_LINE = { stroke: 'var(--appchart-grid)' } as const;
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--appchart-bg)',
  border: '1px solid var(--appchart-border)',
  borderRadius: '16px',
  fontSize: '13px',
  color: 'var(--apptext)',
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;
const TOOLTIP_LABEL_STYLE = { color: 'var(--apptext-muted)', marginBottom: 4 } as const;

const RANGES: Array<[HostRange, string]> = [
  ['24h', '24 h'],
  ['7d', '7 d'],
  ['30d', '30 d'],
];

function formatTick(t: number, range: HostRange): string {
  const d = new Date(t);
  if (range === '24h') return d.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (range === '7d') return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Series { key: keyof HostPoint; label: string; color: string }

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-apptext-soft">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2.5" /></svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

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
  const narrow = useMediaQuery('(max-width: 639px)');
  const hasData = data.some((p) => series.some((s) => p[s.key] != null));
  return (
    <div className="min-w-0 rounded-2xl border border-appborder bg-appinset p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold text-apptext">{title}</p>
        {note && <p className="text-2xs tabular-nums text-apptext-muted">{note}</p>}
      </div>
      {series.length > 1 && <div className="mb-2"><Legend series={series} /></div>}
      {!hasData ? (
        <div className="flex h-[150px] items-center justify-center px-6 text-center text-xs text-apptext-muted">
          Nothing to draw yet: the line fills in as the NUC reports, once a minute.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={150} debounce={80}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--appchart-grid)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) => formatTick(t, range)} tick={TICK} axisLine={AXIS_LINE} tickLine={false}
              minTickGap={narrow ? 48 : 32} />
            <YAxis domain={ticks ? [ticks[0], ticks[ticks.length - 1]] : domain} ticks={ticks} width={40} tick={TICK}
              axisLine={AXIS_LINE} tickLine={false} allowDecimals={digits > 0} />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              labelFormatter={(t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              formatter={(value: number, key: string) => [
                `${Number(value).toFixed(digits)} ${unit}`.trim(),
                series.find((s) => s.key === key)?.label ?? key,
              ]}
            />
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} type="monotone" stroke={s.color} strokeWidth={2} dot={false}
                connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
});

const COOL = 'var(--appchart-cool)';
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
const HEAT = 'var(--appchart-heat)';

function History({ range, onRange, history, loading }: {
  range: HostRange;
  onRange: (r: HostRange) => void;
  history: HostHistory | undefined;
  loading: boolean;
}) {
  const data = useMemo(
    () => (history?.points ?? []).map((p) => ({ ...p, t: new Date(p.t).getTime() }) as unknown as Record<string, number | null>),
    [history],
  );
  const tempTicks = useMemo(() => roundTicks(data, ['cpuTempC', 'diskTempC']), [data]);
  const sum = history?.summary;
  const fresh = history?.firstSampleAt && new Date(history.firstSampleAt).getTime() > new Date(history.from).getTime() + 3_600_000;
  return (
    <Card
      title="History"
      aside={
        <div className="flex gap-1 rounded-full border border-appborder bg-appinset p-1" role="group" aria-label="History range">
          {RANGES.map(([r, label]) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => onRange(r)}
              className={`h-9 rounded-full px-3 text-3xs font-semibold uppercase tracking-[0.14em] transition-colors sm:px-4 ${FOCUS_RING} ${
                range === r ? 'bg-appaccent-soft text-apptext' : 'text-apptext-muted hover:text-apptext'
              }`}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      {fresh && (
        <p className="mb-3 text-xs text-apptext-muted">Recording since {when(history?.firstSampleAt)}; earlier times are blank.</p>
      )}
      {loading && !history ? (
        <div className="h-[200px] animate-pulse rounded-2xl bg-appinset" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <MetricChart title="Processor" unit="%" range={range} data={data} domain={[0, 100]}
            note={sum?.cpuAvg != null ? `avg ${pct(sum.cpuAvg)} · busiest minute ${pct(sum.cpuPeak)}` : undefined}
            series={[{ key: 'cpuAvg', label: 'Processor', color: COOL }]} />
          <MetricChart title="Memory in use" unit="%" range={range} data={data} domain={[0, 100]}
            note={sum?.memAvgPct != null ? `avg ${pct(sum.memAvgPct)} · peak ${pct(sum.memPeakPct)}` : undefined}
            series={[{ key: 'memPct', label: 'Memory', color: COOL }]} />
          <MetricChart title="Temperature" unit="°C" range={range} data={data} domain={['auto', 'auto']} ticks={tempTicks}
            note={sum?.cpuTempPeak != null ? `hottest ${Math.round(sum.cpuTempPeak)} °C` : undefined}
            series={[{ key: 'cpuTempC', label: 'Processor', color: HEAT }, { key: 'diskTempC', label: 'SSD', color: COOL }]} />
          <MetricChart title="Home network" unit="Mbps" digits={2} range={range} data={data} domain={[0, 'auto']}
            note={sum?.rxBytes != null ? `↓ ${bytes(sum.rxBytes)} · ↑ ${bytes(sum.txBytes)}` : undefined}
            series={[{ key: 'rxMbps', label: 'Download', color: COOL }, { key: 'txMbps', label: 'Upload', color: HEAT }]} />
        </div>
      )}
      {history && history.gaps.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-apptext">Times it went quiet</p>
          <ul className="flex flex-col gap-1.5">
            {[...history.gaps].reverse().map((g) => (
              <li key={g.from} className="text-xs text-apptext-muted">
                <span className="tabular-nums text-apptext-soft">{when(g.from)} → {when(g.to)}</span>
                {' · '}{duration(g.minutes)}{g.restarted ? ' · it restarted' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ── Detail cards ──

function containerTone(c: HostContainer): ['good' | 'warn' | 'bad' | 'off', string] {
  if (c.state === 'running') return c.health === 'unhealthy' ? ['warn', 'Running · unhealthy'] : ['good', c.health === 'healthy' ? 'Running · healthy' : 'Running'];
  if (c.state === 'restarting') return ['warn', 'Restarting'];
  return [c.name.startsWith('homeplatform-') ? 'bad' : 'off', c.status ?? c.state ?? 'Stopped'];
}

function Containers({ docker }: { docker: HostSnapshot['docker'] }) {
  if (!docker) return null;
  const list = [...(docker.containers ?? [])].sort((a, b) =>
    (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || (b.memBytes ?? 0) - (a.memBytes ?? 0));
  const running = list.filter((c) => c.state === 'running').length;
  return (
    <Card
      title="Containers"
      aside={docker.ok ? (
        <span className="text-2xs text-apptext-muted">
          {running} of {list.length} running · Docker {docker.version ?? ''}{docker.memTotalBytes ? ` · ${bytes(docker.memTotalBytes)} VM` : ''}
        </span>
      ) : <Dot tone="bad">Docker isn't responding</Dot>}
    >
      {!docker.ok ? (
        <p className="text-xs text-apptext-muted">{docker.error ?? 'No answer from Docker.'} Container details come back once it does.</p>
      ) : (
        <ul className="divide-y divide-appborder">
          {list.map((c) => {
            const [tone, label] = containerTone(c);
            return (
              <li key={c.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-apptext" title={c.image ?? undefined}>{c.name}</p>
                  <Dot tone={tone}>{label}</Dot>
                </div>
                {c.state === 'running' && (
                  <p className="text-xs tabular-nums text-apptext-soft">
                    {pct(c.cpuPct, 1)} CPU · {bytes(c.memBytes)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ProcessList({ title, rows, value }: { title: string; rows: HostProcess[]; value: (p: HostProcess) => string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-semibold text-apptext">{title}</p>
      <ol className="flex flex-col gap-1.5">
        {rows.map((p) => (
          <li key={p.name} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-apptext-soft" title={p.name}>
              {processLabel(p.name)}{p.count && p.count > 1 ? <span className="text-apptext-dim"> ×{p.count}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-apptext">{value(p)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Processes({ s }: { s: HostSnapshot }) {
  if (!s.topCpu?.length && !s.topMemory?.length) return null;
  return (
    <Card title="What's using it">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <ProcessList title="Busiest (last minute)" rows={s.topCpu ?? []} value={(p) => pct(p.cpuPct, 1)} />
        <ProcessList title="Most memory" rows={s.topMemory ?? []} value={(p) => bytes(p.memBytes)} />
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-xs">
      <dt className="shrink-0 text-apptext-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-apptext-soft">{children}</dd>
    </div>
  );
}

function Storage({ s, app }: { s: HostSnapshot; app: HostHealth['app'] }) {
  return (
    <Card title="Storage">
      <div className="flex flex-col gap-4">
        {(s.disks ?? []).map((d) => (
          <div key={d.name}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-apptext">Drive {d.name}{d.label ? ` (${d.label})` : ''}</span>
              <span className="tabular-nums text-apptext-muted">{bytes(d.freeBytes)} free of {bytes(d.totalBytes)}</span>
            </div>
            <Meter value={usedPct(d.totalBytes, d.freeBytes)} label={`Drive ${d.name} used`} />
            <p className="mt-1 text-2xs tabular-nums text-apptext-dim">Reading {perSecond(d.readBps)} · writing {perSecond(d.writeBps)}</p>
          </div>
        ))}
        <dl className="divide-y divide-appborder">
          {(s.physicalDisks ?? []).map((p) => (
            <Row key={p.name ?? 'disk'} label={p.mediaType && p.mediaType !== 'Unspecified' ? p.mediaType : 'Disk'}>
              <Dot tone={p.health === 'Healthy' ? 'good' : 'bad'}>{p.health ?? 'Unknown'}</Dot>
              {p.temperatureC != null && <span className="ml-2 tabular-nums">{Math.round(p.temperatureC)} °C</span>}
              {p.wearPct != null && <span className="ml-2 tabular-nums">{p.wearPct}% worn</span>}
            </Row>
          ))}
          {app?.databaseBytes != null && <Row label="This app's database">{bytes(app.databaseBytes)}</Row>}
          {(app?.largestTables ?? []).slice(0, 4).map((t) => (
            <Row key={t.name} label={`· ${t.name}`}>{bytes(t.bytes)}</Row>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function Power({ s }: { s: HostSnapshot }) {
  const events = powerEvents(s.events).slice(0, 12);
  return (
    <Card title="Power and restarts">
      <dl className="divide-y divide-appborder">
        <Row label="Last started">{when(s.host?.bootTime)}</Row>
        <Row label="Power plan">{s.power?.plan ?? '—'}</Row>
        <Row label="Sleeps after">
          {s.power?.sleepAfterMinutes == null ? '—' : s.power.sleepAfterMinutes === 0 ? 'Never' : `${s.power.sleepAfterMinutes} min`}
        </Row>
        <Row label="Windows updates">{s.power?.pendingReboot ? 'Waiting on a restart' : 'Nothing pending'}</Row>
      </dl>
      {events.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-apptext">Last 30 days</p>
          <ul className="flex flex-col gap-2">
            {events.map((e, i) => {
              const detail = eventDetail(e);
              return (
                <li key={`${e.at}-${e.id}-${i}`} className="text-xs">
                  <span className="tabular-nums text-apptext-soft">{when(e.at)}</span>
                  {' · '}
                  <span className={e.kind === 'unexpected' ? 'font-semibold text-apptext-warning' : 'text-apptext'}>{eventLabel(e.kind)}</span>
                  {detail && <p className="mt-0.5 break-words text-2xs text-apptext-dim">{detail}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function About({ s, app }: { s: HostSnapshot; app: HostHealth['app'] }) {
  const n = s.network;
  const w = n?.wifi;
  return (
    <Card title="About the NUC">
      <dl className="divide-y divide-appborder">
        <Row label="Model">{s.host?.model ?? '—'}</Row>
        <Row label="Windows">{[s.host?.os, s.host?.osBuild].filter(Boolean).join(' · ') || '—'}</Row>
        <Row label="Processor">
          {s.host?.cpuModel ?? '—'}
          {s.host?.cores ? ` · ${s.host.cores} cores, ${s.host.logicalProcessors} threads` : ''}
        </Row>
        <Row label="Memory">{bytes(s.memory?.totalBytes)}</Row>
        {(s.physicalDisks ?? []).map((p) => (
          <Row key={p.name ?? 'disk'} label="Drive">{[p.name, bytes(p.sizeBytes)].filter(Boolean).join(' · ')}</Row>
        ))}
        <Row label="Network">{[n?.adapter, n?.ip].filter(Boolean).join(' · ') || '—'}</Row>
        {w && (
          <Row label="Wi-Fi">
            {[w.ssid, w.band, w.channel ? `channel ${w.channel}` : null, w.signalPct != null ? `${w.signalPct}% signal` : null,
              w.rxMbps ? `${w.rxMbps} Mbps link` : null].filter(Boolean).join(' · ')}
          </Row>
        )}
        <Row label="Remote access (Tailscale)">
          {n?.tailscaleUp == null ? '—' : <Dot tone={n.tailscaleUp ? 'good' : 'bad'}>{n.tailscaleUp ? 'Connected' : 'Down'}</Dot>}
        </Row>
        {app && (
          <Row label="This app's server">
            {bytes(app.heapUsedBytes)} of {bytes(app.heapMaxBytes)} memory · up {app.uptimeSeconds != null ? duration(Math.floor(app.uptimeSeconds / 60)) : '—'}
          </Row>
        )}
        {s.agent?.durationMs != null && <Row label="Monitor">checked in {(s.agent.durationMs / 1000).toFixed(1)} s</Row>}
      </dl>
    </Card>
  );
}

function NotSetUp() {
  return (
    <Card title="Set up the NUC's health monitor">
      <p className="text-sm text-apptext">The page fills in once the NUC starts reporting.</p>
      <p className="mt-2 text-xs text-apptext-muted">
        On the NUC, from an admin prompt in the repo folder, run <code className="rounded bg-appinset px-1 py-0.5">scripts\install-host-metrics-task.cmd</code>.
        It adds a task that checks the NUC every minute. The first numbers show up within two minutes.
      </p>
    </Card>
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

  if (health.isLoading) return <div className="h-40 animate-pulse rounded-[24px] bg-appinset" />;
  if (health.isError || !health.data) {
    return (
      <Card>
        <p className="text-sm text-apptext">Couldn't load the NUC's health: {errorMessage(health.error)}</p>
      </Card>
    );
  }

  const data = health.data;
  if (data.status === 'NOT_SET_UP') return <NotSetUp />;
  const s = data.latest;
  const online = data.status === 'ONLINE';
  const now = new Date(data.now).getTime();

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-apptext-muted">
          {s?.host?.model ?? 'The NUC'} checks itself every minute: load, memory, storage, temperature, network and the
          app's containers.
        </p>
        {online ? (
          <Dot tone="good">Reported {ago(data.lastReportAt)}</Dot>
        ) : (
          <Dot tone="bad">Monitor offline · last report {ago(data.lastReportAt) || 'never'}</Dot>
        )}
      </div>

      <Checks checks={data.checks} online={online} />

      {s ? (
        <>
          <Headline s={s} now={now} />
          <History range={range} onRange={setRange} history={history.data} loading={history.isLoading} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            <Containers docker={s.docker} />
            <div className="flex flex-col gap-4 lg:gap-5">
              <Processes s={s} />
              <Storage s={s} app={data.app} />
            </div>
            <Power s={s} />
            <About s={s} app={data.app} />
          </div>
        </>
      ) : (
        <>
          <History range={range} onRange={setRange} history={history.data} loading={history.isLoading} />
          <Card>
            <p className="text-xs text-apptext-muted">The latest details show up with the next report.</p>
          </Card>
        </>
      )}
    </div>
  );
}
