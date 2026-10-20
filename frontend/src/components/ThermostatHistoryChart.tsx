import { memo, useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Thermostat, ThermostatReading } from '../types';
import { currentSetpoint } from '../utils/thermostat';

// Same hoisted chart styling as UsageChart — CSS vars so both themes work.
const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 } as const;
const TICK_PROPS = { fontSize: 11 } as const;
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--appchart-bg)',
  border: '1px solid var(--appchart-border)',
  borderRadius: '16px',
  fontSize: '13px',
  color: 'var(--apptext)',
  boxShadow: '0 20px 50px var(--appshadow-lg)',
} as const;
const TOOLTIP_LABEL_STYLE = { color: 'var(--apptext-muted)', marginBottom: 4 } as const;
const LEGEND_STYLE = { fontSize: 12, color: 'var(--apptext-soft)' } as const;

/** One color per thermostat (temperature solid, setpoint dashed). The *-300
 *  tokens are remapped darker in the light theme, so both themes stay legible. */
const SERIES_COLORS = [
  'var(--color-sky-300)',
  'var(--color-violet-300)',
  'var(--color-pink-300)',
  'var(--color-cyan-300)',
];

export type HistoryRange = 24 | 168;

interface Point {
  t: number;
  temp: number | null;
  setpoint: number | null;
}

/** The setpoint a reading was holding toward (cool side in heat_cool). */
function readingSetpoint(r: Pick<ThermostatReading, 'hvacMode' | 'targetTemperature' | 'heatSetpoint' | 'coolSetpoint'>): number | null {
  if (r.hvacMode === 'off') return null;
  if (r.targetTemperature != null) return r.targetTemperature;
  if (r.hvacMode === 'heat') return r.heatSetpoint;
  return r.coolSetpoint ?? r.heatSetpoint;
}

/**
 * Readings are stored on change (plus a periodic snapshot), so a steady room can
 * go a while without a row. Extend each series to "now" with the live state so
 * the line reaches the right edge instead of stopping at the last change.
 */
export function buildSeries(readings: ThermostatReading[], live: Thermostat | undefined, now = Date.now()): Point[] {
  const pts: Point[] = readings
    .map((r) => ({ t: new Date(r.recordedAt).getTime(), temp: r.temperature, setpoint: readingSetpoint(r) }))
    .filter((p) => Number.isFinite(p.t));
  if (live && live.available && live.temperature != null) {
    const sp = currentSetpoint(live);
    const setpoint = sp.kind === 'single' ? sp.value : sp.kind === 'range' ? sp.high : null;
    if (!pts.length || pts[pts.length - 1].t < now) pts.push({ t: now, temp: live.temperature, setpoint });
  }
  return pts;
}

function formatTick(t: number, range: HistoryRange): string {
  const d = new Date(t);
  return range === 24
    ? d.toLocaleTimeString(undefined, { hour: 'numeric' })
    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

interface ThermostatHistoryChartProps {
  thermostats: Thermostat[];
  /** Readings per thermostat id (undefined while that thermostat is loading). */
  history: Record<string, ThermostatReading[] | undefined>;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  loading: boolean;
  unit: string;
}

function ThermostatHistoryChart({ thermostats, history, range, onRangeChange, loading, unit }: ThermostatHistoryChartProps) {
  // "now" is re-read whenever data or range changes, so the window's right edge
  // and each series' live point stay in step.
  const { series, domain } = useMemo(() => {
    const now = Date.now();
    return {
      series: thermostats.map((th, i) => ({
        id: th.id,
        name: th.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: buildSeries(history[th.id] ?? [], th, now),
      })),
      domain: [now - range * 3_600_000, now] as [number, number],
    };
  }, [thermostats, history, range]);

  // Fewer than two stored points per series reads as "nothing yet" — the live
  // point alone would draw a single dot.
  const hasHistory = series.some((s) => s.points.length >= 2 && (history[s.id]?.length ?? 0) > 0);

  const rangeButtons = (
    <div className="flex gap-1 rounded-full border border-appborder bg-appinset p-1" role="group" aria-label="History range">
      {([24, 168] as HistoryRange[]).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={range === r}
          onClick={() => onRangeChange(r)}
          className={`rounded-full px-3 py-1 text-3xs font-semibold uppercase tracking-[0.14em] transition-colors ${
            range === r ? 'bg-appaccent-soft text-apptext' : 'text-apptext-muted hover:text-apptext'
          }`}
        >
          {r === 24 ? '24 h' : '7 d'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">History</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">Temperature & setpoint</h3>
        </div>
        {rangeButtons}
      </div>

      {loading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-appinset" />
      ) : !hasHistory ? (
        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset px-6 text-center text-sm text-apptext-muted">
          Collecting data — history fills in as the thermostats report changes, and at least every 15 minutes.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300} debounce={80}>
          <LineChart margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--appchart-grid)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              tickFormatter={(t: number) => formatTick(t, range)}
              tick={{ fill: 'var(--appchart-tick)', ...TICK_PROPS }}
              axisLine={{ stroke: 'var(--appchart-grid)' }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tick={{ fill: 'var(--appchart-tick)', ...TICK_PROPS }}
              axisLine={{ stroke: 'var(--appchart-grid)' }}
              tickLine={false}
              unit={unit}
              width={52}
              domain={['dataMin - 2', 'dataMax + 2']}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              labelFormatter={(t: number) =>
                new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
              }
              formatter={(value: number) => [`${Number(value).toFixed(1)}${unit}`]}
            />
            <Legend wrapperStyle={LEGEND_STYLE} />
            {series.map((s) => [
              <Line
                key={`${s.id}-temp`}
                data={s.points}
                dataKey="temp"
                name={`${s.name}`}
                type="monotone"
                stroke={s.color}
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />,
              <Line
                key={`${s.id}-setpoint`}
                data={s.points}
                dataKey="setpoint"
                name={`${s.name} setpoint`}
                type="stepAfter"
                stroke={s.color}
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />,
            ])}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default memo(ThermostatHistoryChart);
