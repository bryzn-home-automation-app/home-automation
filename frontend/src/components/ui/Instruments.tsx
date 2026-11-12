import { useId, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx, knobs } from './cx';
import { Lamp } from './Status';

/*
 * The instruments, ported from the prototype's charts.js (docs/faceplate/prototype): Dial
 * (the page's instrument: rings, segments, ticks, marks, a needle, an HTML centre), Ring (one
 * fraction), Gauge (one value on a classic 270° scale), Spark, ShareBar (parts of a whole)
 * and LampMatrix (a strip of status cells: sync coverage, a run of days).
 *
 * Like charts.js they never measure the DOM to draw: every shape is inline SVG in a viewBox
 * (a dial is 240 × 240 around 120,120) or HTML placed in percent, so they render the same on
 * the server, in tests and while hidden. Colours are tokens (var(--app…)), so a theme or finish
 * change needs no re-render. The dial's sweep-in is CSS (fp-dl-sweep / fp-dl-needle-g) and
 * stops under prefers-reduced-motion (styles/faceplate.css §27).
 *
 * Recharts stays for the big time-series charts; see chartTheme.ts.
 */

export type ChartTone =
  | 'ink' | 'graphite' | 'soft' | 'heat' | 'cool' | 'water' | 'gas'
  | 'ok' | 'warn' | 'problem' | 'info' | 'day' | 'night' | 'track' | 'empty' | 'band';

const TONE_VAR: Record<ChartTone, string> = {
  ink: '--appchart-ink', graphite: '--appchart-graphite', soft: '--appchart-soft', heat: '--appchart-heat',
  cool: '--appchart-cool', water: '--appchart-water', gas: '--appchart-gas', ok: '--applamp-ok', warn: '--applamp-warn',
  problem: '--applamp-problem', info: '--applamp-info', day: '--appdial-day', night: '--appdial-night',
  track: '--appdial-track', empty: '--appchart-empty', band: '--appchart-band',
};

/** The CSS colour of a chart tone: var(--appchart-heat). */
export function toneColor(tone: ChartTone = 'ink'): string {
  return `var(${TONE_VAR[tone] ?? TONE_VAR.ink})`;
}

