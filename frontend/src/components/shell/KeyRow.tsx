import { forwardRef, memo } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { ROUTES, canSee, type Role } from '../../routes';

/**
 * The phone and tablet key row (below lg): Home, Utilities, Climate, Cameras (not
 * for guests), Roomba, and More, which opens the More sheet with every other page.
 * Alerts live under More, so More carries the unread count.
 *
 * Fixed to the bottom of the window while the page scrolls in its own box (see
 * App.tsx). touch-none: the window has nothing to scroll, so a swipe here would
 * only bounce it. No backdrop blur: an opaque panel, and blur under a fixed bar
 * made scrolling stutter.
 */
const KeyRow = forwardRef<
  HTMLButtonElement,
  { role: Role | null; unread: number; moreOpen: boolean; onMore: () => void }
>(function KeyRow({ role, unread, moreOpen, onMore }, moreRef) {
  const keys = ROUTES.filter((r) => r.keyRow && canSee(r, role));
  return (
    <nav className="fp-keyrow touch-none" aria-label="Main">
      {keys.map((r) => (
        <NavLink key={r.id} to={r.path} end={r.path === '/'} className="fp-rowkey">
          <Icon name={r.icon} />
          <span>{r.short}</span>
        </NavLink>
      ))}
      <button
        ref={moreRef}
        type="button"
        className="fp-rowkey fp-rowkey--more"
        onClick={onMore}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-controls={moreOpen ? 'more-sheet' : undefined}
        aria-label={unread > 0 ? `More, ${unread} unread alerts` : 'More'}
      >
        <Icon name="grid" />
        <span>More</span>
        {unread > 0 ? (
          <span className="fp-count" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
    </nav>
  );
});

export default memo(KeyRow);
