import { memo, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import api from './api/client';
import { fetchUnreadCount } from './api/notifications';
import Avatar from './components/profile/Avatar';
import OnlineDot from './components/profile/OnlineDot';

export default memo(function App() {
  const { toggleTheme, isDark } = useTheme();
  const { user, isAdmin, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchUnreadCount,
    staleTime: 120_000,
    refetchInterval: 120_000,
    enabled: !!user,
  });

  const backendUp = health.data?.status === 'UP';
  const unreadCount = unread.data ?? 0;

  const closeMenu = useCallback(() => setMobileMenuOpen(false), []);

  const mainTabs = [
    { path: '/', label: 'Home', icon: '🏠', end: true },
    { path: '/electric', label: 'Electric', icon: '⚡', end: false },
    { path: '/gas', label: 'Gas', icon: '🔥', end: false },
    { path: '/water', label: 'Water', icon: '💧', end: false },
    { path: '/roomba', label: 'Roomba', icon: '🤖', end: false },
    { path: '/wifi', label: 'WiFi', icon: '📶', end: false },
    { path: '/notifications', label: 'Alerts', icon: '🔔', end: false },
    { path: '/users', label: 'Users', icon: '👥', end: false },
    { path: '/maintenance', label: 'Maintenance', icon: '🔧', end: false, guestHidden: true },
  ];

  const visibleTabs = mainTabs.filter((t: any) => !t.guestHidden || (user && user.role !== 'GUEST'));

  const adminTabs = [
    { path: '/admin/guests', label: 'Guests', icon: '🪪', end: false },
    { path: '/admin/debug', label: 'Debug', icon: '🔧', end: false },
    { path: '/admin/logs', label: 'Logs', icon: '📋', end: false },
  ];

  // ── Sidebar content (shared between desktop and mobile overlay) ──
  const sidebarContent = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-appborder pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-appwarning/90">
            bryzncode
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-apptext">
            HomeOS
          </h1>
          <p className="text-xs text-apptext-muted">Home Intelligence Dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle shrink-0"
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          >
            <span className={`theme-toggle-thumb ${isDark ? '' : 'light'}`}>
              {isDark ? '🌙' : '☀️'}
            </span>
          </button>
          {/* Close button — only visible on mobile overlay */}
          <button
            type="button"
            onClick={closeMenu}
            className="rounded-lg p-1.5 text-apptext-muted hover:bg-appinset hover:text-apptext lg:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-appborder bg-appinset px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-apptext-dim">Status</p>
          <p className="mt-1 text-xs font-semibold text-apptext">
            {backendUp ? 'API Up' : 'API Down'}
          </p>
        </div>
        <div className="rounded-xl border border-appborder bg-appinset px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-apptext-dim">Role</p>
          <p className="mt-1 text-xs font-semibold text-apptext">{user ? user.role : 'Guest'}</p>
        </div>
      </div>

      <nav className="mt-4 flex flex-col gap-1 lg:mt-5">
        {visibleTabs.map((tab: any) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.end}
            onClick={closeMenu}
            className={({ isActive }) =>
              `group relative flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors w-full ${
                isActive
                  ? 'border-appaccent-border bg-appaccent-soft text-apptext'
                  : 'border-transparent text-apptext-soft hover:border-appborder hover:bg-appinset hover:text-apptext'
              }`
            }
          >
            <span className="flex items-center gap-2.5">
              <span className="text-base">{tab.icon}</span>
              <span className="font-medium">{tab.label}</span>
            </span>
            {tab.path === '/notifications' && unreadCount > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-appdanger px-1.5 text-[10px] font-bold text-white shadow-[0_0_10px_var(--appdanger)]">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}

        {isAdmin && (
          <div className="pt-2">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-apptext-dim">
              Admin
            </p>
            <div className="flex flex-col gap-1">
              {adminTabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.end}
                  onClick={closeMenu}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors w-full ${
                      isActive
                        ? 'border-amber-300/40 bg-amber-300/15 text-apptext'
                        : 'border-transparent text-apptext-soft hover:border-appborder hover:bg-appinset hover:text-apptext'
                    }`
                  }
                >
                  <span className="text-base">{tab.icon}</span>
                  <span className="font-medium">{tab.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Profile shortcut */}
      {user ? (
        <div className="mt-auto border-t border-appborder pt-4">
          <Link
            to="/profile"
            onClick={closeMenu}
            className="flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-appborder hover:bg-appinset"
          >
            <div className="relative shrink-0">
              <Avatar
                displayName={user.displayName}
                avatarUrl={user.avatarUrl}
                accentColor={user.accentColor || '#34d399'}
                size={36}
              />
              <OnlineDot className="absolute -top-0.5 -right-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-apptext">{user.displayName}</p>
              <p className="text-xs text-apptext-dim">@{user.username}</p>
            </div>
            <span className="text-xs text-apptext-muted">→</span>
          </Link>
          <button
            type="button"
            onClick={logout}
            className="mt-2 w-full rounded-xl border border-appdanger/30 bg-appdanger/10 px-4 py-2 text-sm font-semibold text-appdanger transition-colors hover:bg-appdanger/20"
          >
            Sign Out
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-appborder pt-4">
          <p className="text-sm text-apptext-soft">
            <a href="/login" className="font-semibold text-appaccent-text hover:text-appaccent">Sign in</a> for full access
          </p>
        </div>
      )}
    </>
  );

  // ── Bottom nav tabs (mobile only) ──
  const bottomTabs = [
    { path: '/', label: 'Home', icon: '🏠', end: true },
    { path: '/electric', label: 'Electric', icon: '⚡', end: false },
    { path: '/notifications', label: 'Alerts', icon: '🔔', end: false },
    { path: '/gas', label: 'Gas', icon: '🔥', end: false },
    { path: '/wifi', label: 'WiFi', icon: '📶', end: false },
  ];

  return (
    <div
      className="min-h-[100dvh] transition-colors duration-300"
      style={{
        background: isDark
          ? 'radial-gradient(circle at top left, rgba(56,189,248,0.16), transparent 24%), radial-gradient(circle at top right, rgba(16,185,129,0.18), transparent 30%), linear-gradient(180deg, #07111f 0%, #08101c 42%, #050913 100%)'
          : 'radial-gradient(circle at top left, rgba(56,189,248,0.08), transparent 24%), radial-gradient(circle at top right, rgba(5,150,105,0.08), transparent 30%), linear-gradient(180deg, #f8fafc 0%, #f1f5f9 42%, #e2e8f0 100%)',
      }}
    >
      <div className="w-full px-2 py-2 sm:px-5 sm:py-5 lg:px-6 lg:py-6 2xl:px-8 pb-20 lg:pb-0">
        <div
          className="absolute inset-x-0 top-0 -z-10 h-[32rem]"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(148,163,184,0.04), transparent)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.02), transparent)',
          }}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
          {/* ── Desktop sidebar (sticky left rail) ── */}
          <aside className="hidden lg:flex lg:flex-col rounded-2xl border border-appborder bg-appsurface-raised p-4 shadow-[0_12px_36px_var(--appshadow)] lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:rounded-[28px] lg:p-5">
            {sidebarContent}
          </aside>

          {/* ── Mobile sidebar overlay ── */}
          {mobileMenuOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
                onClick={closeMenu}
              />
              {/* Slide-in panel */}
              <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-y-auto rounded-r-2xl border-r border-appborder bg-appsurface p-4 shadow-2xl lg:hidden">
                {sidebarContent}
              </aside>
            </>
          )}

          <div className="min-w-0">
            <header className="rounded-2xl border border-appborder bg-appsurface-raised px-3 py-3 shadow-[0_10px_30px_var(--appshadow)] sm:px-6 sm:py-5 lg:rounded-[28px] lg:px-7 lg:py-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex items-center gap-3">
                  {/* Hamburger — mobile only */}
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(true)}
                    className="rounded-xl border border-appborder bg-appinset p-2 text-apptext hover:border-appborder-hover lg:hidden"
                    aria-label="Open menu"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <div>
                    <p className="inline-flex items-center rounded-full border border-appaccent-border bg-appaccent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-appaccent-text">
                      Operations Console
                    </p>
                    <h2 className="mt-3 max-w-3xl text-xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl xl:text-4xl">
                      Utilities, alerts, and automations in one left-rail workspace.
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-apptext-soft sm:text-base">
                      Fast navigation, focused pages, and real-time signals for your home operations stack.
                    </p>
                  </div>
                </div>
                <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
                  <div className="rounded-xl border border-appborder bg-appinset px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-apptext-dim">Backend</p>
                    <p className="mt-1 text-sm font-semibold text-apptext">{backendUp ? 'Healthy' : 'Offline'}</p>
                  </div>
                  <div className="rounded-xl border border-appborder bg-appinset px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-apptext-dim">Unread</p>
                    <p className="mt-1 text-sm font-semibold text-apptext">{unreadCount}</p>
                  </div>
                  <div className="rounded-xl border border-appborder bg-appinset px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-apptext-dim">Access</p>
                    <p className="mt-1 text-sm font-semibold text-apptext">{isAdmin ? 'Admin' : user ? 'Member' : 'Guest'}</p>
                  </div>
                </div>
              </div>
            </header>

            <main className="mt-4 lg:mt-5">
              <Outlet />
            </main>

            <footer className="mt-10 border-t border-appborder px-1 pt-5 text-center text-xs text-apptext-dim">
              Home Automation Platform · Phase 1 · CoServ Integration
            </footer>
          </div>
        </div>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-appborder bg-appsurface/95 backdrop-blur-md lg:hidden pb-safe">
        <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-1.5">
          {bottomTabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'text-appaccent-text'
                    : 'text-apptext-muted hover:text-apptext-soft'
                }`
              }
            >
              <span className="text-lg">{tab.icon}</span>
              <span className="leading-none">{tab.label}</span>
              {tab.path === '/notifications' && unreadCount > 0 && (
                <span className="absolute -top-0.5 right-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-appdanger px-1 text-[9px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
});