/** An SVG-safe id from useId (its colons are awkward inside url(#…)). */
function svgId(raw: string): string {
  return `fp${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// ─── Dial geometry ──────────────────────────────────────────────────────

/** A point on a circle around the dial's centre; 0° is the top, clockwise. */
export function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [120 + r * Math.cos(a), 120 + r * Math.sin(a)];
}

/** An SVG arc from a0 to a1 degrees (a full circle is drawn as two halves). */
export function arcPath(r: number, a0: number, a1: number): string {
  if (a1 - a0 >= 359.99) {
    const m = a0 + 180;
    return `${arcPath(r, a0, m)} ${arcPath(r, m, a0 + 359.99).replace(/^M[^A]+/, '')}`;
  }
  const p0 = polar(r, a0);
  const p1 = polar(r, a1);
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}

export interface DialSegment {
  from: number;
  to: number;
  tone?: ChartTone;
  /** Dashed (a forecast, a range). */
  dash?: boolean;
  /** Band width (default the ring's). */
  w?: number;
  /** Context that doesn't sweep in (daylight hours). */
  static?: boolean;
}

export interface DialMark {
  /** A setpoint, "last bill": a short tick across the band. */
  at: number;
  tone?: ChartTone;
  label?: string;
  inset?: number;
  out?: number;
}

export interface DialRing {
  /** Radius (≤ 92 for an outer ring with labels outside). */
  r?: number;
  /** Band width. */
  w?: number;
  min?: number;
  max?: number;
  /** false: no track behind the band. */
  track?: boolean;
  trackTone?: ChartTone;
  /** An engraved hairline edge round the track. */
  edge?: boolean;
  /** Tick count, every `major`-th one long. */
  ticks?: number;
  major?: number;
  tickSide?: 'in' | 'out';
  /** [value, text] pairs, placed outside (inside with tickSide 'in'). Keep them off the needle's path. */
  labels?: Array<[number, string]>;
  labelR?: number;
  /** Degrees left empty between segments. */
  gap?: number;
  segments?: DialSegment[];
  marks?: DialMark[];
  /** pointer: a bold tick across the ring (works with centre text). needle: from the hub (no centre text). */
  needle?: { at: number; style?: 'pointer' | 'needle' };
}

export interface DialProps {
  rings: DialRing[];
  /** The angle of `min`, degrees from the top, clockwise. −135 + sweep 270 = the classic gauge. */
  start?: number;
  sweep?: number;
  /** A half dial (start −90, sweep 180): a wider, shorter box with the centre at the bottom. */
  half?: boolean;
  /** The centre: DialCentre (a label, the big number, a note). */
  children?: ReactNode;
  /** A sentence for screen readers when the centre text doesn't say it all. */
  label?: string;
  /** Max width in px (default 240 on a phone / 300 on desktop, the --appdial-max token). */
  size?: number;
  /** Exactly `size` wide, never shrinking (a small dial beside a row; Ring sets it). */
  fixed?: boolean;
  className?: string;
}

/** THE instrument. One or more concentric rings in a square SVG with an HTML centre. */
export function Dial({ rings, start = -135, sweep = 270, half, children, label, size, fixed, className }: DialProps) {
  const maskId = svgId(useId());
  const scale: ReactNode[] = [];
  const data: ReactNode[] = [];
  const needles: ReactNode[] = [];

  rings.forEach((ring, ri) => {
    const r = ring.r ?? 92;
    const w = ring.w ?? 10;
    const min = ring.min ?? 0;
    const max = ring.max ?? 100;
    const A = (v: number) => start + ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * sweep;
    const k = `r${ri}`;
    if (ring.edge) {
      scale.push(<path key={`${k}e`} d={arcPath(r, start, start + sweep)} className="fp-dl-track" style={{ strokeWidth: w + 2, stroke: 'var(--appborder-strong)' }} />);
    }
    if (ring.track !== false) {
      scale.push(<path key={`${k}t`} d={arcPath(r, start, start + sweep)} className="fp-dl-track" style={{ strokeWidth: w, stroke: ring.trackTone ? toneColor(ring.trackTone) : undefined }} />);
    }
    const inside = ring.tickSide === 'in';
    if (ring.ticks) {
      const n = ring.ticks;
      const major = ring.major ?? 0;
      const full = sweep >= 359.99;
      for (let i = 0; i <= n; i++) {
        if (full && i === n) break;
        const a = start + (i / n) * sweep;
        const isMajor = major > 0 && i % major === 0;
        const r0 = inside ? r - w / 2 - 2 : r + w / 2 + 2;
        const r1 = inside ? r0 - (isMajor ? 7 : 4) : r0 + (isMajor ? 7 : 4);
        const p0 = polar(r0, a);
        const p1 = polar(r1, a);
        scale.push(<line key={`${k}k${i}`} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} className={cx('fp-dl-tick', isMajor && 'fp-dl-tick--major')} />);
      }
    }
    (ring.labels ?? []).forEach(([value, text], li) => {
      const la = A(value);
      const sx = Math.sin((la * Math.PI) / 180);
      const side = Math.abs(sx) > 0.5;
      const lr = ring.labelR ?? (inside ? r - w / 2 - (side ? 13 : 16) : r + w / 2 + (side ? 13 : 17));
      const p = polar(lr, la);
      const anchor = !side ? 'middle' : (sx > 0) !== inside ? 'start' : 'end';
      scale.push(<text key={`${k}l${li}`} x={p[0].toFixed(1)} y={p[1].toFixed(1)} textAnchor={anchor} dominantBaseline="central" className="fp-dl-text">{text}</text>);
    });
    const gap = ring.gap ?? 0;
    (ring.segments ?? []).forEach((sg, si) => {
      const a0 = A(sg.from) + gap / 2;
      const a1 = A(sg.to) - gap / 2;
      if (a1 <= a0) return;
      const el = (
        <path
          key={`${k}s${si}`}
          d={arcPath(r, a0, a1)}
          className={cx('fp-dl-seg', sg.dash && 'fp-dl-seg--dash')}
          style={{ stroke: toneColor(sg.tone ?? 'ink'), strokeWidth: sg.w ?? w }}
        />
      );
      (sg.static ? scale : data).push(el);
    });
    (ring.marks ?? []).forEach((mk, mi) => {
      const a = A(mk.at);
      const p0 = polar(r - w / 2 - (mk.inset ?? 3), a);
      const p1 = polar(r + w / 2 + (mk.out ?? 5), a);
      scale.push(<line key={`${k}m${mi}`} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} className="fp-dl-mark" style={mk.tone ? { stroke: toneColor(mk.tone) } : undefined} />);
      if (mk.label) {
        const pl = polar(r + w / 2 + 14, a);
        scale.push(<text key={`${k}ml${mi}`} x={pl[0].toFixed(1)} y={pl[1].toFixed(1)} textAnchor="middle" dominantBaseline="central" className="fp-dl-mark-text">{mk.label}</text>);
      }
    });
    if (ring.needle) {
      const an = A(ring.needle.at);
      const from = knobs({ '--fp-from': `${start - an}deg` });
      if (ring.needle.style === 'needle') {
        const q0 = polar(-10, an);
        const q1 = polar(r + w / 2 + 2, an);
        needles.push(
          <g key={`${k}n`} className="fp-dl-needle-g" style={from}>
            <line x1={q0[0]} y1={q0[1]} x2={q1[0]} y2={q1[1]} className="fp-dl-needle" />
            <circle cx={120} cy={120} r={6} className="fp-dl-hub" />
          </g>,
        );
      } else {
        const s0 = polar(r - w / 2 - 6, an);
        const s1 = polar(r + w / 2 + 6, an);
        const tip = polar(r + w / 2 + 9, an);
        needles.push(
          <g key={`${k}n`} className="fp-dl-needle-g" style={from}>
            <line x1={s0[0]} y1={s0[1]} x2={s1[0]} y2={s1[1]} className="fp-dl-needle" />
            <circle cx={tip[0]} cy={tip[1]} r={3} className="fp-dl-hub" />
          </g>,
        );
      }
    }
  });

  const style: CSSProperties | undefined = size ? knobs({ '--fp-dial-max': `${size}px` }) : undefined;
  return (
    <div className={cx('fp-dial', half && 'fp-dial--half', fixed && size && 'fp-dial--fixed', className)} style={style} role={label ? 'img' : undefined} aria-label={label}>
      <svg viewBox={half ? '0 -2 240 136' : '0 0 240 240'} aria-hidden="true" focusable="false">
        <defs>
          {/* The data arcs are revealed by one wide masked stroke that sweeps round once. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-40} y={-40} width={320} height={320} style={{ maskType: 'alpha' }}>
            <path
              d={arcPath(62, start, start + sweep)}
              pathLength={100}
              strokeDasharray="100 100"
              className="fp-dl-sweep"
              fill="none"
              style={{ stroke: 'var(--appmask)', strokeWidth: 130 }}
            />
          </mask>
        </defs>
        <g>{scale}</g>
        <g mask={`url(#${maskId})`}>{data}</g>
        <g>{needles}</g>
      </svg>
      {children}
    </div>
  );
}

