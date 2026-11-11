import { memo, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Thermostat, ThermostatReading } from '../types';
import { currentSetpoint, formatTemp } from '../utils/thermostat';
import { formatTimeTick, timeTicks } from '../utils/cameras';
import { formatDateTime, formatList, pluralWord, toInstant } from '../utils/format';
import {
  Button,
  Chips,
  DialLegend,
  EmptyState,
  ErrorState,
  Loading,
  Notice,
  Panel,
  SkelBlock,
  useChartTheme,
  type LegendItem,
} from './ui';

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 } as const;

export type HistoryRange = 24 | 168;

const RANGES = [
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
] as const;

export interface Point {
  t: number;
  temp: number | null;
  heat: number | null;
  cool: number | null;
}

/** Heat-to / cool-to a state was holding, by mode (off → neither). */
function sides(
  mode: string | null,
  target: number | null,
  heat: number | null,
  cool: number | null,
): { heat: number | null; cool: number | null } {
  switch (mode) {
    case 'heat_cool':
    case 'auto':
      return { heat, cool };
    case 'heat':
      return { heat: target ?? heat, cool: null };
    case 'cool':
      return { heat: null, cool: target ?? cool };
    default:
      return { heat: null, cool: null };
  }
}

/**
 * Readings are stored on change (plus a periodic snapshot), so a steady room can
 * go a while without a row. Extend the series to "now" with the live state so
 * the lines reach the right edge instead of stopping at the last change.
 */
export function buildSeries(readings: ThermostatReading[], live: Thermostat | undefined, now = Date.now()): Point[] {
  const pts: Point[] = readings
    .map((r) => ({
      t: toInstant(r.recordedAt) ?? NaN,
      temp: r.temperature,
      ...sides(r.hvacMode, r.targetTemperature, r.heatSetpoint, r.coolSetpoint),
    }))
    .filter((p) => Number.isFinite(p.t));
  if (live && live.available && live.temperature != null) {
    const sp = currentSetpoint(live);
    const s =
      sp.kind === 'range'
        ? { heat: sp.low, cool: sp.high }
        : sp.kind === 'single'
          ? live.hvacMode === 'heat'
            ? { heat: sp.value, cool: null }
            : { heat: null, cool: sp.value }
          : { heat: null, cool: null };
    if (!pts.length || pts[pts.length - 1].t < now) pts.push({ t: now, temp: live.temperature, ...s });
  }
  return pts;
}

/**
 * One temperature scale for every thermostat, in whole degrees with an even step (B-101: the
 * old per-room 'dataMin - 2' bounds printed 78°, 71.7°, 67.7° and put the rooms on different
 * scales). Even steps of 2 or more, at least 4 ticks.
 */
