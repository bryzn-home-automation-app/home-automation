import { Fragment, type ReactNode } from 'react';
import type { Tone } from '../../utils/status';
import { formatDayName, formatShortDate, formatWeekday, homeDayKey, type DateInput } from '../../utils/format';
import { cx, knobs } from './cx';
import { Lamp, toneTextClass } from './Status';

/*
 * Data display: DataTable (a real table that becomes labelled blocks on a phone), KeyValue,
 * Timeline (day-grouped events), Progress and Meter.
 */

// ─── DataTable ──────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  /** Column heading; also the label each cell shows on a phone. */
  header: string;
  /** The cell's content. */
  cell: (row: T) => ReactNode;
  /** A number: right-aligned, tabular. */
  num?: boolean;
  /**
   * The cell's role in the phone layout: `title` top-left (what the row is), `key` top-right
   * (the one number that matters), `action` full width at the bottom, `wide` full width.
   * Others show as LABEL / value pairs.
   */
  kind?: 'title' | 'key' | 'action' | 'wide';
  strong?: boolean;
  muted?: boolean;
  /** Hide the heading visually (an actions column), keeping it for screen readers. */
  hideHeader?: boolean;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  /** The table's name for screen readers (a visible panel title usually says it already). */
  caption?: string;
  className?: string;
}

/**
 * Use for 3+ comparable columns; otherwise a List. Place it as a direct child of a Panel (it
 * bleeds to the panel's edges). Under 640px each row stacks into a block: no sideways scroll
 * box and no fixed-height virtual list, the page scrolls (B-006).
 */
