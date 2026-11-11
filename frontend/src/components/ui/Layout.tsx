import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

/*
 * Page structure: Screen (a converted page's root), Panel + PanelHead + PanelFoot, and the
 * layout helpers Stack / Cluster / Spread / Grid / Split, plus Disclosure for the rare and
 * technical material that goes last. Thin wrappers over the fp- classes in
 * styles/faceplate.css; every one passes className and other div attributes through.
 *
 * Rules from KIT.md §0: a Panel per detail section, never a panel inside a panel, never a grid
 * of equal tiles as the page.
 */

type DivProps = HTMLAttributes<HTMLDivElement>;

/** A converted page's root: a column of panels with the page gap and 15px body text. */
export function Screen({ className, ...rest }: DivProps) {
  return <div className={cx('fp-screen', className)} {...rest} />;
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The panel's heading. Given, the panel gets a PanelHead and is labelled by it. */
  title?: ReactNode;
  /** One line under the title (13px graphite). */
  subtitle?: ReactNode;
  /** A silk-screen label above the title. */
  eyebrow?: ReactNode;
  /** One quiet small button, or a Chips row, at the head's right. */
  action?: ReactNode;
  /** Heading level for the title: h2 on a page (default), h3 inside a dialog or a sub-section. */
  level?: 2 | 3;
  /** No padding: a panel that is only a list, table or disclosure row. */
  flush?: boolean;
  /** A recessed aside (rare). */
  well?: boolean;
  /** Footer row (freshness + a small action). */
  footer?: ReactNode;
}

/**
 * A detail section. With a title it renders a <section> labelled by its heading; without one,
 * a plain <div> (give it an aria-label if it stands for a section).
 */
export function Panel({ title, subtitle, eyebrow, action, level = 2, flush, well, footer, className, children, ...rest }: PanelProps) {
  const titleId = useId();
  const cls = cx('fp-panel', flush && 'fp-panel--flush', well && 'fp-panel--well', className);
  if (title == null) {
    return (
      <div className={cls} {...rest}>
        {children}
        {footer != null && <PanelFoot>{footer}</PanelFoot>}
      </div>
    );
  }
  return (
    <section className={cls} aria-labelledby={titleId} {...rest}>
      <PanelHead title={title} titleId={titleId} subtitle={subtitle} eyebrow={eyebrow} action={action} level={level} />
      {children}
      {footer != null && <PanelFoot>{footer}</PanelFoot>}
    </section>
  );
}

export interface PanelHeadProps {
  title: ReactNode;
  /** The heading's id, for aria-labelledby on the section (Panel passes its own). */
  titleId?: string;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
  className?: string;
}

/** Title (+ eyebrow, subtitle) on the left, one action on the right. */
export function PanelHead({ title, titleId, subtitle, eyebrow, action, level = 2, className }: PanelHeadProps) {
  const H = level === 3 ? 'h3' : 'h2';
  return (
    <header className={cx('fp-panel-head', className)}>
      <div>
        {eyebrow != null && <p className="fp-label">{eyebrow}</p>}
        <H className="fp-panel-title" id={titleId}>{title}</H>
        {subtitle != null && <p className="fp-panel-sub">{subtitle}</p>}
      </div>
      {action != null && <div className="fp-panel-action">{action}</div>}
    </header>
  );
}

/** The panel's bottom row: mono freshness text on the left, a small action on the right. */
export function PanelFoot({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <footer className={cx('fp-panel-foot', className)} {...rest} />;
}

/** A heading between groups of panels (rare). */
export function SectionHead({ title, action, id }: { title: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="fp-section-head">
      <h2 className="fp-section-title" id={id}>{title}</h2>
      {action}
    </div>
  );
}

const STACK_GAP = { xs: 'fp-stack--xs', s: 'fp-stack--s', m: 'fp-stack--m', default: '', l: 'fp-stack--l', page: 'fp-stack--page' } as const;

/** Vertical flex with a gap: xs 4 · s 8 · m 12 · default 16 · l 24 · page (the page gap). */
export function Stack({ gap = 'default', className, ...rest }: DivProps & { gap?: keyof typeof STACK_GAP }) {
  return <div className={cx('fp-stack', STACK_GAP[gap], className)} {...rest} />;
}

/** A wrapping row with gap 8 (`loose`: 16). */
export function Cluster({ loose, className, ...rest }: DivProps & { loose?: boolean }) {
  return <div className={cx('fp-cluster', loose && 'fp-cluster--l', className)} {...rest} />;
}

/** A space-between row (`top`: aligned to the top). */
export function Spread({ top, className, ...rest }: DivProps & { top?: boolean }) {
  return <div className={cx('fp-spread', top && 'fp-spread--top', className)} {...rest} />;
}

/** 1 column on a phone; 2 from 640px; 3 or 4 from 1024px. `tight`: gap 8. */
export function Grid({ cols = 2, tight, className, ...rest }: DivProps & { cols?: 2 | 3 | 4; tight?: boolean }) {
  return <div className={cx(`fp-grid-${cols}`, tight && 'fp-grid-tight', className)} {...rest} />;
}

/** Two columns from 1024px, stacked below: 7:5 (default), even 1:1, wide 2:1. */
export function Split({ ratio = '7:5', className, ...rest }: DivProps & { ratio?: '7:5' | 'even' | 'wide' }) {
  return <div className={cx('fp-split', ratio === 'even' && 'fp-split--even', ratio === 'wide' && 'fp-split--wide', className)} {...rest} />;
}

export interface DisclosureProps {
  /** Summary text while closed ("Show details", "For the curious", "Show 12 more"). */
  summary: ReactNode;
  /** Summary text while open; defaults to `summary`. */
  openSummary?: ReactNode;
  /** row: a full-width row at the bottom of a panel; key: looks like a secondary key. */
  variant?: 'plain' | 'row' | 'key';
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/** A native <details> (keyboard and screen readers handle it): rare or technical material, last. */
export function Disclosure({ summary, openSummary, variant = 'plain', defaultOpen, className, children }: DisclosureProps) {
  return (
    <details
      className={cx('fp-disclosure', variant === 'row' && 'fp-disclosure--row', variant === 'key' && 'fp-disclosure--key', className)}
      open={defaultOpen}
    >
      <summary>
        {openSummary != null ? (
          <>
            <span className="fp-when-closed">{summary}</span>
            <span className="fp-when-open">{openSummary}</span>
          </>
        ) : (
          summary
        )}
        <Icon name="chevron-down" />
      </summary>
      <div className="fp-disclosure-body">{children}</div>
    </details>
  );
}

/**
 * The first `first` items in place, the rest behind "Show N more …" at the list's foot. A list
 * never scrolls inside the page (B-006); the page does. `noun` is plural ("days" → "Show 23
 * more days" / "Show fewer days").
 */
export function ShowMore<T>({
  items,
  first,
  noun,
  render,
}: {
  items: readonly T[];
  first: number;
  noun: string;
  render: (items: readonly T[]) => ReactNode;
}) {
  const rest = items.slice(first);
  return (
    <>
      {render(items.slice(0, first))}
      {rest.length > 0 && (
        <Disclosure variant="row" summary={`Show ${rest.length} more ${noun}`} openSummary={`Show fewer ${noun}`}>
          {render(rest)}
        </Disclosure>
      )}
    </>
  );
}
