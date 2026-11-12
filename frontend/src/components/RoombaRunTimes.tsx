import { memo, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { RoombaRun } from '../types';
import { FALSE_START_MINUTES, TYPICAL_MIN_CLEANS, minuteTicks, runTimeSummary, type RunTimeBar } from '../utils/roomba';
import { runStatus } from '../utils/roombaStatus';
import { DASH, formatDayName, formatDuration, formatNumber, formatShortDate, plural } from '../utils/format';
import { EmptyState, LegendKey, Panel, Readout, Readouts, SkelBlock, useChartTheme, type QueryLike } from './ui';

// The right margin leaves room for the last date, centred under the newest bar.
const MARGIN = { top: 8, right: 18, left: 0, bottom: 0 } as const;
const Y_WIDTH = 46;
const HEIGHT = 170;
/** The surface gap between a bar's parts, the rounding of its top and a hollow bar's edge. */
const GAP = 2;
const RADIUS = 4;
const OUTLINE = 1.5;

type Part = 'floor' | 'charging' | 'paused';
/**
 * Fixed chart tokens, never the accent: ink for the cleaning itself, gold for recharging and
 * graphite for paused. They stay apart in light and dark and for colour-blind eyes (checked
 * against both panels), and the legend and readout name every part in words.
 */
const PARTS = [
  { key: 'floor', tone: 'ink', label: 'Cleaning' },
  { key: 'charging', tone: 'gas', label: 'Recharging' },
  { key: 'paused', tone: 'graphite', label: 'Paused' },
] as const satisfies ReadonlyArray<{ key: Part; tone: 'ink' | 'gas' | 'graphite'; label: string }>;

interface Row {
  /** The run id as the category, so two cleans on one day stay two bars. */
  key: string;
  floor: number;
  charging: number;
  paused: number;
  bar: RunTimeBar;
}

/** A bar part with a square base and, on top, rounded corners. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * One part of a run's bar: a 2px gap under the part above it, rounded only at the bar's top,
 * and hollow when the run didn't finish (its time off the dock includes waiting where it stopped).
 */
function partShape(part: Part, colour: string) {
  return function PartShape(props: unknown) {
    const { x = 0, y = 0, width = 0, height = 0, payload } = props as { x?: number; y?: number; width?: number; height?: number; payload?: Row };
    if (!payload || width <= 0 || height <= 0) return <g />;
    const above = part === 'floor' ? payload.charging + payload.paused : part === 'charging' ? payload.paused : 0;
    let top = y;
    let h = height;
    if (above > 0 && h > GAP + 0.5) {
      top += GAP;
      h -= GAP;
    }
    const r = above > 0 ? 0 : RADIUS;
    if (!payload.bar.finished && h >= 3 && width >= 3) {
      const i = OUTLINE / 2;
      return <path d={topRounded(x + i, top + i, width - OUTLINE, h - OUTLINE, r - i)} fill="none" stroke={colour} strokeWidth={OUTLINE} />;
    }
    return <path d={topRounded(x, top, width, h, r)} fill={colour} />;
  };
}

/** "iRummy couldn't return to Dock" from iRobot's two-sentence error titles. */
function firstSentence(text: string): string {
  const i = text.indexOf('. ');
  return (i > 0 ? text.slice(0, i) : text).replace(/\.$/, '');
}

const TYPICAL_WIDTH = 1.25;

/** The typical-cleaning line's own dots for the legend (the kit's dash key would be a different mark). */
function ReferenceSwatch({ colour, dash }: { colour: string; dash: string }) {
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true" className="flex-none">
      <line x1="0" y1="5" x2="16" y2="5" stroke={colour} strokeWidth={TYPICAL_WIDTH} strokeDasharray={dash} />
    </svg>
  );
}

const minuteTick = (m: number) => (m === 0 ? '0' : m < 60 ? `${m} min` : `${formatNumber(m / 60, { decimals: 1 })} hr`);

