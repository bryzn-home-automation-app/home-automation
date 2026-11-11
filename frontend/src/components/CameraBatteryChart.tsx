import { memo, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BATTERY_LOW,
  FULL_BATTERY_AXIS,
  batteryAxis,
  chargeKey,
  chargeLabel,
  chargeState,
  combinedBatterySeries,
  formatTimeTick,
  levelKey,
  nightWindows,
  summaryDays,
  timeTicks,
  type CombinedBatteryRow,
  type DaySummary,
} from '../utils/cameras';
import { formatDateTime, formatDayName, formatList } from '../utils/format';
import {
  Button,
  Chips,
  Disclosure,
  EmptyState,
  KV,
  KeyValue,
  LegendKey,
  Notice,
  QueryState,
  SkelBlock,
  TooltipCard,
  TooltipLine,
  useChartTheme,
  type ChartPalette,
  type QueryLike,
} from './ui';
import type { Camera, CameraBatteryHistory } from '../types';

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 } as const;
const percentTick = (v: number) => `${v}%`;

export type BatteryRange = 24 | 168 | 720;
const RANGES = [
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
] as const;

/** Fit the y-axis to the readings (the default), or show the whole 0–100% scale. */
type BatteryScale = 'fit' | 'full';
const SCALES = [
  { value: 'fit', label: 'Fit' },
  { value: 'full', label: '0–100%' },
] as const;

/**
 * One look per camera line, told apart by dash pattern as well as hue (colour-blind safe, and
 * still distinct in greyscale): ink solid, blue dashed, orange dotted, then teal and gold. The
 * hues are chart tokens, so they hold in light and dark and no finish changes them.
 */
const SERIES_STYLES = [
  { tone: 'ink', dash: undefined, pattern: 'solid' },
  { tone: 'cool', dash: '7 4', pattern: 'dashed' },
  { tone: 'heat', dash: '1 4', pattern: 'dotted' },
  { tone: 'water', dash: '10 3 2 3', pattern: 'dash-dot' },
  { tone: 'gas', dash: '3 3', pattern: 'short dashes' },
] as const satisfies ReadonlyArray<{ tone: keyof ChartPalette; dash: string | undefined; pattern: string }>;
type SeriesStyle = (typeof SERIES_STYLES)[number];
const styleFor = (i: number): SeriesStyle => SERIES_STYLES[i % SERIES_STYLES.length];

const LINE_WIDTH = 2;
/** The band drawn under a line while that camera charges: wide and translucent, in its own hue. */
const CHARGE_WIDTH = 9;
const CHARGE_OPACITY = 0.35;
/** The alert threshold: dotted graphite, a touch heavier than a hairline so it holds at any zoom. */
const THRESHOLD_WIDTH = 1.25;
const LOW_ZONE_OPACITY = 0.08;

/** One battery camera's history request, as the page's useQueries gives it. */
export interface BatteryTrackInput {
  camera: Camera;
  history: CameraBatteryHistory | undefined;
  loading: boolean;
  failed: boolean;
  refetch: () => void;
}

interface Track {
  camera: Camera;
  style: SeriesStyle;
  index: number;
  history: CameraBatteryHistory | undefined;
  /** Readings inside the window. */
  count: number;
  days: DaySummary[];
}

interface Combined {
  tracks: Track[];
  rows: CombinedBatteryRow[];
  nights: Array<{ from: number; to: number }>;
}

/** A legend / tooltip swatch: the camera's own line, dash and all. */
function LineSwatch({ colour, dash, charging, width = LINE_WIDTH }: { colour: string; dash?: string; charging?: boolean; width?: number }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" className="flex-none overflow-visible">
      {charging && <line x1="2" y1="5" x2="20" y2="5" stroke={colour} strokeOpacity={CHARGE_OPACITY} strokeWidth={CHARGE_WIDTH} strokeLinecap="round" />}
      <line x1="1" y1="5" x2="21" y2="5" stroke={colour} strokeWidth={width} strokeDasharray={dash} strokeLinecap={dash ? 'round' : 'butt'} />
    </svg>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: CombinedBatteryRow }>;
  tracks: Track[];
  palette: ChartPalette;
}

/** Every camera's level at the cursor's time, with the home clock's date and time. */
function BatteryTooltip({ active, payload, tracks, palette }: TooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TooltipCard title={formatDateTime(row.t)}>
      {tracks.map((tr) => {
        const v = row[levelKey(tr.index)];
        const charging = row[chargeKey(tr.index)] != null;
        return (
          <TooltipLine
            key={tr.camera.id}
            label={
              <span className="inline-flex items-center gap-2">
                <LineSwatch colour={palette[tr.style.tone]} dash={tr.style.dash} />
                {tr.camera.name}
              </span>
            }
            value={v == null ? 'no reading' : `${Math.round(v)}%${charging ? ' · charging' : ''}`}
          />
        );
      })}
    </TooltipCard>
  );
}

interface CameraBatteryChartProps {
  tracks: BatteryTrackInput[];
  range: BatteryRange;
  onRangeChange: (r: BatteryRange) => void;
}

