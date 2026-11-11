import { useRef, type RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../context/ThemeContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useBackToClose } from '../../hooks/useBackToClose';
import { GROUP_LABEL, visibleRoutes, type Role, type RouteGroup } from '../../routes';

const SHEET_GROUPS: RouteGroup[] = ['house', 'you', 'admin'];

/**
 * The phone's "More" sheet: a keypad of every page that isn't on the key row
 * (House, You, and Admin for admins), the light/dark switch and Sign out. A bottom
 * sheet from the kit (fp-dialog--more, hidden from lg up, where the key column has
 * all of it).
 *
 * It stays mounted while closed (it renders nothing) so useFocusTrap can hand focus
 * back to the More key when it closes. Escape, the Close key, a tap on the scrim and
 * the phone's back gesture all close it; the page behind can't scroll meanwhile.
 * Choosing a page closes it in the same click that navigates, with `replace`: the
 * sheet's own Back entry becomes the new page, so history is [page, new page] and one
 * Back returns. (A push would leave the sheet's duplicate entry under the new page, and
 * the second Back would appear to do nothing.)
 */
export default function MoreSheet({
  open,
  onClose,
  returnFocusRef,
  role,
  unread,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  role: Role | null;
  unread: number;
  onSignOut: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { isDark, setMode } = useTheme();
  useFocusTrap(open, panelRef, returnFocusRef, onClose);
  useScrollLock(open);
  useBackToClose(onClose, open);

  if (!open) return null;

  return (
    // data-no-pull: a drag on the scrim must not pull-to-refresh the page behind.
    <div
      className="fp-dialog fp-dialog--more"
      data-no-pull
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        id="more-sheet"
        className="fp-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-sheet-title"
      >
        <header className="fp-dialog-head">
          <div className="fp-dialog-heading">
            <p className="fp-label">HomeOS</p>
            <h2 className="fp-dialog-title" id="more-sheet-title">
              More
            </h2>
          </div>
          <button type="button" className="fp-icon-btn fp-icon-btn--quiet" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="fp-dialog-body fp-stack">
          {SHEET_GROUPS.map((group) => {
            const routes = visibleRoutes(role, group);
            if (!routes.length) return null;
            return (
              <section key={group} className="fp-keypad-group" aria-labelledby={`more-sheet-${group}`}>
                <h3 className="fp-label" id={`more-sheet-${group}`}>
                  {GROUP_LABEL[group]}
                </h3>
                <ul className="fp-keypad">
                  {routes.map((r) => (
                    <li key={r.id} className="grid">
                      <NavLink to={r.path} replace className="fp-padkey" onClick={onClose}>
                        <Icon name={r.icon} />
                        <span>{r.label}</span>
                        {r.id === 'notifications' && unread > 0 ? (
                          <>
                            <span className="fp-count" aria-hidden="true">
                              {unread > 99 ? '99+' : unread}
                            </span>
                            <span className="fp-sr-only">, {unread} unread</span>
                          </>
                        ) : null}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <div className="fp-more-foot">
            <div className="fp-more-theme">
              <span className="fp-label" id="more-sheet-theme">
                Theme
              </span>
              {/* Two toggles, not radios: each is one tap and says whether it is on. */}
              <div className="fp-seg fp-seg--inline" role="group" aria-labelledby="more-sheet-theme">
                <button type="button" className="fp-seg-key min-h-11" aria-pressed={!isDark} onClick={() => setMode('light')}>
                  <Icon name="sun" />
                  Light
                </button>
                <button type="button" className="fp-seg-key min-h-11" aria-pressed={isDark} onClick={() => setMode('dark')}>
                  <Icon name="moon" />
                  Dark
                </button>
              </div>
            </div>
            <button
              type="button"
              className="fp-btn fp-btn--quiet"
              onClick={() => {
                onClose();
                onSignOut();
              }}
            >
              <Icon name="log-out" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
