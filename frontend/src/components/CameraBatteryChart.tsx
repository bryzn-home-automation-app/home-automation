import { memo, useId, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BATTERY_LOW, batterySeries, formatTimeTick, nightWindows, summaryDays, timeTicks } from '../utils/cameras';
import { formatDateTime, formatDayName } from '../utils/format';
import { BatteryBadge } from './CameraTile';
import { Chips, DialLegend, Disclosure, EmptyState, ErrorState, KV, KeyValue, Loading, SkelBlock, useChartTheme } from './ui';
import type { Camera, CameraBatteryHistory } from '../types';
import type { ChargeState } from '../utils/cameras';

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 } as const;
const Y_TICKS = [0, 25, 50, 75, 100];

export type BatteryRange = 24 | 168 | 720;
const RANGES = [
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
] as const;

interface CameraBatteryChartProps {
  camera: Camera;
  history: CameraBatteryHistory | undefined;
  loading: boolean;
  /** The history failed to load and there is nothing to show (B-005). */
  failed: boolean;
  onRetry: () => void;
  range: BatteryRange;
  onRangeChange: (r: BatteryRange) => void;
  charge: { state: ChargeState; inferred: boolean };
}

/**
 * One battery camera's level over time, inside the page's single "Battery and solar" panel:
 * charging in the ok green, on battery in ink, nights shaded, the alert threshold dotted, and
 * the day-by-day gains and use behind a disclosure.
 */
function CameraBatteryChart({ camera, history, loading, failed, onRetry, range, onRangeChange, charge }: CameraBatteryChartProps) {
  const t = useChartTheme();
  const headingId = useId();
  const { points, domain, nights, days, ticks } = useMemo(() => {
    const now = Date.now();
    const from = now - range * 3_600_000;
    const readings = history?.readings ?? [];
    return {
      points: batterySeries(readings),
      domain: [from, now] as [number, number],
      nights: nightWindows(history?.daylight ?? [], from, now),
      // Only days that start inside the window (B-021), with sun told from a cable (B-109).
      days: summaryDays(readings, from, history?.daylight),
      ticks: timeTicks(from, now, range),
    };
  }, [history, range]);

  const hasHistory = points.length >= 2;

  let body;
  if (failed && !history) {
    body = <ErrorState compact title={`Couldn't load the ${camera.name} battery history`} onRetry={onRetry} />;
  } else if (loading || !history) {
    body = (
      <Loading label={`Loading the ${camera.name} battery history`}>
        <SkelBlock height={200} />
      </Loading>
    );
  } else if (!hasHistory) {
    body = (
      <EmptyState compact icon="battery" title="Collecting data">
        The line fills in as the camera reports its battery, and at least every 15 minutes.
      </EmptyState>
    );
  } else {
    body = (
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%" debounce={80}>
          <LineChart data={points} margin={CHART_MARGIN}>
            {nights.map((n) => (
              <ReferenceArea key={n.from} x1={n.from} x2={n.to} y1={0} y2={100} fill={t.series.band} ifOverflow="hidden" />
            ))}
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
            <YAxis {...t.axis} domain={[0, 100]} ticks={Y_TICKS} unit="%" width={44} />
            <ReferenceLine y={BATTERY_LOW} {...t.reference} />
            <Tooltip
              {...t.tooltip}
              labelFormatter={(v: number) => formatDateTime(v)}
              formatter={(value: number, key: string) => [`${Math.round(Number(value))}%`, key === 'charge' ? 'Charging' : 'On battery']}
            />
            <Line dataKey="drain" type="linear" stroke={t.series.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="charge" type="linear" stroke={t.series.ok} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <section className="fp-stack" aria-labelledby={headingId}>
      <div className="flex flex-col gap-1">
        <h3 className="text-section font-semibold" id={headingId}>{camera.name}</h3>
        <BatteryBadge camera={camera} state={charge.state} inferred={charge.inferred} />
      </div>
      <Chips
        label={`${camera.name} battery range`}
        value={String(range) as '24' | '168' | '720'}
        onChange={(v) => onRangeChange(Number(v) as BatteryRange)}
        options={RANGES}
      />
      <DialLegend
        className="justify-start"
        items={[
          { label: 'Charging', tone: 'ok', key: 'line' },
          { label: 'On battery', tone: 'ink', key: 'line' },
          { label: 'Night', tone: 'band', key: 'band' },
          { label: `Under ${BATTERY_LOW}%`, tone: 'graphite', key: 'dash' },
        ]}
      />
      {body}
      {days.length > 0 && (
        <Disclosure variant="row" summary="Charged and used, day by day" openSummary="Hide day by day">
          <KeyValue>
            {days.map((d) => (
              <KV
                key={d.day}
                label={formatDayName(d.day)}
                value={
                  <>
                    <span className="fp-t-ok">
                      +{d.gained}% {d.solar ? 'sun' : 'charged'}
                    </span>
                    {` · −${d.used}% used`}
                  </>
                }
              />
            ))}
          </KeyValue>
        </Disclosure>
      )}
    </section>
  );
}

export default memo(CameraBatteryChart);
