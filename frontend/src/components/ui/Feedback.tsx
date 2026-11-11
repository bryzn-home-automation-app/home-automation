import type { ReactNode } from 'react';
import type { Tone } from '../../utils/status';
import { formatTime } from '../../utils/format';
import { Button } from './Button';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { Lamp } from './Status';

/*
 * Feedback: Notice (a banner), EmptyState, ErrorState, the Skeleton pieces, and QueryState,
 * which picks between them for a React Query result. The rule QueryState enforces, because
 * 15 screens got it wrong (B-005, B-187):
 *
 *   loading, nothing yet         → the skeleton (or `loading`)
 *   first load failed            → ErrorState: what failed + "Try again" (never "nothing here")
 *   loaded, nothing in it        → EmptyState that says what will appear and when
 *   a refresh failed, data held  → keep the data, add a slim "Couldn't refresh" notice
 */

// ─── Notice ─────────────────────────────────────────────────────────────

const NOTICE_ICON: Record<Tone, IconName> = {
  info: 'info', headsup: 'alert-triangle', problem: 'alert-circle', ok: 'check-circle', neutral: 'info',
};

export interface NoticeProps {
  /** info (default) · headsup · problem · ok · neutral (plain context, a recessed well). */
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** Small buttons ("Try again"). */
  action?: ReactNode;
  icon?: IconName;
  /** Announce it (role="status"; "alert" for a problem the person must act on now). */
  live?: 'polite' | 'assertive';
  className?: string;
}

/** A stale-data banner, a broken connection, a one-time explanation. Not for marketing copy. */
export function Notice({ tone = 'info', title, children, action, icon, live, className }: NoticeProps) {
  const t = tone === 'headsup' ? 'warn' : tone === 'neutral' ? 'plain' : tone === 'info' ? '' : tone;
  return (
    <div
      className={cx('fp-notice', t && `fp-notice--${t}`, className)}
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
    >
      <Icon name={icon ?? NOTICE_ICON[tone]} />
      <div>
        {title != null && <p className="fp-notice-title">{title}</p>}
        {children != null && <div className="fp-notice-text">{children}</div>}
      </div>
      {action != null && <div className="fp-notice-action">{action}</div>}
    </div>
  );
}

// ─── Empty and error ────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** What isn't here ("No water bills yet"). */
  title: ReactNode;
  /** What will appear and when ("Bills appear here a day after they arrive."). */
  children?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/**
 * Nothing to show, said plainly. With a search or filter in play, say so ("Nothing matches
 * 'filter'. Clear the search to see all 23 jobs.") rather than "no records" (B-004).
 */
export function EmptyState({ title, children, icon, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('fp-empty', compact && 'fp-empty--compact', className)}>
      {icon && <Icon name={icon} />}
      <p className="fp-empty-title">{title}</p>
      {children != null && <p className="fp-empty-text">{children}</p>}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  /** What failed, in family words ("Couldn't load the forecast"). */
  title?: ReactNode;
  /** Why or what happens now ("The home server didn't answer. Your data is safe."). */
  children?: ReactNode;
  /** Shows "Try again" and calls this. */
  onRetry?: () => void;
  /** A retry is in flight: the key says "Trying again…" and ignores taps. */
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/** A failed load, with a way out. Announced (role="alert") when it appears. */
export function ErrorState({ title = "Couldn't load this", children = "The home server didn't answer. Nothing was lost.", onRetry, retrying, compact, className }: ErrorStateProps) {
  return (
    <div className={cx('fp-empty fp-empty--error', compact && 'fp-empty--compact', className)} role="alert">
      <Lamp tone="problem" />
      <p className="fp-empty-title">{title}</p>
      {children != null && <p className="fp-empty-text">{children}</p>}
      {onRetry && (
        <Button size="sm" icon="refresh" onClick={onRetry} busy={retrying} busyLabel="Trying again…">Try again</Button>
      )}
    </div>
  );
}

// ─── Skeletons ──────────────────────────────────────────────────────────

/*
 * Placeholder shapes that sit inside the page's own layout (inside the shell, never a second
 * full page; B-051). They are decorative: wrap a group in <Loading label="…"> so the wait is
 * announced once.
 */

export function SkelLine({ width = 'full', className }: { width?: 's' | 'm' | 'full'; className?: string }) {
  return <span className={cx('fp-skel fp-skel-line', width !== 'full' && `fp-skel-line--${width}`, className)} aria-hidden="true" />;
}
export function SkelNum({ className }: { className?: string }) {
  return <span className={cx('fp-skel fp-skel-num', className)} aria-hidden="true" />;
}
/** A block (a chart's place); `height` in px. */
export function SkelBlock({ height, className }: { height?: number; className?: string }) {
  return <span className={cx('fp-skel fp-skel-block', className)} style={height ? { height } : undefined} aria-hidden="true" />;
}
/** A circle (a dial's or an avatar's place); `size` in px. */
export function SkelCircle({ size = 40, className }: { size?: number; className?: string }) {
  return <span className={cx('fp-skel fp-skel-circle', className)} style={{ width: size, height: size }} aria-hidden="true" />;
}
export function SkelReadout() {
  return (
    <div className="fp-skel-readout" aria-hidden="true">
      <SkelLine width="s" />
      <SkelNum />
    </div>
  );
}
export function SkelRow() {
  return (
    <div className="fp-skel-row" aria-hidden="true">
      <span className="fp-skel" />
      <div><SkelLine width="m" /><SkelLine width="s" /></div>
    </div>
  );
}
/** `count` list rows. */
export function SkelRows({ count = 3 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, i) => <SkelRow key={i} />)}</>;
}

