import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import api from './api/client';

const TABS = [
  { path: '/', label: 'Home', icon: '🏠', end: true },
  { path: '/electric', label: 'Electric', icon: '⚡', end: false },
  { path: '/gas', label: 'Gas', icon: '🔥', end: false },
  { path: '/water', label: 'Water', icon: '💧', end: false },
  { path: '/roomba', label: 'Roomba', icon: '🤖', end: false },
];

export default function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const backendUp = health.data?.status === 'UP';

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_30%),linear-gradient(180deg,_#07111f_0%,_#08101c_42%,_#050913_100%)] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[linear-gradient(180deg,rgba(148,163,184,0.04),transparent)]" />

        <header className="mb-6 rounded-[28px] border border-white/10 bg-slate-900/88 px-5 py-5 shadow-[0_10px_30px_rgba(2,8,23,0.26)] sm:px-7 sm:py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
                Home Intelligence Dashboard
              </span>
              <div>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl lg:text-[2.75rem]">
                  Monitor utilities like a modern operating system for your home.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Live usage, cost signals, sync health, and future smart-home modules in one dashboard built for daily use on desktop and mobile.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[22rem]">
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                  Platform Status
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className={`inline-flex h-3 w-3 rounded-full ${
                      backendUp ? 'bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.9)]' : 'bg-rose-400 shadow-[0_0_16px_rgba(251,113,133,0.9)]'
                    }`}
                  />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {backendUp ? 'API reachable' : 'API unavailable'}
                    </p>
                    <p className="text-xs text-slate-400">
                      Auto-checking every 30 seconds
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                  Phase
                </p>
                <p className="mt-3 text-sm font-semibold text-white">
                  CoServ energy baseline
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Ready for billing, maintenance, and device modules.
                </p>
              </div>
            </div>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1">
            {TABS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                end={tab.end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all ${
                    isActive
                      ? 'border-emerald-300/40 bg-emerald-300/15 text-white shadow-[0_10px_30px_rgba(16,185,129,0.18)]'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/8 hover:text-white'
                  }`
                }
              >
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </NavLink>
            ))}
          </nav>
        </header>

        <main>
          <Outlet />
        </main>

        <footer className="mt-10 border-t border-white/10 px-1 pt-5 text-center text-xs text-slate-500">
          Home Automation Platform · Phase 1 · CoServ Integration · bryzncode
        </footer>
      </div>
    </div>
  );
}
