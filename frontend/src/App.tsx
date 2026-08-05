import { useQuery } from '@tanstack/react-query';
import api from './api/client';
import type { IntegrationAdapter } from './types';

function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const integrations = useQuery<IntegrationAdapter[]>({
    queryKey: ['integrations'],
    queryFn: () => api.get('/integrations').then((r) => r.data),
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header */}
      <header className="mb-12">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Home Automation Platform
        </h1>
        <p className="mt-2 text-gray-400">
          Self-hosted energy monitoring and home intelligence
        </p>
      </header>

      {/* System Status */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">System Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatusCard
            label="Backend API"
            status={health.isLoading ? 'checking' : health.data?.status === 'UP' ? 'up' : 'down'}
            detail={health.data?.database === 'connected' ? 'Database connected' : health.data?.database}
          />
          <StatusCard
            label="Integrations"
            status={
              integrations.isLoading
                ? 'checking'
                : (integrations.data?.length ?? 0) > 0
                ? 'up'
                : 'down'
            }
            detail={
              integrations.data
                ? `${integrations.data.length} adapter${integrations.data.length !== 1 ? 's' : ''} registered`
                : undefined
            }
          />
        </div>
      </section>

      {/* Integrations */}
      <section>
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Registered Integrations</h2>
        {integrations.isLoading ? (
          <p className="text-gray-500">Loading…</p>
        ) : integrations.data?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {integrations.data.map((adapter) => (
              <div
                key={adapter.key}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{adapter.name}</span>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      adapter.healthy === 'true' ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  />
                </div>
                <p className="text-sm text-gray-500 mt-1">{adapter.key}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No integrations registered yet.</p>
        )}
      </section>

      {/* Coming Soon */}
      <section className="mt-12 pt-8 border-t border-gray-800">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Coming Soon</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {['Dashboard', 'Usage Charts', 'Bill Tracking', 'Analytics'].map((item) => (
            <div
              key={item}
              className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 text-center text-sm text-gray-500"
            >
              {item}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-16 pt-6 border-t border-gray-800 text-xs text-gray-600 text-center">
        Home Automation Platform &middot; Phase 1 &middot; CoServ Integration
      </footer>
    </div>
  );
}

function StatusCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'up' | 'down' | 'checking';
  detail?: string;
}) {
  const colors = {
    up: 'border-emerald-800 bg-emerald-950/50 text-emerald-400',
    down: 'border-red-800 bg-red-950/50 text-red-400',
    checking: 'border-gray-700 bg-gray-900/50 text-gray-500',
  };

  return (
    <div className={`rounded-lg border p-4 ${colors[status]}`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            status === 'up'
              ? 'bg-emerald-500'
              : status === 'down'
              ? 'bg-red-500'
              : 'bg-gray-500 animate-pulse'
          }`}
        />
        <span className="font-medium">{label}</span>
      </div>
      {detail && <p className="text-sm mt-1 opacity-75">{detail}</p>}
    </div>
  );
}

export default App;