export function DataTable<T>({ columns, rows, rowKey, caption, className }: DataTableProps<T>) {
  return (
    <div className={cx('fp-table-wrap', className)}>
      <table className="fp-table">
        {caption && <caption className="fp-sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(c.num && 'fp-is-num')}>
                {c.hideHeader ? <span className="fp-sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.header}
                  className={cx(
                    c.kind && `fp-cell-${c.kind}`,
                    c.num && 'fp-is-num',
                    c.strong && 'fp-is-strong',
                    c.muted && 'fp-is-muted',
                  ) || undefined}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── KeyValue ───────────────────────────────────────────────────────────

/** A list of facts: device details, a bill's breakdown, a receipt. */
export function KeyValue({ cols, className, children }: { cols?: boolean; className?: string; children: ReactNode }) {
  return <dl className={cx('fp-kv', cols && 'fp-kv--cols', className)}>{children}</dl>;
}

export interface KVProps {
  label: ReactNode;
  value: ReactNode;
  /** group: a bold heading row; sub: an indented part of the group above; total: the sum. */
  kind?: 'group' | 'sub' | 'total';
  /** Colours the value with its status words. */
  tone?: Tone;
  /** Ties the row to a chart series: a CSS colour (a token: var(--appchart-gas)). */
  swatch?: string;
  swatchShape?: 'box' | 'line' | 'dash';
  /** Mono value (a network name, an ID). */
  mono?: boolean;
}

export function KV({ label, value, kind, tone, swatch, swatchShape = 'box', mono }: KVProps) {
  return (
    <div className={cx('fp-kv-row', kind && `fp-kv-row--${kind}`)}>
      <dt>
        {swatch && <span className={cx('fp-swatch', swatchShape !== 'box' && `fp-swatch--${swatchShape}`)} style={knobs({ '--fp-sw': swatch })} aria-hidden="true" />}
        {label}
      </dt>
      <dd className={cx(tone && tone !== 'neutral' && toneTextClass(tone), mono && 'fp-mono') || undefined}>{value}</dd>
    </div>
  );
}

// ─── Timeline ───────────────────────────────────────────────────────────

export interface TimelineItem {
  id: string | number;
  /** When it happened: grouped by the home's calendar day. */
  at: DateInput;
  /** The time column ("4:56 PM"); format it with formatTime. */
  time: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** The event's lamp; neutral = an unlit ring (sign-ins and other plain events). */
  tone?: Tone;
  /** Opens the event's detail. */
  onClick?: () => void;
}

/**
 * A day-grouped log, newest first (pass the items newest first). Day headings say "Today" /
 * "Yesterday" or the weekday date, with the date in mono, all in the home's time zone.
 */
export function Timeline({ items, now, className }: { items: readonly TimelineItem[]; now?: DateInput; className?: string }) {
  const groups: Array<{ day: string; at: DateInput; items: TimelineItem[] }> = [];
  for (const item of items) {
    const day = homeDayKey(item.at) ?? '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, at: item.at, items: [item] });
  }
  const today = now ?? new Date();
  return (
    <div className={cx('fp-timeline', className)}>
      {groups.map((g) => {
        // "TODAY  Nov 9" / "SAT  Nov 7": the silk-screen word, then the date in mono.
        const name = formatDayName(g.at, today);
        const word = name === 'Today' || name === 'Yesterday' || name === 'Tomorrow' ? name : formatWeekday(g.at);
        const date = formatShortDate(g.at, { now: today });
        return (
          <section key={g.day}>
            <h3 className="fp-tl-day">
              <span className="fp-label">{word}</span>
              <span className="fp-mono">{date}</span>
            </h3>
            <ol className="fp-tl-list">
              {g.items.map((item) => {
                const inner = (
                  <Fragment>
                    <span className="fp-tl-time">{item.time}</span>
                    <Lamp tone={item.tone ?? 'neutral'} className={item.tone == null || item.tone === 'neutral' ? 'fp-lamp--off' : undefined} label={item.tone && item.tone !== 'neutral' ? true : undefined} />
                    <span className="fp-tl-body">
                      <span className="fp-tl-title">{item.title}</span>
                      {item.meta != null && <span className="fp-tl-meta">{item.meta}</span>}
                    </span>
                  </Fragment>
                );
                return (
                  <li key={item.id}>
                    {item.onClick ? (
                      <button type="button" className="fp-tl-item" onClick={item.onClick}>{inner}</button>
                    ) : (
                      <div className="fp-tl-item">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

// ─── Progress and Meter ─────────────────────────────────────────────────

const pct = (v: number) => `${Math.max(0, Math.min(100, v))}%`;

export interface ProgressProps {
  /** 0–100. */
  value: number;
  /** What it measures ("Filter life"): the bar's accessible name. */
  label: string;
  /** Ink when there's no judgement; a status tone when there is. */
  tone?: Tone;
  thin?: boolean;
  /** Spoken value text ("62% left", "day 5 of 30"); default "62%". */
  valueText?: string;
  className?: string;
}

/** A smooth bar for "how far along" (a billing cycle, a part's life). */
export function Progress({ value, label, tone = 'neutral', thin, valueText, className }: ProgressProps) {
  const t = tone === 'headsup' ? 'warn' : tone;
  const v = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div
      className={cx('fp-progress', t !== 'neutral' && `fp-progress--${t}`, thin && 'fp-progress--thin', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-valuetext={valueText}
    >
      <span style={knobs({ '--fp-p': pct(value) })} />
    </div>
  );
}

export interface MeterProps {
  /** 0–1. */
  value: number;
  label: string;
  tone?: Tone;
  /** LED segments (default 10). */
  segments?: number;
  valueText?: string;
  className?: string;
}

/** LED segments for a level (storage, battery, signal). */
export function Meter({ value, label, tone = 'neutral', segments, valueText, className }: MeterProps) {
  const t = tone === 'headsup' ? 'warn' : tone;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cx('fp-meter', t !== 'neutral' && `fp-meter--${t}`, className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={valueText}
      style={knobs({ '--fp-v': v, '--fp-n': segments })}
    >
      <span />
    </div>
  );
}

/** A label + value line over a Progress or Meter. The bar is named by `label` too. */
export function MeterRow({ label, value, children }: { label: ReactNode; value: ReactNode; children: ReactNode }) {
  return (
    <div className="fp-meter-row">
      <span className="fp-small">{label}</span>
      <span className="fp-mono">{value}</span>
      {children}
    </div>
  );
}