/** The readout line for one clean: its day, how it ended if it didn't finish, each part with its time, the area. */
function RunReadout({ bar, now }: { bar: RunTimeBar; now: Date }) {
  return (
    <>
      <span className="fp-rd-when">{formatDayName(bar.startedAt, now)}</span>
      {!bar.finished && (
        <span className="fp-rd-item">
          <b>{runStatus(bar.status).label}</b>
          {bar.errorText ? `: ${firstSentence(bar.errorText)}` : ''}
        </span>
      )}
      <span className="fp-rd-item">
        <LegendKey tone="ink" kind={bar.finished ? 'box' : 'outline'} />
        {bar.finished ? 'Cleaning' : 'Off the dock'} <b>{formatDuration(bar.floor)}</b>
      </span>
      {bar.charging > 0 && (
        <span className="fp-rd-item">
          <LegendKey tone="gas" kind={bar.finished ? 'box' : 'outline'} />
          Recharging <b>{formatDuration(bar.charging)}</b>
        </span>
      )}
      {bar.paused > 0 && (
        <span className="fp-rd-item">
          <LegendKey tone="graphite" kind={bar.finished ? 'box' : 'outline'} />
          Paused <b>{formatDuration(bar.paused)}</b>
        </span>
      )}
      {bar.squareFeet != null && (
        <span className="fp-rd-item">
          <b>{formatNumber(bar.squareFeet)}</b> sq ft
        </span>
      )}
    </>
  );
}

/** "3 hr 4 min" as a readout figure, the units in mono like every other readout. */
function durationFigure(minutes: number | null): { value: ReactNode; unit?: string } {
  if (minutes == null) return { value: DASH };
  const m = Math.round(minutes);
  if (m < 60) return { value: String(m), unit: 'min' };
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!rest) return { value: String(h), unit: 'hr' };
  return { value: <>{h}<span className="fp-unit">hr</span> {rest}</>, unit: 'min' };
}

interface RoombaRunTimesProps {
  query: QueryLike<RoombaRun[]>;
  /** A clean is under way now (its run is charted once it ends and the cloud confirms it). */
  cleaningNow: boolean;
  now: Date;
}

/**
 * Time per clean on the Overview: a stacked bar per recent clean (cleaning, recharging partway,
 * paused), two headline figures, and a readout line that names the latest clean or the one under
 * the pointer, a finger or the arrow keys. Only cloud-confirmed runs are charted; false starts
 * are counted under the chart, and a clean that hasn't been confirmed yet is said to be coming.
 */
