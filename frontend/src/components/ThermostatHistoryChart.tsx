import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Thermostat, ThermostatReading } from '../types';
import { currentSetpoint } from '../utils/thermostat';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { FOCUS_RING } from './ThermostatControls';

// Same hoisted chart styling as UsageChart — CSS vars so both themes work.
const CHART_MARGIN = { top: 5, right: 8, left: 0, bottom: 0 } as const;
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

// Orange = heat, sky = cool everywhere on the tab; indoor temp stays neutral.
const COLORS = {
  temp: 'var(--apptext-soft)',
  heat: 'var(--color-orange-300)',
  cool: 'var(--color-sky-300)',
} as const;

export type HistoryRange = 24 | 168;

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
      t: new Date(r.recordedAt).getTime(),
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

function formatTick(t: number, range: HistoryRange): string {
  const d = new Date(t);
  return range === 24
    ? d.toLocaleTimeString(undefined, { hour: 'numeric' })
    : d.toLocaleDateString(undefined, { weekday: 'short' });
}

const SERIES_NAMES: Record<string, string> = { temp: 'Indoor', heat: 'Heat to', cool: 'Cool to' };

function Legend() {
  const item = (color: string, label: string, dashed: boolean) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true">
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-apptext-soft">
      {item(COLORS.temp, 'Indoor', false)}
      {item(COLORS.heat, 'Heat to', true)}
      {item(COLORS.cool, 'Cool to', true)}
    </div>
  );
}

const SmallChart = memo(function SmallChart({
  name,
  points,
  domain,
  range,
  unit,
  narrow,
}: {
  name: string;
  points: Point[];
  domain: [number, number];
  range: HistoryRange;
  unit: string;
  narrow: boolean;
}) {
  const hasHistory = points.length >= 2;
  return (
    <div className="rounded-2xl border border-appborder bg-appinset p-3">
      <p className="mb-2 text-sm font-semibold text-apptext">{name}</p>
      {!hasHistory ? (
        <div className="flex h-[220px] items-center justify-center px-6 text-center text-xs text-apptext-muted">
          Collecting data — history fills in as the thermostat reports changes, and at least every 15 minutes.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220} debounce={80}>
          <LineChart data={points} margin={CHART_MARGIN}>
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
              minTickGap={narrow ? 48 : 32}
            />
            <YAxis
              tick={{ fill: 'var(--appchart-tick)', ...TICK_PROPS }}
              axisLine={{ stroke: 'var(--appchart-grid)' }}
              tickLine={false}
              unit="°"
              width={40}
              domain={['dataMin - 2', 'dataMax + 2']}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              labelFormatter={(t: number) =>
                new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
              }
              formatter={(value: number, key: string) => [`${Number(value).toFixed(1)}${unit}`, SERIES_NAMES[key] ?? key]}
            />
            <Line dataKey="temp" type="monotone" stroke={COLORS.temp} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="heat" type="stepAfter" stroke={COLORS.heat} strokeWidth={1.75} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line dataKey="cool" type="stepAfter" stroke={COLORS.cool} strokeWidth={1.75} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
});

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
  const narrow = useMediaQuery('(max-width: 639px)');
  // "now" is re-read whenever data or range changes, so the window's right edge
  // and each series' live point stay in step.
  const { series, domain } = useMemo(() => {
    const now = Date.now();
    return {
      series: thermostats.map((th) => ({ id: th.id, name: th.name, points: buildSeries(history[th.id] ?? [], th, now) })),
      domain: [now - range * 3_600_000, now] as [number, number],
    };
  }, [thermostats, history, range]);

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-4 shadow-[0_10px_28px_var(--appshadow)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">History</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">Temperature & setpoints</h3>
        </div>
        <div className="flex gap-1 rounded-full border border-appborder bg-appinset p-1" role="group" aria-label="History range">
          {([24, 168] as HistoryRange[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => onRangeChange(r)}
              className={`h-9 rounded-full px-4 text-3xs font-semibold uppercase tracking-[0.14em] transition-colors ${FOCUS_RING} ${
                range === r ? 'bg-appaccent-soft text-apptext' : 'text-apptext-muted hover:text-apptext'
              }`}
            >
              {r === 24 ? '24 h' : '7 d'}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <Legend />
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {thermostats.map((th) => (
            <div key={th.id} className="h-[262px] animate-pulse rounded-2xl bg-appinset" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {series.map((s) => (
            <SmallChart key={s.id} name={s.name} points={s.points} domain={domain} range={range} unit={unit} narrow={narrow} />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ThermostatHistoryChart);
