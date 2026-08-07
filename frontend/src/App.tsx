import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import api from './api/client';
import { fetchUnreadCount } from './api/notifications';
import Avatar from './components/profile/Avatar';
import OnlineDot from './components/profile/OnlineDot';

export default function App() {
  const { toggleTheme, isDark } = useTheme();
  const { user, isAdmin, logout } = useAuth();

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchUnreadCount,
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: !!user,
  });

  const backendUp = health.data?.status === 'UP';
  const unreadCount = unread.data ?? 0;

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

  // Filter tabs visible to current user
  const visibleTabs = mainTabs.filter((t: any) => !t.guestHidden || (user && user.role !== 'GUEST'));

  const adminTabs = [
    { path: '/admin/guests', label: 'Guests', icon: '🪪', end: false },
    { path: '/admin/logs', label: 'Logs', icon: '📋', end: false },
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
      <div className="w-full px-3 py-3 sm:px-5 sm:py-5 lg:px-6 lg:py-6 2xl:px-8">
        <div
          className="absolute inset-x-0 top-0 -z-10 h-[32rem]"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(148,163,184,0.04), transparent)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.02), transparent)',
          }}
        />

        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-appborder bg-appsurface-raised p-3 shadow-[0_12px_36px_var(--appshadow)] backdrop-blur sm:p-4 lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:rounded-[28px] lg:p-5">
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
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-2">
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

            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:mt-5 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
              {visibleTabs.map((tab: any) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.end}
                  className={({ isActive }) =>
                    `group relative flex shrink-0 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm whitespace-nowrap transition-colors lg:w-full ${
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
                <div className="pt-1 lg:pt-2">
                  <p className="hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-apptext-dim lg:block">
                    Admin
                  </p>
                  <div className="flex gap-2 lg:block lg:space-y-1">
                    {adminTabs.map((tab) => (
                      <NavLink
                        key={tab.path}
                        to={tab.path}
                        end={tab.end}
                        className={({ isActive }) =>
                          `flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm whitespace-nowrap transition-colors lg:w-full ${
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
              <div className="mt-auto border-t border-appborder pt-3 lg:pt-4">
                <Link
                  to="/profile"
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
              <div className="mt-4 border-t border-appborder pt-3 lg:mt-5 lg:pt-4">
                <p className="text-sm text-apptext-soft">
                  <a href="/login" className="font-semibold text-appaccent-text hover:text-appaccent">Sign in</a> for full access
                </p>
              </div>
            )}
          </aside>

          <div className="min-w-0">
            <header className="rounded-2xl border border-appborder bg-appsurface-raised px-4 py-4 shadow-[0_10px_30px_var(--appshadow)] sm:px-6 sm:py-5 lg:rounded-[28px] lg:px-7 lg:py-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="inline-flex items-center rounded-full border border-appaccent-border bg-appaccent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-appaccent-text">
                    Operations Console
                  </p>
                  <h2 className="mt-3 max-w-3xl text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl xl:text-4xl">
                    Utilities, alerts, and automations in one left-rail workspace.
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-apptext-soft sm:text-base">
                    Fast navigation, focused pages, and real-time signals for your home operations stack.
                  </p>
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
    </div>
  );
}
