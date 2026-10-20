import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { batterySeries, dailySummary, dayLabel, nightWindows } from '../utils/cameras';
import { FOCUS_RING } from './ThermostatControls';
import { BatteryBadge } from './CameraTile';
import type { Camera, CameraBatteryHistory } from '../types';
import type { ChargeState } from '../utils/cameras';

// Same hoisted chart styling as the Climate charts — CSS vars so both themes work.
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

const COLORS = {
  charge: 'var(--color-emerald-400)',
  drain: 'var(--apptext-soft)',
  night: 'var(--appchart-grid)',
} as const;

export type BatteryRange = 24 | 168 | 720;
const RANGES: Array<[BatteryRange, string]> = [
  [24, '24 h'],
  [168, '7 d'],
  [720, '30 d'],
];

function formatTick(t: number, range: BatteryRange): string {
  const d = new Date(t);
  if (range === 24) return d.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (range === 168) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Legend() {
  const line = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true">
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-apptext-soft">
      {line(COLORS.charge, 'Charging')}
      {line(COLORS.drain, 'On battery')}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-sm bg-appinset-strong" aria-hidden="true" />
        Night
      </span>
    </div>
  );
}

interface CameraBatteryChartProps {
  camera: Camera;
  history: CameraBatteryHistory | undefined;
  loading: boolean;
  range: BatteryRange;
  onRangeChange: (r: BatteryRange) => void;
  charge: { state: ChargeState; inferred: boolean };
}

function CameraBatteryChart({ camera, history, loading, range, onRangeChange, charge }: CameraBatteryChartProps) {
  const narrow = useMediaQuery('(max-width: 639px)');
  const { points, domain, nights, days } = useMemo(() => {
    const now = Date.now();
    const from = now - range * 3_600_000;
    const readings = history?.readings ?? [];
    return {
      points: batterySeries(readings),
      domain: [from, now] as [number, number],
      nights: nightWindows(history?.daylight ?? [], from, now),
      // Seven most recent days at most; the 24 h view only needs today/yesterday.
      days: dailySummary(readings).slice(0, range === 24 ? 2 : 7),
    };
  }, [history, range]);

  const hasHistory = points.length >= 2;

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-4 shadow-[0_10px_28px_var(--appshadow)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Battery & solar</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">{camera.name}</h3>
          <div className="mt-1">
            <BatteryBadge camera={camera} state={charge.state} inferred={charge.inferred} />
          </div>
        </div>
        <div className="flex gap-1 rounded-full border border-appborder bg-appinset p-1" role="group" aria-label={`${camera.name} battery range`}>
          {RANGES.map(([r, label]) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => onRangeChange(r)}
              className={`h-9 rounded-full px-3 text-3xs font-semibold uppercase tracking-[0.14em] transition-colors sm:px-4 ${FOCUS_RING} ${
                range === r ? 'bg-appaccent-soft text-apptext' : 'text-apptext-muted hover:text-apptext'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <Legend />
      </div>
      {loading ? (
        <div className="h-[220px] animate-pulse rounded-2xl bg-appinset" />
      ) : !hasHistory ? (
        <div className="flex h-[220px] items-center justify-center rounded-2xl bg-appinset px-6 text-center text-xs text-apptext-muted">
          Collecting data — the line fills in as the camera reports its battery, and at least every 15 minutes.
        </div>
      ) : (
        <div className="rounded-2xl border border-appborder bg-appinset p-3">
          <ResponsiveContainer width="100%" height={220} debounce={80}>
            <LineChart data={points} margin={CHART_MARGIN}>
              {nights.map((n) => (
                <ReferenceArea key={n.from} x1={n.from} x2={n.to} y1={0} y2={100} fill={COLORS.night} fillOpacity={0.5} ifOverflow="hidden" />
              ))}
              <CartesianGrid strokeDasharray="3 3" stroke="var(--appchart-grid)" vertical={false} />
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                unit="%"
                width={44}
                tick={{ fill: 'var(--appchart-tick)', ...TICK_PROPS }}
                axisLine={{ stroke: 'var(--appchart-grid)' }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                labelFormatter={(t: number) =>
                  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
                }
                formatter={(value: number, key: string) => [`${Math.round(Number(value))}%`, key === 'charge' ? 'Charging' : 'On battery']}
              />
              <Line dataKey="drain" type="linear" stroke={COLORS.drain} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="charge" type="linear" stroke={COLORS.charge} strokeWidth={3} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {days.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Daily battery summary">
          {days.map((d) => (
            <li key={d.day} className="rounded-xl border border-appborder bg-appinset px-3 py-2">
              <p className="text-3xs font-semibold uppercase tracking-[0.14em] text-apptext-muted">{dayLabel(d.day)}</p>
              <p className="mt-1 text-xs tabular-nums">
                <span className="font-semibold text-emerald-300">+{d.gained}%</span>
                <span className="text-apptext-muted"> sun · </span>
                <span className="font-semibold text-apptext-soft">−{d.used}%</span>
                <span className="text-apptext-muted"> used</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default memo(CameraBatteryChart);
