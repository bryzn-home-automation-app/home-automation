import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Thermostat, ThermostatReading } from '../types';
import { currentSetpoint } from '../utils/thermostat';
import { formatTimeTick, timeTicks } from '../utils/cameras';
import { formatDateTime, toInstant } from '../utils/format';
import { Chips, DialLegend, EmptyState, ErrorState, Loading, Panel, SkelBlock, useChartTheme } from './ui';

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

const SERIES_NAMES: Record<string, string> = { temp: 'Inside', heat: 'Heat to', cool: 'Cool to' };

interface ThermostatHistoryChartProps {
  thermostats: Thermostat[];
  /** The thermostat on screen. */
  selectedId: string;
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

function ThermostatHistoryChart({ thermostats, selectedId, history, failed, onRetry, retrying, range, onRangeChange, unit }: ThermostatHistoryChartProps) {
  const t = useChartTheme();
  // "now" is re-read whenever data or range changes, so the window's right edge
  // and each series' live point stay in step.
  const { series, domain, scale, ticks } = useMemo(() => {
    const now = Date.now();
    const from = now - range * 3_600_000;
    const all = thermostats.map((th) => ({ id: th.id, points: buildSeries(history[th.id] ?? [], th, now) }));
    return {
      series: all,
      domain: [from, now] as [number, number],
      scale: sharedDomain(all.map((s) => s.points)),
      ticks: timeTicks(from, now, range),
    };
  }, [thermostats, history, range]);

  const selected = thermostats.find((th) => th.id === selectedId);
  const points = series.find((s) => s.id === selectedId)?.points ?? [];
  const loaded = history[selectedId] !== undefined;

  let body;
  if (failed[selectedId] && !loaded) {
    body = <ErrorState compact title="Couldn't load the history" onRetry={onRetry} retrying={retrying} />;
  } else if (!loaded) {
    body = (
      <Loading label="Loading the history">
        <SkelBlock height={220} />
      </Loading>
    );
  } else if (points.length < 2) {
    body = (
      <EmptyState compact icon="thermometer" title="Collecting data">
        History fills in as the thermostat reports changes, and at least every 15 minutes.
      </EmptyState>
    );
  } else {
    body = (
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%" debounce={80}>
          <LineChart data={points} margin={CHART_MARGIN}>
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
              formatter={(value: number, key: string) => [`${Number(value).toFixed(1)}${unit}`, SERIES_NAMES[key] ?? key]}
            />
            <Line dataKey="temp" type="monotone" stroke={t.series.ink} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="heat" type="stepAfter" stroke={t.series.heat} strokeWidth={1.75} strokeDasharray={t.dash} dot={false} isAnimationActive={false} />
            <Line dataKey="cool" type="stepAfter" stroke={t.series.cool} strokeWidth={1.75} strokeDasharray={t.dash} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Panel
      title="Temperature history"
      subtitle={selected ? `${selected.name}, inside against what it was set to` : 'Inside, against what it was set to'}
    >
      <div className="fp-stack">
        <Chips
          label="History range"
          value={String(range) as '24' | '168'}
          onChange={(v) => onRangeChange(Number(v) as HistoryRange)}
          options={RANGES}
        />
        <DialLegend
          className="justify-start"
          items={[
            { label: 'Inside', tone: 'ink', key: 'line' },
            { label: 'Heat to', tone: 'heat', key: 'dash' },
            { label: 'Cool to', tone: 'cool', key: 'dash' },
          ]}
        />
        {body}
      </div>
    </Panel>
  );
}

export default memo(ThermostatHistoryChart);
