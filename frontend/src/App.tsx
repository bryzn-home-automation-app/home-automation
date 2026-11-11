import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation } from 'react-router-dom';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import api from './api/client';
import { fetchUnreadCount } from './api/notifications';
import { useJitteredInterval } from './hooks/useJitteredInterval';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { PageHeader } from './components/PageHeader';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import { useAppPresence } from './hooks/useAppPresence';
import { useAppSleep } from './hooks/useAppSleep';
import { SleepScreen, SleepWarning } from './components/SleepScreen';
import PullToRefresh from './components/PullToRefresh';
import ErrorBoundary from './components/ErrorBoundary';
import TopStrip from './components/shell/TopStrip';
import KeyColumn from './components/shell/KeyColumn';
import KeyRow from './components/shell/KeyRow';
import MoreSheet from './components/shell/MoreSheet';
import { PageMetaProvider, type PageMeta } from './components/shell/PageMeta';
import { houseStatus } from './components/shell/houseStatus';
import { GROUP_LABEL, routeForPath } from './routes';

/**
 * Fetch the chart-heavy tabs (and recharts with them) once the shell is idle, so
 * the first tap on Utilities or Climate doesn't wait on ~110 KB gz of JS — noticeable
 * over LTE. The same import() calls React.lazy makes, so the routes then resolve
 * instantly. Utilities' three views are chunks of their own, so they come too: the
 * first tap on Gas or Water used to flash a loading placeholder (B-051). Data-saver
 * connections skip it.
 */
function usePrefetchTabs() {
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const warm = () => {
      void import('./pages/Utility');
      void import('./pages/ElectricalUsage');
      void import('./pages/Climate');
      void import('./pages/GasUsage');
      void import('./pages/WaterUsage');
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 6_000 });
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 3_000);
    return () => clearTimeout(t);
  }, []);
}

/** While the home server isn't answering, look again sooner than the usual two minutes. */
const HEALTH_RETRY_MS = 30_000;

/**
 * The Faceplate shell: the top strip, the desktop key column, the page header, and
 * on phones the key row and its More sheet. Every name and icon comes from the route
 * registry (routes.ts). See docs/faceplate/IMPLEMENTATION.md, "Shell and routes".
 */
