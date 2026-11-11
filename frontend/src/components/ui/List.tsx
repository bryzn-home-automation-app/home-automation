import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../../utils/status';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { Lamp } from './Status';

/*
 * Divided lists (KIT.md §7.8). <List> is the <ul>; <Row> is one <li> with the row inside it:
 * a router link (`to`), a button (`onClick`) or static. Inside a Panel the rows run edge to edge.
 * Lists never sit in their own scroll box (B-006): past ~8 rows, end with a "Show more"
 * Disclosure or a "See all" link instead.
 *
 *   <List>
 *     <Row to="/maintenance" icon="wrench" title="Replace HVAC air filters" meta="Sun, Nov 15 · HVAC" value="$38.97" chevron />
 *     <Row lamp="headsup" title="Driveway camera battery is at 27%" meta="Charge it soon" compact onClick={open} />
 *   </List>
 *
 * Anything else in a List (a Switch, a custom row) goes in its own <li>.
 */

export function List({ inset, cols, className, children, ...rest }: { inset?: boolean; cols?: boolean; className?: string; children: ReactNode; 'aria-label'?: string }) {
  return (
    <ul className={cx('fp-list', inset && 'fp-list--inset', cols && 'fp-list--cols', className)} {...rest}>
      {children}
    </ul>
  );
}

export interface RowProps {
  title: ReactNode;
  /** One meta line under the title (times in mono: wrap them in <span className="fp-mono">). */
  meta?: ReactNode;
  /** A lead icon in a well. */
  icon?: IconName;
  /** A status lamp as the lead (alerts, attention items); its word is said for screen readers. */
  lamp?: Tone;
  /** Any other lead (an <Avatar>): placed as is. */
  lead?: ReactNode;
  /** A figure on the right (already formatted), with an optional mono unit. */
  value?: ReactNode;
  unit?: string;
  /** Anything else on the right: a Badge, a Count, a small Button. */
  trail?: ReactNode;
  /** A chevron: this row goes somewhere. On by default for links. */
  chevron?: boolean;
  /** 48px instead of 60px (alert and attention lists). */
  compact?: boolean;
  /** Bold title and an ink dot; also says "Unread" to screen readers. */
  unread?: boolean;
  /** Title at weight 500, for sentence-like titles. */
  regularTitle?: boolean;
  /** A route: the row is a link. */
  to?: string;
  /** An action: the row is a button (opens a dialog). Its accessible name is its visible text. */
  onClick?: () => void;
  className?: string;
}

export function Row({ title, meta, icon, lamp, lead, value, unit, trail, chevron, compact, unread, regularTitle, to, onClick, className }: RowProps) {
  const showChev = chevron ?? (to != null);
  const cls = cx('fp-row', compact && 'fp-row--compact', unread && 'fp-is-unread', className);
  const body = (
    <>
      {icon && <span className="fp-row-lead"><Icon name={icon} /></span>}
      {lamp && <span className="fp-row-lead fp-row-lead--lamp"><Lamp tone={lamp} label /></span>}
      {lead}
      <span className="fp-row-main">
        <span className={cx('fp-row-title', regularTitle && 'fp-row-title--regular')}>
          {title}
          {unread && <span className="fp-sr-only"> Unread.</span>}
        </span>
        {meta != null && <span className="fp-row-meta">{meta}</span>}
      </span>
      {(value != null || trail != null || showChev) && (
        <span className="fp-row-trail">
          {value != null && (
            <span className="fp-row-value">
              {value}
              {unit && <span className="fp-unit">{unit}</span>}
            </span>
          )}
          {trail}
          {showChev && <Icon name="chevron-right" className="fp-chev" />}
        </span>
      )}
    </>
  );
  let row: ReactNode;
  if (to != null) row = <Link className={cls} to={to}>{body}</Link>;
  else if (onClick) row = <button type="button" className={cls} onClick={onClick}>{body}</button>;
  else row = <div className={cls}>{body}</div>;
  return <li>{row}</li>;
}