/** A dial's centre: a silk-screen label, the big number, a note. Keep it to three lines. */
export function DialCentre({ label, children, note, noteMono }: { label?: ReactNode; children: ReactNode; note?: ReactNode; noteMono?: boolean }) {
  return (
    <div className="fp-dial-centre">
      {label != null && <span className="fp-label">{label}</span>}
      {children}
      {note != null && <span className={cx('fp-dial-note', noteMono && 'fp-mono')}>{note}</span>}
    </div>
  );
}

export interface LegendItem {
  label: ReactNode;
  /** The value, in mono bold. */
  value?: ReactNode;
  tone?: ChartTone;
  /** line (default), dash, box, outline (a hollow box: a partial bar), seg (dashed band), mark (tick), band, today. */
  key?: 'line' | 'dash' | 'box' | 'outline' | 'seg' | 'mark' | 'band' | 'today';
}

/** The legend under a dial (or a chart): what each colour and mark means. */
export function DialLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <div className={cx('fp-dial-legend', className)}>
      {items.map((it, i) => (
        <span key={i} className="fp-lg-item">
          <LegendKey tone={it.tone} kind={it.key} />
          {it.label}
          {it.value != null && <> <b>{it.value}</b></>}
        </span>
      ))}
    </div>
  );
}

/** One legend swatch. */
export function LegendKey({ tone = 'ink', kind = 'line' }: { tone?: ChartTone; kind?: LegendItem['key'] }) {
  return (
    <span
      className={cx('fp-lg-key', kind !== 'line' && `fp-lg-key--${kind}`)}
      style={knobs({ '--fp-c': toneColor(tone) })}
      aria-hidden="true"
    />
  );
}