export default memo(function App() {
  const { toggleTheme, isDark, mode: themeMode, setSunLocation } = useTheme();
  const { user, isAdmin, logout } = useAuth();
  usePrefetchTabs();

  // The Auto (sunset) theme needs the home's coordinates; the theme provider keeps
  // them in localStorage, so it keeps working on the login screen and offline.
  const appConfig = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get('/config').then((r) => r.data),
    staleTime: 300_000,
  });
  useEffect(() => {
    const c = appConfig.data as { propertyLatitude?: number; propertyLongitude?: number } | undefined;
    if (c?.propertyLatitude != null && c?.propertyLongitude != null) {
      setSunLocation(Number(c.propertyLatitude), Number(c.propertyLongitude));
    }
  }, [appConfig.data, setSunLocation]);
  const themeToggleLabel = `${themeMode === 'auto' ? 'Auto (sunset) is on — ' : ''}Switch to ${isDark ? 'light' : 'dark'} mode`;

  const { pathname, hash } = useLocation();
  // On a phone or tablet the page scrolls inside this box, not the window (see the shell below).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  // A new page starts at the top. Keyed on pathname only, so sub-tab (?view=) changes keep their
  // scroll; anchor links (#hash) are left to the browser.
  useLayoutEffect(() => {
    if (hash) return;
    window.scrollTo(0, 0);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header: the registry names the page; the page may add a freshness line (usePageMeta).
  const route = routeForPath(pathname);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const title = meta?.title ?? route?.title ?? 'HomeOS';
  const eyebrow = route ? GROUP_LABEL[route.group] : undefined;
  const subtitle = meta?.subtitle;
  useDocumentTitle(title === 'Home' || title === 'HomeOS' ? 'HomeOS' : `${title} · HomeOS`);

  // Left open and untouched for 10 minutes, the app sleeps: the page unmounts (live
  // video stops), and so do the camera warm-up, active minutes and shell polling.
  const { asleep, secondsLeft, warningSeconds, testing: sleepTesting, wake } = useAppSleep(!!user);

  // Members: record tab visits/active minutes, and keep the cameras warm while they're here.
  useAppPresence(pathname, !!user && user.role !== 'GUEST', asleep);

  // Memoized once per query lifecycle so the RQ poll timer isn't reset on every
  // App re-render.
  const healthInterval = useJitteredInterval(120_000);
  const unreadInterval = useJitteredInterval(120_000);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    staleTime: 120_000,
    refetchInterval: (q) => (q.state.status === 'error' ? HEALTH_RETRY_MS : healthInterval),
    refetchIntervalInBackground: false,
    enabled: !asleep,
  });

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchUnreadCount,
    staleTime: 120_000,
    refetchInterval: unreadInterval,
    refetchIntervalInBackground: false,
    enabled: !!user && !asleep,
  });

  const house = houseStatus(health);
  const unreadCount = unread.data ?? 0;
  const role = user?.role ?? null;

  // The phone's More sheet. It closes itself on a page key; a route change from
  // anywhere else (a link in a notification, Back) closes it too.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const openMore = useCallback(() => setMoreOpen(true), []);
  useEffect(() => setMoreOpen(false), [pathname]);
  // Asleep, nothing may sit over the night-light: an open sheet would keep a bright panel
  // on the wall screen, and a tap on its scrim would close it without waking the app.
  useEffect(() => {
    if (asleep) setMoreOpen(false);
  }, [asleep]);
  // From lg the sheet is hidden by CSS (the key column has all of it), but hidden isn't closed:
  // its scroll lock, focus trap and Back entry would stay live behind nothing (an iPad turned
  // to landscape with the sheet open couldn't scroll). Crossing the breakpoint closes it.
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 64rem)');
    if (!mq) return;
    const onChange = () => {
      if (mq.matches) setMoreOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const skipToContent = (e: MouseEvent) => {
    e.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <PageMetaProvider value={setMeta}>
      <div className="fp-app">
        <a
          href="#main"
          onClick={skipToContent}
          className="fp-btn fp-btn--primary sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-[max(0.75rem,env(safe-area-inset-top))] focus:z-[80]"
        >
          Skip to content
        </a>

        {/* Below lg the page scrolls inside this box and the window never moves. With the
            window scrolling, the iOS 26 Home Screen app let the fixed bottom key row drift up
            the screen by its own height mid-scroll, on every tab. The strip is sticky inside
            the box (from lg, inside the window), and draws the status-bar inset itself, since
            the Home Screen app draws under the status bar. fp-content's bottom padding clears
            the fixed key row and the home indicator. */}
        <div
          ref={scrollerRef}
          data-page-scroller
          className="relative w-full max-lg:h-[100dvh] max-lg:overflow-y-auto max-lg:overscroll-y-contain"
        >
          {user ? (
            <TopStrip
              title={title}
              subtitle={subtitle}
              house={house}
              houseHref={isAdmin ? '/admin/nuc' : '/'}
              unread={unreadCount}
              user={user}
              isDark={isDark}
              themeTitle={themeToggleLabel}
              onToggleTheme={toggleTheme}
            />
          ) : null}
          <div className="fp-frame">
            <KeyColumn role={role} unread={unreadCount} onSignOut={logout} />
            <div className="fp-content">
              <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
              <main id="main" ref={mainRef} tabIndex={-1} className="focus:outline-none">
                {!asleep && (
                  <ErrorBoundary key={pathname}>
                    <Outlet />
                  </ErrorBoundary>
                )}
              </main>
            </div>
          </div>
        </div>
        {!asleep && <PullToRefresh />}

        <KeyRow ref={moreButtonRef} role={role} unread={unreadCount} moreOpen={moreOpen} onMore={openMore} />
        <MoreSheet
          open={moreOpen && !asleep}
          onClose={closeMore}
          returnFocusRef={moreButtonRef}
          role={role}
          unread={unreadCount}
          onSignOut={logout}
        />

        {asleep && <SleepScreen onWake={wake} testing={sleepTesting} />}
        <SleepWarning secondsLeft={asleep ? null : secondsLeft} totalSeconds={warningSeconds} onStay={wake} />

        {/* One-time "What's new" popup shown after a new version ships. Not while asleep: a
            deploy reloads the wall tablet, and the sheet would cover the night-light. It
            records the version only when closed, so after waking it simply opens then. */}
        {!asleep && <ReleaseNotesModal />}
      </div>
    </PageMetaProvider>
  );
});
