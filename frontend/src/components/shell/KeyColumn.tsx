import { memo, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { GROUP_LABEL, GROUP_ORDER, visibleRoutes, type Role } from '../../routes';

/**
 * The desktop key column (lg and up): one key per page, icon over a short label,
 * filed in the Everyday / House / You / Admin groups with a hairline between them.
 * The open page's key is ink-filled (NavLink sets aria-current="page", which the
 * kit selects on). Admin keys exist only for admins.
 *
 * Eighteen keys don't fit a short laptop window, and the column scrolls with its
 * scrollbar hidden, so a fade with a chevron sits at the bottom while there is more
 * below. The old sidebar showed an empty "ADMIN" heading there instead (B-010).
 */
export default memo(function KeyColumn({
  role,
  unread,
  onSignOut,
}: {
  role: Role | null;
  unread: number;
  onSignOut: () => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const check = () => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      ro?.disconnect();
    };
  }, [role]);

  return (
    <nav ref={navRef} className="fp-keycol" aria-label="Main">
      {GROUP_ORDER.map((group) => {
        const routes = visibleRoutes(role, group);
        if (!routes.length) return null;
        return (
          <ul key={group} className="fp-keycol-group" aria-label={GROUP_LABEL[group]}>
            {group === 'admin' ? (
              <li className="fp-keycol-label fp-label" aria-hidden="true">
                Admin
              </li>
            ) : null}
            {routes.map((r) => (
              <li key={r.id}>
                <NavLink to={r.path} end={r.path === '/'} className="fp-navkey">
                  <Icon name={r.icon} />
                  <span>{r.short}</span>
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
        );
      })}
      <div className="fp-keycol-group mt-auto">
        <button type="button" className="fp-navkey w-full cursor-pointer" onClick={onSignOut}>
          <Icon name="log-out" />
          <span>Sign out</span>
        </button>
      </div>
      {moreBelow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none sticky bottom-[-8px] -mx-2 -mt-12 flex h-12 shrink-0 items-end justify-center pb-2 text-apptext-muted"
          style={{ background: 'linear-gradient(to top, var(--appsurface) 45%, transparent)' }}
        >
          <Icon name="chevron-down" className="fp-icon--s" />
        </div>
      ) : null}
    </nav>
  );
});