/**
 * Every battery camera's level on one chart, inside the page's "Battery and solar" panel: a line
 * per camera (its own hue and dash), a translucent band under a line while that camera charges,
 * nights shaded, the alert threshold dotted, and each camera's day-by-day gains and use behind a
 * disclosure. A camera whose history didn't load is named above the chart; the others still draw.
 */
function CameraBatteryChart({ tracks: inputs, range, onRangeChange }: CameraBatteryChartProps) {
  const t = useChartTheme();
  const palette = t.series;

  // One pass per change of the histories or the range (the window moves on with each refresh).
  const { domain, ticks, anyLoading, loaded, missing, combined } = useMemo(() => {
    const to = Date.now();
    const from = to - range * 3_600_000;
    const anyLoading = inputs.some((x) => x.loading || (!x.history && !x.failed));
    const loaded = inputs.filter((x) => x.history);
    const missing = inputs.filter((x) => !x.history && x.failed);
    const base = { domain: [from, to] as [number, number], ticks: timeTicks(from, to, range), anyLoading, loaded, missing };
    // Drawn once every request has settled, so the lines never arrive one by one.
    if (anyLoading || !loaded.length) return { ...base, combined: undefined };
    const tracks: Track[] = inputs.map((x, i) => {
      const readings = x.history?.readings ?? [];
      return {
        camera: x.camera,
        style: styleFor(i),
        index: i,
        history: x.history,
        count: readings.length,
        // Only days that start inside the window (B-021), with sun told from a cable (B-109).
        days: summaryDays(readings, from, x.history?.daylight),
      };
    });
    // Every camera is at the same house: one set of nights, from whichever histories came in.
    const daylight = loaded.flatMap((x) => x.history?.daylight ?? []);
    const combined: Combined = {
      tracks,
      rows: combinedBatterySeries(inputs.map((x) => x.history?.readings ?? [])),
      nights: nightWindows(daylight, from, to),
    };
    return { ...base, combined };
  }, [inputs, range]);

  // Fitted to every camera's readings in the window: batteries that live between 20 and 50%
  // get the chart's whole height instead of its bottom half. The tooltip still says the exact %.
  const [scale, setScale] = useState<BatteryScale>('fit');
  const fitted = useMemo(
    () => (combined ? batteryAxis(combined.rows.flatMap((r) => combined.tracks.map((tr) => r[levelKey(tr.index)]))) : FULL_BATTERY_AXIS),
    [combined],
  );
  const axis = scale === 'fit' ? fitted : FULL_BATTERY_AXIS;
  const scaleWords = `${axis.domain[0]}–${axis.domain[1]}%`;
  // Healthy batteries zoom in above the alert line; the legend then says where it is instead.
  const thresholdOnScale = axis.domain[0] < BATTERY_LOW;

  const query: QueryLike<Combined> = {
    data: combined,
    isError: !anyLoading && !loaded.length && missing.length > 0,
    isFetching: inputs.some((x) => x.loading),
    refetch: () => missing.forEach((x) => x.refetch()),
  };

  const shown = combined?.tracks.filter((tr) => tr.history) ?? [];

  return (
    <div className="fp-stack">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Chips
          label="Battery range"
          value={String(range) as '24' | '168' | '720'}
          onChange={(v) => onRangeChange(Number(v) as BatteryRange)}
          options={RANGES}
        />
        {/* Nothing to zoom when the readings already need the whole scale. */}
        {!fitted.full && <Chips label="Battery scale" value={scale} onChange={setScale} options={SCALES} />}
      </div>
      <QueryState
        query={query}
        what={inputs.length === 1 ? `the ${inputs[0].camera.name} battery history` : 'the battery history'}
        compact
        loading={<SkelBlock height={240} />}
        isEmpty={(c) => !c.tracks.some((tr) => tr.count >= 2)}
        empty={
          <EmptyState compact icon="battery" title="Collecting data">
            The lines fill in as the cameras report their batteries, at least every 15 minutes.
          </EmptyState>
        }
      >
        {(c) => (
          <>
            {missing.length > 0 && (
              <Notice
                tone="headsup"
                title={`Couldn't load the ${formatList(missing.map((x) => x.camera.name))} battery history`}
                action={
                  <Button size="sm" icon="refresh" busy={query.isFetching} busyLabel="Trying again…" onClick={query.refetch}>
                    Try again
                  </Button>
                }
              >
                {missing.length === 1 ? 'It is' : 'They are'} left off the chart; the other {loaded.length === 1 ? 'camera is' : 'cameras are'} shown.
              </Notice>
            )}
            <div className="fp-chart-legend" aria-label="Cameras on the chart" role="list">
              {c.tracks.map((tr) => {
                const pct = tr.camera.batteryPercent;
                const { state, inferred } = chargeState(tr.camera, tr.history?.readings);
                const label = tr.history ? (tr.count ? chargeLabel(tr.camera, state, inferred) : 'no readings in this range') : 'not loaded';
                return (
                  <span key={tr.camera.id} className="fp-lg-item text-apptext" role="listitem">
                    <LineSwatch colour={palette[tr.style.tone]} dash={tr.style.dash} />
                    <span>
                      {tr.camera.name} <b className="fp-mono">{pct == null ? '—' : `${Math.round(pct)}%`}</b>
                      {label && <span className="text-apptext-muted">{` · ${label}`}</span>}
                    </span>
                  </span>
                );
              })}
            </div>
            <div
              className="h-[240px]"
              role="img"
              aria-label={`Battery level over the last ${RANGES.find((r) => r.value === String(range))?.label}: ${formatList(
                shown.map((tr) => `${tr.camera.name} (${tr.style.pattern} line)${tr.camera.batteryPercent == null ? '' : ` now ${Math.round(tr.camera.batteryPercent)}%`}`),
              )}. Scale ${scaleWords}.`}
            >
              <ResponsiveContainer width="100%" height="100%" debounce={80}>
                <LineChart data={c.rows} margin={CHART_MARGIN}>
                  {c.nights.map((n) => (
                    <ReferenceArea key={n.from} x1={n.from} x2={n.to} y1={axis.domain[0]} y2={axis.domain[1]} fill={palette.band} ifOverflow="hidden" />
                  ))}
                  {/* Below the alert line, a faint warm wash: a line sitting on 30% still reads against it. */}
                  {thresholdOnScale && (
                    <ReferenceArea y1={axis.domain[0]} y2={BATTERY_LOW} fill={palette.warn} fillOpacity={LOW_ZONE_OPACITY} ifOverflow="hidden" />
                  )}

                  <CartesianGrid {...t.grid} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={domain}
                    ticks={ticks}
                    tickFormatter={(v: number) => formatTimeTick(v, range)}
                    {...t.axis}
                    // A phone fits about every other 3-hour tick; Recharts drops the ones that would touch.
                    minTickGap={14}
                  />
                  <YAxis {...t.axis} domain={axis.domain} ticks={axis.ticks} tickFormatter={percentTick} width={44} />
                  {thresholdOnScale && <ReferenceLine y={BATTERY_LOW} {...t.reference} strokeWidth={THRESHOLD_WIDTH} />}
                  <Tooltip
                    content={<BatteryTooltip tracks={shown} palette={palette} />}
                    cursor={t.tooltip.cursor}
                    wrapperStyle={t.tooltip.wrapperStyle}
                  />
                  {/* Charging bands first, so every camera's line sits on top of every band. */}
                  {shown.map((tr) => (
                    <Line
                      key={`c-${tr.camera.id}`}
                      dataKey={chargeKey(tr.index)}
                      name={`${tr.camera.name} charging`}
                      type="linear"
                      stroke={palette[tr.style.tone]}
                      strokeOpacity={CHARGE_OPACITY}
                      strokeWidth={CHARGE_WIDTH}
                      strokeLinecap="round"
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  {shown.map((tr) => (
                    <Line
                      key={`v-${tr.camera.id}`}
                      dataKey={levelKey(tr.index)}
                      name={tr.camera.name}
                      type="linear"
                      stroke={palette[tr.style.tone]}
                      strokeWidth={LINE_WIDTH}
                      strokeDasharray={tr.style.dash}
                      strokeLinecap={tr.style.dash ? 'round' : 'butt'}
                      dot={false}
                      activeDot={{ r: 3.5, strokeWidth: 0, fill: palette[tr.style.tone] }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="fp-chart-legend">
              <span className="fp-lg-item">
                <LineSwatch colour={palette.graphite} charging />
                Charging (wide band under the line)
              </span>
              <span className="fp-lg-item">
                <LegendKey tone="band" kind="band" />
                Night
              </span>
              <span className="fp-lg-item">
                {/* The threshold's own dots, not a dash a camera line could be mistaken for. */}
                <LineSwatch colour={t.reference.stroke} dash={t.reference.strokeDasharray} width={THRESHOLD_WIDTH} />
                {thresholdOnScale ? `Alert at ${BATTERY_LOW}%, shaded below` : `Alert at ${BATTERY_LOW}%, below this scale`}
              </span>
              {!axis.full && <span className="fp-lg-item fp-mono">Scale {scaleWords}</span>}
            </div>
            {shown.some((tr) => tr.days.length > 0) && (
              <Disclosure variant="row" summary="Charged and used, day by day" openSummary="Hide day by day">
                <div className="fp-stack fp-stack--l pt-3">
                  {shown
                    .filter((tr) => tr.days.length > 0)
                    .map((tr) => (
                      <section key={tr.camera.id} className="fp-stack fp-stack--s" aria-label={`${tr.camera.name}, day by day`}>
                        <h3 className="flex items-center gap-2 text-small font-semibold">
                          <LineSwatch colour={palette[tr.style.tone]} dash={tr.style.dash} />
                          {tr.camera.name}
                        </h3>
                        <KeyValue>
                          {tr.days.map((d) => (
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
                      </section>
                    ))}
                </div>
              </Disclosure>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

export default memo(CameraBatteryChart);
