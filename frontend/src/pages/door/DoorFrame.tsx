import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '../../components/ui';
import { formatDate, formatTime } from '../../utils/format';

/**
 * The frame of the public pages (sign in, create account, guest welcome, the guest lobby). They
 * sit outside the app shell, so they bring their own: the HOMEOS wordmark and the home's clock
 * across the top, the page, and a quiet maker's line at the foot. Same width on every door so
 * the brand bar doesn't jump between them.
 */
export default function DoorFrame({ children, foot, center, className }: {
  children: ReactNode;
  /** Left side of the foot (a "Sign in instead" link). */
  foot?: ReactNode;
  /** Centre the content vertically (a single plate: sign in, create account). */
  center?: boolean;
  className?: string;
}) {
  const now = useMinuteClock();
  return (
    <div className="min-h-dvh bg-appbg text-apptext">
      <div
        className={cx(
          'fp-screen mx-auto flex min-h-dvh w-full max-w-[1080px] flex-col gap-5 px-[var(--appgutter)]',
          'pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-[calc(env(safe-area-inset-bottom,0px)+20px)] lg:pt-3 lg:pb-7',
          className,
        )}
      >
        <header className="flex min-h-[var(--apptap)] items-center justify-between gap-3">
          <span className="inline-flex items-center gap-[9px] text-[13px] font-bold tracking-[.16em] text-apptext [font-stretch:125%]">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-apptext ring-[3px] ring-appinset" />
            HOMEOS
          </span>
          <span className="fp-mono text-apptext-muted">
            {formatDate(now)} · {formatTime(now)}
          </span>
        </header>

        <main className={cx('flex flex-1 flex-col gap-[var(--appgap)]', center && 'items-center justify-center')}>
          {children}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="fp-small fp-muted">{foot}</span>
          <span className="inline-flex items-center gap-2">
            <span className="fp-label">HomeOS</span>
            <span className="fp-mono text-apptext-muted">made by bryzncode</span>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** "now", refreshed each minute: the clock in the brand bar. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