export function sharedDomain(series: Point[][]): { domain: [number, number]; ticks: number[] } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const pts of series) {
    for (const p of pts) {
      for (const v of [p.temp, p.heat, p.cool]) {
        if (v != null && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
  }
  if (!Number.isFinite(lo)) return null;
  const span = Math.max(4, hi - lo + 2);
  const step = span <= 8 ? 2 : span <= 20 ? 5 : 10;
  const min = Math.floor((lo - 1) / step) * step;
  const max = Math.ceil((hi + 1) / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return { domain: [min, max], ticks };
}

/** One row of the combined chart: `temp0`, `heat0`, `cool0`, `temp1`… per thermostat index. */
export type MergedRow = { t: number } & Record<string, number | null>;

/**
 * Every thermostat's series on one time axis, so the tooltip can name each one's value at the
 * cursor. Readings come on change and at different moments per thermostat, so at another
 * thermostat's timestamp the inside temperature is interpolated between its neighbours and a
 * setpoint is the one it was holding (setpoints step). Outside a series' own span it is null.
 * Keys use the thermostat's index, not its id (Recharts reads a dotted dataKey as a path).
 */
export function mergeSeries(series: Point[][]): MergedRow[] {
  const times = Array.from(new Set(series.flatMap((pts) => pts.map((p) => p.t)))).sort((a, b) => a - b);
  const rows: MergedRow[] = times.map((t) => ({ t }) as MergedRow);
  series.forEach((pts, i) => {
    let j = 0; // the last point at or before the row's time
    for (const row of rows) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (!first || row.t < first.t || row.t > last.t) {
        row[`temp${i}`] = null;
        row[`heat${i}`] = null;
        row[`cool${i}`] = null;
        continue;
      }
      while (j + 1 < pts.length && pts[j + 1].t <= row.t) j++;
      const p = pts[j];
      const n = pts[j + 1];
      let temp = p.temp;
      if (p.t !== row.t && n && p.temp != null && n.temp != null) {
        temp = p.temp + ((n.temp - p.temp) * (row.t - p.t)) / (n.t - p.t);
      }
      row[`temp${i}`] = temp;
      row[`heat${i}`] = p.heat;
      row[`cool${i}`] = p.cool;
    }
  });
  return rows;
}

/** Each thermostat's line: a colour and a dash, so they are told apart without colour too. */
const LINE_STYLES: Array<{ tone: 'ink' | 'graphite' | 'water' | 'gas'; dash?: string; key: 'line' | 'dash' }> = [
  { tone: 'ink', key: 'line' },
  { tone: 'graphite', dash: '7 4', key: 'dash' },
  { tone: 'water', dash: '2 3', key: 'dash' },
  { tone: 'gas', dash: '10 3 2 3', key: 'dash' },
];
const lineStyle = (i: number) => LINE_STYLES[i % LINE_STYLES.length];

type Show = 'inside' | 'setpoints';
const SHOW = [
  { value: 'inside', label: 'Inside only' },
  { value: 'setpoints', label: 'With setpoints' },
] as const;

interface ThermostatHistoryChartProps {
  thermostats: Thermostat[];
  /** Readings per thermostat id (undefined while that thermostat is loading). */
  history: Record<string, ThermostatReading[] | undefined>;
  /** Thermostats whose history failed to load (B-005: a failure is not "collecting data"). */
  failed: Record<string, boolean>;
  onRetry: () => void;
  retrying: boolean;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  unit: string;
}

/**
 * Every thermostat's inside temperature on one chart and one scale, a line per thermostat
 * (colour + dash, named in the legend with its temperature now); the setpoints on request.
 * One thermostat's history failing still draws the others, with a notice for the missing one.
 */
function ThermostatHistoryChart({ thermostats, history, failed, onRetry, retrying, range, onRangeChange, unit }: ThermostatHistoryChartProps) {
  const t = useChartTheme();
  const [show, setShow] = useState<Show>('inside');
  // "now" is re-read whenever data or range changes, so the window's right edge
  // and each series' live point stay in step.
  const { rows, drawn, domain, scale, ticks } = useMemo(() => {
    const now = Date.now();
    const from = now - range * 3_600_000;
    // Only thermostats whose history arrived are drawn (a failed one would be a lone live point).
    const byIndex: Point[][] = thermostats.map((th) =>
      history[th.id] !== undefined ? buildSeries(history[th.id] ?? [], th, now) : [],
    );
    return {
      rows: mergeSeries(byIndex),
      drawn: byIndex.flatMap((pts, i) => (pts.length >= 2 ? [i] : [])),
      domain: [from, now] as [number, number],
      scale: sharedDomain(byIndex),
      ticks: timeTicks(from, now, range),
    };
  }, [thermostats, history, range]);

  const isMissing = (th: Thermostat) => failed[th.id] && history[th.id] === undefined;
  const missing = thermostats.filter(isMissing);
  const loading = thermostats.some((th) => history[th.id] === undefined && !failed[th.id]);
  const several = thermostats.length > 1;
  const names: Record<string, string> = {};
  thermostats.forEach((th, i) => {
    names[`temp${i}`] = several ? th.name : 'Inside';
    names[`heat${i}`] = several ? `${th.name} heat to` : 'Heat to';
    names[`cool${i}`] = several ? `${th.name} cool to` : 'Cool to';
  });

  let body;
  if (missing.length === thermostats.length) {
    body = <ErrorState compact title="Couldn't load the history" onRetry={onRetry} retrying={retrying} />;
  } else if (loading) {
    body = (
      <Loading label="Loading the history">
        <SkelBlock height={240} />
      </Loading>
    );
  } else if (!drawn.length) {
    body = (
      <EmptyState compact icon="thermometer" title="Collecting data">
        History fills in as the thermostats report changes, and at least every 15 minutes.
      </EmptyState>
    );
  } else {
    body = (
      <div className="h-[240px] lg:h-[300px]">
        <ResponsiveContainer width="100%" height="100%" debounce={80}>
          <LineChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid {...t.grid} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              ticks={ticks}
              tickFormatter={(v: number) => formatTimeTick(v, range)}
              {...t.axis}
            />
            <YAxis
              {...t.axis}
              unit="°"
              width={40}
              domain={scale?.domain ?? ['auto', 'auto']}
              ticks={scale?.ticks}
              allowDecimals={false}
            />
            <Tooltip
              {...t.tooltip}
              labelFormatter={(v: number) => formatDateTime(v)}
              formatter={(value: number, key: string) => [`${Number(value).toFixed(1)}${unit}`, names[key] ?? key]}
            />
            {drawn.flatMap((i) => {
              const st = lineStyle(i);
              const lines = [
                <Line
                  key={`temp${i}`}
                  dataKey={`temp${i}`}
                  name={`temp${i}`}
                  type="monotone"
                  stroke={t.series[st.tone]}
                  strokeWidth={2}
                  strokeDasharray={st.dash}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />,
              ];
              if (show === 'setpoints') {
                for (const side of ['heat', 'cool'] as const) {
                  lines.push(
                    <Line
                      key={`${side}${i}`}
                      dataKey={`${side}${i}`}
                      name={`${side}${i}`}
                      type="stepAfter"
                      stroke={t.series[side]}
                      strokeWidth={1.25}
                      strokeOpacity={0.8}
                      strokeDasharray={several ? st.dash : t.dash}
                      dot={false}
                      isAnimationActive={false}
                    />,
                  );
                }
              }
              return lines;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const legend: LegendItem[] = thermostats.flatMap((th, i) =>
    isMissing(th)
      ? []
      : [{
          label: several ? th.name : 'Inside',
          value: th.available && th.temperature != null ? `${formatTemp(th.temperature)}°` : 'offline',
          tone: lineStyle(i).tone,
          key: lineStyle(i).key,
        }],
  );
  if (show === 'setpoints') {
    legend.push({ label: 'Heat to', tone: 'heat', key: several ? 'box' : 'dash' }, { label: 'Cool to', tone: 'cool', key: several ? 'box' : 'dash' });
  }

  return (
    <Panel
      title="Temperature history"
      subtitle={several ? 'Inside, every thermostat on one scale' : `${thermostats[0]?.name ?? 'Inside'}, inside against what it was set to`}
    >
      <div className="fp-stack">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Chips
            label="History range"
            value={String(range) as '24' | '168'}
            onChange={(v) => onRangeChange(Number(v) as HistoryRange)}
            options={RANGES}
          />
          <Chips label="Lines shown" value={show} onChange={setShow} options={SHOW} />
        </div>
        {missing.length > 0 && missing.length < thermostats.length && (
          <Notice
            tone="headsup"
            title={`Couldn't load the ${formatList(missing.map((m) => m.name))} history.`}
            action={
              <Button size="sm" icon="refresh" busy={retrying} busyLabel="Trying again…" onClick={onRetry}>
                Try again
              </Button>
            }
          >
            The chart shows the other {pluralWord(thermostats.length - missing.length, 'thermostat')} for now.
          </Notice>
        )}
        <DialLegend className="justify-start" items={legend} />
        {body}
        {show === 'setpoints' && drawn.length > 1 && (
          <p className="text-small text-apptext-muted">Setpoints are thin, in the line style of their thermostat.</p>
        )}
      </div>
    </Panel>
  );
}

export default memo(ThermostatHistoryChart);