/** The answer panel's shape: a dial-sized circle, a verdict, readouts. */
export function SkelInstrumentPanel({ readouts = 2 }: { readouts?: number }) {
  return (
    <div className="fp-ip" aria-hidden="true">
      <div className="fp-ip-instrument"><SkelCircle size={200} /></div>
      <div className="fp-ip-body">
        <div className="fp-stack fp-stack--s"><SkelLine width="m" /><SkelLine width="s" /></div>
        <div className="fp-readouts">{Array.from({ length: readouts }, (_, i) => <SkelReadout key={i} />)}</div>
      </div>
    </div>
  );
}

/** A panel's shape: a title line and some rows (or a block for a chart). */
export function SkelPanel({ rows = 3, chart }: { rows?: number; chart?: boolean }) {
  return (
    <div className="fp-panel" aria-hidden="true">
      <div className="fp-panel-head"><div><SkelLine width="s" /></div></div>
      {chart ? <SkelBlock /> : <SkelRows count={rows} />}
    </div>
  );
}

/** Announces a wait once ("Loading the forecast") around decorative skeletons. */
export function Loading({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="fp-sr-only">{label}</span>
      {children}
    </div>
  );
}

// ─── QueryState ─────────────────────────────────────────────────────────

/**
 * The parts of a React Query result QueryState reads (a UseQueryResult fits). `data` undefined
 * means nothing has loaded yet; null (a 204 "nothing yet") counts as loaded and empty.
 */
export interface QueryLike<T> {
  data: T | undefined;
  isError: boolean;
  isFetching?: boolean;
  /** When the data shown was fetched (epoch ms; 0 = never). */
  dataUpdatedAt?: number;
  refetch: () => unknown;
}

export interface QueryStateProps<T> {
  query: QueryLike<T>;
  /** Renders the loaded data (never called with undefined or null). */
  children: (data: NonNullable<T>) => ReactNode;
  /** While nothing has loaded. Default: three skeleton rows. */
  loading?: ReactNode;
  /** What is loading, said to screen readers ("Loading the forecast"). */
  loadingLabel?: string;
  /** Shown when the data is empty. Required in spirit: say what will appear and when. */
  empty?: ReactNode;
  /** Decides emptiness. Default: null, or an array with nothing in it. */
  isEmpty?: (data: T) => boolean;
  /** Names what failed in the error state and the refresh notice ("the forecast"). */
  what?: string;
  /** Overrides the first-load ErrorState. */
  error?: ReactNode;
  /** Compact error and empty states (inside a small panel). */
  compact?: boolean;
}

const defaultIsEmpty = (data: unknown) => data == null || (Array.isArray(data) && data.length === 0);

export function QueryState<T>({ query, children, loading, loadingLabel, empty, isEmpty = defaultIsEmpty, what, error, compact }: QueryStateProps<T>) {
  const retry = () => { void query.refetch(); };
  const retrying = !!query.isFetching;

  if (query.data === undefined) {
    if (query.isError) {
      return error != null ? <>{error}</> : (
        <ErrorState title={what ? `Couldn't load ${what}` : undefined} onRetry={retry} retrying={retrying} compact={compact} />
      );
    }
    return <Loading label={loadingLabel ?? (what ? `Loading ${what}` : 'Loading')}>{loading ?? <SkelRows />}</Loading>;
  }

  const data = query.data;
  const stale = query.isError ? (
    <Notice
      tone="headsup"
      title={what ? `Couldn't refresh ${what}.` : "Couldn't refresh."}
      live="polite"
      action={<Button size="sm" icon="refresh" onClick={retry} busy={retrying} busyLabel="Trying again…">Try again</Button>}
    >
      {query.dataUpdatedAt ? `Showing what came in at ${formatTime(query.dataUpdatedAt)}.` : 'Showing the last thing that came in.'}
    </Notice>
  ) : null;

  if (data === null || isEmpty(data)) {
    return (
      <>
        {stale}
        {empty ?? <EmptyState title="Nothing here yet" compact={compact} />}
      </>
    );
  }
  return (
    <>
      {stale}
      {children(data as NonNullable<T>)}
    </>
  );
}