// ─── Ring and Gauge ─────────────────────────────────────────────────────

export interface RingProps {
  /** 0–1. */
  value: number;
  tone?: ChartTone;
  /** Band width in the 240 box (default 20). */
  width?: number;
  /** Rendered size in px (64–96 beside a row; up to a dial's size). */
  size?: number;
  /** The centre (a small Num). */
  children?: ReactNode;
  label?: string;
  className?: string;
}

/** A small round gauge for one fraction (a guest's days left, a battery). */
export function Ring({ value, tone = 'ink', width = 20, size, children, label, className }: RingProps) {
  const v = Math.max(0.001, Math.min(1, value));
  return (
    <Dial
      start={0}
      sweep={360}
      size={size}
      // With a size, a ring holds it (no fixed-width wrapper needed in a flex row).
      fixed={size != null}
      label={label}
      className={className}
      rings={[{ r: 110 - width / 2, w: width, min: 0, max: 1, segments: [{ from: 0, to: v, tone }] }]}
    >
      {children != null && <div className="fp-dial-centre">{children}</div>}
    </Dial>
  );
}

export interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  tone?: ChartTone;
  /** Coloured zones behind the value (a server temperature's heads-up band). */
  zones?: DialSegment[];
  ticks?: number;
  major?: number;
  labels?: Array<[number, string]>;
  size?: number;
  children?: ReactNode;
  label?: string;
  className?: string;
}

/** One value on the classic 270° scale: a filled arc to the value with a pointer. */
export function Gauge({ value, min = 0, max = 100, tone = 'ink', zones = [], ticks, major, labels, size, children, label, className }: GaugeProps) {
  const v = Math.max(min, Math.min(max, value));
  return (
    <Dial
      size={size}
      label={label}
      className={className}
      rings={[{
        r: 88, w: 10, min, max, ticks, major, labels,
        segments: [...zones.map((z) => ({ ...z, static: true, w: 4 })), { from: min, to: v, tone }],
        needle: { at: v },
      }]}
    >
      {children}
    </Dial>
  );
}

// ─── Spark ──────────────────────────────────────────────────────────────

export interface SparkProps {
  values: ReadonlyArray<number | null>;
  tone?: ChartTone;
  area?: boolean;
  /** Plot height in px (default 32); it fills its box's width. */
  height?: number;
  /** What the trend says, for screen readers. Without it the spark is decorative. */
  label?: string;
  className?: string;
}

