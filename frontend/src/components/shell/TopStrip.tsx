import { memo, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import ShellAvatar from './ShellAvatar';
import { HOUSE_STATUS, type HouseStatus } from './houseStatus';

/**
 * Date and time for the desktop strip, in DM Mono. Isolated so its per-minute tick
 * re-renders only this leaf, never the shell. Aligns to the minute boundary rather
 * than polling every second. Not a live region: a clock read aloud every minute
 * would be noise.
 */
const StripClock = memo(function StripClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return (
    <p className="fp-strip-clock fp-mono">
      <time dateTime={now.toISOString()} className="inline-flex items-center gap-3">
        <span>{date}</span>
        <span className="fp-strip-clock-sep" aria-hidden="true" />
        <span>{time}</span>
      </time>
    </p>
  );
});

export interface TopStripProps {
  /** The page title (phone only; the desktop header shows it under the strip). */
  title: string;
  subtitle?: string;
  house: HouseStatus;
  /** Where the House plate leads: Server health for an admin, Home for everyone else. */
  houseHref: string;
  unread: number;
  user: { displayName: string; username: string; avatarUrl?: string | null; accentColor?: string | null };
  isDark: boolean;
  themeTitle: string;
  onToggleTheme: () => void;
}

/**
 * The strip across the top. Desktop: wordmark, clock, the House and Alerts lamps, a
 * theme key and the avatar. Phone and tablet: the page title (silk-screen caps) with
 * its freshness line, the Alerts bell with its count, and the avatar. The kit's CSS
 * decides which parts show at which width; everything is rendered once.
 */
export default memo(function TopStrip({
  title,
  subtitle,
  house,
  houseHref,
  unread,
  user,
  isDark,
  themeTitle,
  onToggleTheme,
}: TopStripProps) {
  const status = HOUSE_STATUS[house];
  const name = user.displayName || user.username;
  const unreadText = unread > 99 ? '99+' : String(unread);
  return (
    <header className="fp-strip">
      <Link className="fp-wordmark" to="/" aria-label="HomeOS, go to Home">
        <span className="fp-wordmark-dot" aria-hidden="true" />
        HOMEOS
      </Link>
      <StripClock />

      {/* The title is decorative here: the page's h1 (visually hidden on a phone) says it. */}
      <div className="fp-strip-titles" aria-hidden="true">
        <p className="fp-strip-title">{title}</p>
        {subtitle ? <p className="fp-strip-sub fp-mono">{subtitle}</p> : null}
      </div>

      <div className="fp-strip-end">
        <Link
          className="fp-strip-plate fp-strip-plate--house"
          to={houseHref}
          aria-label={`House status: ${status.spoken}`}
          data-house={house}
        >
          <span className="fp-label">House</span>
          <span className={status.lamp} aria-hidden="true" />
          <span className="fp-strip-plate-val">{status.word}</span>
        </Link>
        <NavLink
          className="fp-strip-plate fp-strip-plate--alerts"
          to="/notifications"
          aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts, none unread'}
        >
          <Icon name="bell" className="fp-strip-bell" />
          {unread > 0 ? (
            <span className="fp-count fp-strip-count" aria-hidden="true">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
          <span className="fp-label">Alerts</span>
          <span className={unread > 0 ? 'fp-lamp fp-lamp--info' : 'fp-lamp'} aria-hidden="true" />
          <span className="fp-strip-plate-val fp-mono">{unreadText}</span>
        </NavLink>
        <button
          type="button"
          className="fp-icon-btn fp-icon-btn--quiet fp-strip-theme"
          onClick={onToggleTheme}
          aria-label="Dark theme"
          aria-pressed={isDark}
          title={themeTitle}
        >
          <Icon name="moon" className="fp-theme-icon-dark" />
          <Icon name="sun" className="fp-theme-icon-light" />
        </button>
        <NavLink className="fp-strip-avatar" to="/profile" aria-label={`Your profile, ${name}`}>
          <ShellAvatar name={name} avatarUrl={user.avatarUrl} accentColor={user.accentColor} />
        </NavLink>
      </div>
    </header>
  );
});