function RoombaRunTimes({ query, cleaningNow, now }: RoombaRunTimesProps) {
  const t = useChartTheme();
  const runs = query.data;
  const summary = useMemo(() => runTimeSummary(runs ?? []), [runs]);
  const { bars, typicalCleaning, finished, recharged, falseStarts, pending } = summary;
  const rows = useMemo<Row[]>(
    () => bars.map((b) => ({ key: String(b.id), floor: b.floor, charging: b.charging, paused: b.paused, bar: b })),
    [bars],
  );
  const ticks = useMemo(() => minuteTicks(Math.max(0, ...bars.map((b) => b.total))), [bars]);
  const shapes = useMemo(() => PARTS.map((p) => partShape(p.key, t.series[p.tone])), [t]);

  const n = rows.length;
  const [hot, setHot] = useState<number | null>(null);
  const shown = hot != null && hot < n ? hot : n - 1;
  const current = rows[shown]?.bar ?? null;

  // The pointer's x to a bar: the plot starts after the y-axis and splits evenly into n bands,
  // which is how Recharts lays out a category axis. Reading the box on an event is fine.
  const indexAt = (e: PointerEvent<HTMLDivElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const left = MARGIN.left + Y_WIDTH;
    const width = r.width - left - MARGIN.right;
    if (!n || width <= 0) return null;
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left - left) / width) * n)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(n - 1, shown + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, shown - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next == null) return;
    e.preventDefault();
    setHot(next);
  };

  const notes = [
    cleaningNow
      ? "A clean is under way; it shows here once it ends and iRobot confirms its times."
      : pending
        ? 'The latest clean shows here once iRobot confirms its times, usually within half an hour.'
        : null,
    falseStarts > 0 ? `${plural(falseStarts, 'false start')} under ${FALSE_START_MINUTES} min not shown.` : null,
  ].filter(Boolean).join(' ');

  let body;
  if (runs === undefined) {
    body = query.isError
      ? <p className="fp-small fp-muted">The chart shows once the recent cleans load.</p>
      : <SkelBlock height={HEIGHT} />;
  } else if (!n) {
    body = (
      <EmptyState compact icon="bar-chart" title="Nothing to chart yet">
        {notes || "Each clean's cleaning, recharging and paused time shows here once iRobot confirms the run."}
      </EmptyState>
    );
  } else {
    const unfinished = n - finished;
    const typical = durationFigure(typicalCleaning);
    const caption = [
      typicalCleaning != null ? `A typical clean is ${formatDuration(typicalCleaning)} of cleaning.` : null,
      finished ? `${recharged} of ${plural(finished, 'finished clean')} stopped to recharge.` : null,
      unfinished ? `${unfinished} of the ${plural(n, 'clean')} didn't finish.` : null,
    ].filter(Boolean).join(' ');
    body = (
      <div className="fp-stack fp-stack--m">
        <Readouts count={2}>
          {/* The typical time is the middle of the finished cleans' cleaning times. */}
          <Readout
            plain
            label="Typical clean"
            value={typical.value}
            unit={typical.unit}
            note={typicalCleaning != null ? 'Cleaning time' : `Shown after ${TYPICAL_MIN_CLEANS} finished cleans`}
          />
          <Readout
            plain
            label="Recharged"
            value={finished ? String(recharged) : DASH}
            unit={finished ? `of ${finished}` : undefined}
            note={finished ? 'Finished cleans' : 'Counted once one finishes'}
          />
        </Readouts>
        <figure className="fp-chart">
          <figcaption className="fp-sr-only">{caption}</figcaption>
          <div className="fp-chart-head">
            <div className="fp-chart-legend">
              {PARTS.filter((p) => p.key === 'floor' || bars.some((b) => b[p.key] > 0)).map((p) => (
                <span key={p.key} className="fp-lg-item"><LegendKey tone={p.tone} kind="box" />{p.label}</span>
              ))}
              {unfinished > 0 && <span className="fp-lg-item"><LegendKey tone="ink" kind="outline" />Didn't finish</span>}
              {typicalCleaning != null && (
                <span className="fp-lg-item"><ReferenceSwatch colour={t.reference.stroke} dash={t.reference.strokeDasharray} />Typical cleaning</span>
              )}
            </div>
            {/* Every clean's readout fills the same grid cell, so the line keeps the height of the
                tallest and the chart doesn't jump under a finger; only the shown one is visible. */}
            <div className="grid">
              {rows.map((r) => (
                <div key={r.key} className="fp-chart-readout invisible col-start-1 row-start-1" aria-hidden="true">
                  <RunReadout bar={r.bar} now={now} />
                </div>
              ))}
              <div className="fp-chart-readout col-start-1 row-start-1" aria-live="polite">
                {current && <RunReadout bar={current} now={now} />}
              </div>
            </div>
          </div>
          <div
            className="relative touch-pan-y outline-offset-4"
            style={{ height: HEIGHT }}
            tabIndex={0}
            role="group"
            aria-label={`${caption} Use the arrow keys to read each clean.`}
            onPointerDown={(e) => setHot(indexAt(e))}
            onPointerMove={(e) => {
              // A mouse reads as it moves; a finger reads where it touches and as it slides.
              if (e.pointerType === 'mouse' || e.buttons) setHot(indexAt(e));
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setHot(null);
            }}
            onBlur={() => setHot(null)}
            onKeyDown={onKey}
          >
            <ResponsiveContainer width="100%" height="100%" debounce={80}>
              <BarChart data={rows} margin={MARGIN} barCategoryGap="28%">
                {hot != null && rows[shown] && (
                  <ReferenceArea x1={rows[shown].key} x2={rows[shown].key} fill={t.series.band} fillOpacity={1} ifOverflow="hidden" />
                )}
                <CartesianGrid {...t.grid} />
                <XAxis
                  dataKey="key"
                  {...t.axis}
                  tickFormatter={(key: string) => formatShortDate(rows.find((r) => r.key === key)?.bar.startedAt)}
                  interval="preserveStartEnd"
                  minTickGap={18}
                />
                <YAxis {...t.axis} width={Y_WIDTH} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={minuteTick} />
                {PARTS.map((p, i) => (
                  <Bar key={p.key} dataKey={p.key} name={p.label} stackId="run" fill={t.series[p.tone]} shape={shapes[i]} maxBarSize={24} isAnimationActive={false} />
                ))}
                {typicalCleaning != null && <ReferenceLine y={typicalCleaning} {...t.reference} strokeWidth={TYPICAL_WIDTH} ifOverflow="hidden" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        {notes && <p className="fp-small fp-muted">{notes}</p>}
      </div>
    );
  }

  return (
    <Panel
      title="Time per clean"
      subtitle={n > 1 ? `The last ${n} cleans, start to finish` : 'Each clean, start to finish'}
    >
      {body}
    </Panel>
  );
}

export default memo(RoombaRunTimes);