/** A small trend line with a dot on the latest value. Gaps (null) are skipped. */
export function Spark({ values, tone = 'ink', area, height = 32, label, className }: SparkProps) {
  const pts: Array<[number, number]> = [];
  const real = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (real.length) {
    let lo = Math.min(...real);
    let hi = Math.max(...real);
    if (hi === lo) { hi += 1; lo -= 1; }
    const n = values.length;
    const pad = 3;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      const r2 = (x: number) => Math.round(x * 100) / 100;
      pts.push([r2(n > 1 ? (i / (n - 1)) * 100 : 50), r2(pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2))]);
    });
  }
  const color = toneColor(tone);
  const line = pts.map((p) => `${p[0]} ${p[1]}`).join(' L');
  const last = pts[pts.length - 1];
  return (
    <span className={cx('fp-spark', className)} style={knobs({ '--fp-spark-h': `${height}px` })} role={label ? 'img' : undefined} aria-label={label}>
      {pts.length > 0 && (
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {area && <path className="fp-ch-area" d={`M${pts[0][0]} ${height} L${line} L${last[0]} ${height} Z`} style={{ fill: color }} />}
          <path className="fp-ch-line fp-ch-line--thin" d={`M${line}`} style={{ stroke: color }} />
          <path className="fp-ch-dot-ring" d={`M${last[0]} ${last[1]} h0`} />
          <path className="fp-ch-dot" d={`M${last[0]} ${last[1]} h0`} style={{ stroke: color, strokeWidth: 6 }} />
        </svg>
      )}
    </span>
  );
}

// ─── ShareBar ───────────────────────────────────────────────────────────

export interface SharePart {
  key: string;
  label: ReactNode;
  value: number;
  tone?: ChartTone;
}

export interface ShareBarProps {
  parts: readonly SharePart[];
  /** How each part's value is written in the legend ("$19.25", "41%"). Default: the number. */
  format?: (value: number, share: number) => ReactNode;
  /** The whole (default: the sum of the parts). */
  total?: number;
  /** What the bar shows, for screen readers ("Gas bill by charge"). */
  label: string;
  /** Bar height in px (default 14). */
  height?: number;
  /** Hide the legend (when a KeyValue next to it already lists the parts with swatches). */
  hideLegend?: boolean;
  className?: string;
}

/**
 * Parts of a whole as one bar with 2px gaps (a bill's charges, where a clean went), with a
 * legend that names each part and its value. The legend is the accessible content; the bar
 * repeats it in colour.
 */
