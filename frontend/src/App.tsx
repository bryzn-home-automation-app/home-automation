import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import api from './api/client';

export default function App() {
  const { toggleTheme, isDark } = useTheme();
  const { user, isAdmin, logout } = useAuth();

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const backendUp = health.data?.status === 'UP';

  const mainTabs = [
    { path: '/', label: 'Home', icon: '🏠', end: true },
    { path: '/electric', label: 'Electric', icon: '⚡', end: false },
    { path: '/gas', label: 'Gas', icon: '🔥', end: false },
    { path: '/water', label: 'Water', icon: '💧', end: false },
    { path: '/roomba', label: 'Roomba', icon: '🤖', end: false },
    { path: '/wifi', label: 'WiFi', icon: '📶', end: false },
  ];

  const adminTabs = [
    { path: '/admin/users', label: 'Users', icon: '👥', end: false },
    { path: '/admin/guests', label: 'Guests', icon: '🪪', end: false },
    { path: '/admin/logs', label: 'Logs', icon: '📋', end: false },
  ];

  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{
        background: isDark
          ? 'radial-gradient(circle at top left, rgba(56,189,248,0.16), transparent 24%), radial-gradient(circle at top right, rgba(16,185,129,0.18), transparent 30%), linear-gradient(180deg, #07111f 0%, #08101c 42%, #050913 100%)'
          : 'radial-gradient(circle at top left, rgba(56,189,248,0.08), transparent 24%), radial-gradient(circle at top right, rgba(5,150,105,0.08), transparent 30%), linear-gradient(180deg, #f8fafc 0%, #f1f5f9 42%, #e2e8f0 100%)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div
          className="absolute inset-x-0 top-0 -z-10 h-[32rem]"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(148,163,184,0.04), transparent)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.02), transparent)',
          }}
        />

        <header className="mb-6 rounded-[28px] border border-appborder bg-appsurface-raised px-5 py-5 shadow-[0_10px_30px_var(--appshadow)] sm:px-7 sm:py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-appaccent-border bg-appaccent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-appaccent-text">
                  Home Intelligence Dashboard
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-appwarning/90">
                  bryzncode
                </span>
              </div>
              <div>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-apptext sm:text-4xl lg:text-[2.75rem]">
                  Monitor utilities like a modern operating system for your home.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-apptext-soft sm:text-base">
                  Live usage, cost signals, sync health, and future smart-home modules in one dashboard built for daily use on desktop and mobile.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[26rem]">
              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-dim">Status</p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className={`inline-flex h-3 w-3 rounded-full ${
                      backendUp
                        ? 'bg-appsuccess shadow-[0_0_16px_var(--appsuccess)]'
                        : 'bg-appdanger shadow-[0_0_16px_var(--appdanger)]'
                    }`}
                  />
                  <p className="text-sm font-semibold text-apptext">
                    {backendUp ? 'API reachable' : 'API unavailable'}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-dim">Role</p>
                <p className="mt-3 text-sm font-semibold text-apptext">
                  {user ? user.role : 'Guest'}
                </p>
                <p className="mt-1 text-xs text-apptext-muted">
                  {isAdmin ? 'Full admin access' : user ? 'Household member' : 'Not signed in'}
                </p>
              </div>

              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-dim">Session</p>
                {user ? (
                  <button
                    type="button"
                    onClick={logout}
                    className="mt-3 rounded-full border border-appdanger/30 bg-appdanger/10 px-4 py-1.5 text-xs font-semibold text-appdanger transition-colors hover:bg-appdanger/20"
                  >
                    Sign Out
                  </button>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-apptext-soft">
                    <a href="/login" className="text-appaccent-text hover:text-appaccent">Sign in</a> for full access
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Main nav */}
          <div className="mt-6 flex items-center gap-2">
            <nav className="flex flex-1 gap-2 overflow-x-auto pb-1">
              {mainTabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.end}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all ${
                      isActive
                        ? 'border-appaccent-border bg-appaccent-soft text-apptext shadow-[0_10px_30px_var(--appaccent-soft)]'
                        : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover hover:bg-appinset-strong hover:text-apptext'
                    }`
                  }
                >
                  <span className="text-base">{tab.icon}</span>
                  <span>{tab.label}</span>
                </NavLink>
              ))}

              {/* Admin section with distinct styling */}
              {isAdmin && (
                <>
                  <span className="mx-1 inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.2em] text-apptext-dim">
                    Admin
                  </span>
                  {adminTabs.map((tab) => (
                    <NavLink
                      key={tab.path}
                      to={tab.path}
                      end={tab.end}
                      className={({ isActive }) =>
                        `inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all ${
                          isActive
                            ? 'border-amber-300/40 bg-amber-300/15 text-apptext'

                            : 'border-appborder-light bg-appinset text-apptext-soft hover:border-appborder-hover hover:bg-appinset-strong hover:text-apptext'
                        }`
                      }
                    >
                      <span className="text-base">{tab.icon}</span>
                      <span>{tab.label}</span>
                    </NavLink>
                  ))}
                </>
              )}
            </nav>

            {/* Theme toggle */}
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
        </header>

        <main>
          <Outlet />
        </main>

        <footer className="mt-10 border-t border-appborder px-1 pt-5 text-center text-xs text-apptext-dim">
          Home Automation Platform · Phase 1 · CoServ Integration
        </footer>
      </div>
    </div>
  );
}
