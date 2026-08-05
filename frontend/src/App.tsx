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
    refetchInterval: 30_000,
  });

  const backendUp = health.data?.status === 'UP';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Home Automation
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              CoServ Energy Dashboard
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                backendUp ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-gray-500 hidden sm:inline">
              {backendUp ? 'System Online' : 'System Offline'}
            </span>
          </div>
        </header>

        {/* Tab bar */}
        <nav className="flex gap-1 mb-6 border-b border-gray-800 overflow-x-auto">
          {TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-emerald-500 text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
                }`
              }
            >
              <span className="text-base">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Page content */}
        <main>
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="mt-10 pt-5 border-t border-gray-800 text-xs text-gray-600 text-center">
          Home Automation Platform &middot; Phase 1 &middot; CoServ Integration
        </footer>
      </div>
    </div>
  );
}