export function ShareBar({ parts, format, total, label, height = 14, hideLegend, className }: ShareBarProps) {
  const sum = total ?? parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const shown = parts.filter((p) => p.value > 0);
  const gap = 0.6; // in the 100-wide viewBox, about 2px on a phone
  const usable = 100 - gap * Math.max(0, shown.length - 1);
  let x = 0;
  return (
    <figure className={cx('fp-stack fp-stack--s', className)} style={{ margin: 0 }} aria-label={label}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true" focusable="false" style={{ display: 'block', borderRadius: 4 }}>
        <rect x={0} y={0} width={100} height={height} style={{ fill: 'var(--appinset)' }} />
        {sum > 0 && shown.map((p) => {
          const w = (Math.max(0, p.value) / sum) * usable;
          const el = <rect key={p.key} x={x} y={0} width={w} height={height} style={{ fill: toneColor(p.tone ?? 'ink') }} />;
          x += w + gap;
          return el;
        })}
      </svg>
      {!hideLegend && (
        <ul className="fp-chart-legend" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {parts.map((p) => (
            <li key={p.key} className="fp-lg-item">
              <LegendKey tone={p.tone ?? 'ink'} kind="box" />
              {p.label}{' '}
              <b className="fp-mono" style={{ color: 'var(--apptext)', fontWeight: 500 }}>
                {format ? format(p.value, sum > 0 ? p.value / sum : 0) : p.value}
              </b>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

// ─── LampMatrix ─────────────────────────────────────────────────────────

export type CellState = 'ok' | 'warn' | 'problem' | 'info' | 'off';

export interface MatrixCell {
  /** Full label for the readout ("Sun, Nov 8"). */
  label: string;
  /** Tick under the cell ("Nov 8", "Today"); '' or omitted for none. */
  short?: string;
  state: CellState;
  /** Extra readout text ("21 of 24 hours"). */
  note?: string;
}

const DEFAULT_WORDS: Record<CellState, string> = { ok: 'OK', warn: 'Heads-up', problem: 'Problem', info: 'Info', off: 'No data' };
const LEGEND_ORDER: CellState[] = ['ok', 'warn', 'problem', 'info', 'off'];
const CELL_TONE = { ok: 'ok', warn: 'headsup', problem: 'problem', info: 'info', off: 'neutral' } as const;

export interface LampMatrixProps {
  cells: readonly MatrixCell[];
  /** The words for each state in this matrix ({ ok: 'All 24 hours', warn: 'Partial day' }). */
  words?: Partial<Record<CellState, string>>;
  /** The takeaway sentence for screen readers ("13 of the last 14 days are complete."). */
  caption: string;
  /** The cell shown in the readout by default (default: the last). */
  initial?: number;
  className?: string;
}

/**
 * An LED strip of states (the Diagnostics 14-day coverage). The readout line above names the
 * selected cell: the latest by default, and the pointer, a finger, or the arrow keys (with the
 * strip focused) move it, so nothing is hover-only.
 */
export function LampMatrix({ cells, words, caption, initial, className }: LampMatrixProps) {
  const n = cells.length;
  const start = initial ?? n - 1;
  const [hot, setHot] = useState<number | null>(null);
  const w = { ...DEFAULT_WORDS, ...words };
  const shown = hot ?? start;
  const cell = cells[shown];
  const seen = new Set(cells.map((c) => c.state));

  // Pointer position to a cell. Reading the box on an event is fine; drawing never measures.
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return shown;
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
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

  return (
    <figure className={cx('fp-chart fp-chart--heat', className)}>
      <figcaption className="fp-sr-only">{caption}</figcaption>
      <div className="fp-chart-head">
        <div className="fp-chart-legend">
          {LEGEND_ORDER.filter((s) => seen.has(s)).map((s) => (
            <span key={s} className="fp-lg-item"><Lamp tone={CELL_TONE[s]} size="s" />{w[s]}</span>
          ))}
        </div>
        <div className="fp-chart-readout" aria-live="polite">
          {cell && (
            <>
              <span className="fp-rd-when">{cell.label}</span>
              <span className="fp-rd-item"><b>{w[cell.state]}</b>{cell.note ? ` · ${cell.note}` : ''}</span>
            </>
          )}
        </div>
      </div>
      <div
        className={cx('fp-chart-plot', hot != null && 'fp-is-scrubbing')}
        style={{ marginBottom: cells.some((c) => c.short) ? 22 : 0 }}
        tabIndex={0}
        role="group"
        aria-label={`${caption} Use the arrow keys to read each day.`}
        onPointerMove={(e) => setHot(at(e))}
        onPointerDown={(e) => setHot(at(e))}
        onPointerLeave={() => setHot(null)}
        onBlur={() => setHot(null)}
        onKeyDown={onKey}
      >
        <div className="fp-heat fp-heat--led">
          {cells.map((c, i) => (
            <span key={i} className={cx('fp-heat-cell', `fp-is-${c.state}`, hot === i && 'fp-is-hot')} />
          ))}
        </div>
        {cells.map((c, i) => {
          if (!c.short) return null;
          const x = (i + 0.5) / n;
          return (
            <span key={`x${i}`} className={cx('fp-chart-x', x < 0.04 && 'fp-chart-x--start', x > 0.96 && 'fp-chart-x--end')} style={{ left: `${(x * 100).toFixed(1)}%` }}>
              {c.short}
            </span>
          );
        })}
      </div>
    </figure>
  );
}
