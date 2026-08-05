import { useQuery } from '@tanstack/react-query';
import api from './api/client';
import { fetchRecentUsage, fetchTotalUsage } from './api/energy';
import StatTile, { Icons } from './components/StatTile';
import UsageChart from './components/UsageChart';
import MonthlyComparison from './components/MonthlyComparison';
import IntegrationPanel from './components/IntegrationPanel';
import type { IntegrationAdapter, EnergyUsage } from './types';

// Hardcoded for now — first meter in the DB (CoServ Electric)
const METER_ID = 1;

function App() {
  // Backend health check
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((r) => r.data),
    refetchInterval: 30_000,
  });

  // Integration status
  const integrations = useQuery<IntegrationAdapter[]>({
    queryKey: ['integrations'],
    queryFn: () => api.get('/integrations').then((r) => r.data),
    refetchInterval: 30_000,
  });

  // Energy usage data
  const usage = useQuery<EnergyUsage[]>({
    queryKey: ['energy-usage', METER_ID],
    queryFn: () => fetchRecentUsage(METER_ID, 30),
    refetchInterval: 60_000,
  });

  const totalUsage = useQuery({
    queryKey: ['total-usage', METER_ID],
    queryFn: () => fetchTotalUsage(METER_ID, 30),
    refetchInterval: 60_000,
  });

  // Calculate stats from real data
  const today = new Date().toISOString().split('T')[0];
  const todayUsage = usage.data?.filter(
    (d) => d.timestamp.startsWith(today)
  );
  const todayKwh = todayUsage?.reduce((sum, d) => sum + d.usageKwh, 0) ?? 0;

  const monthKwh = totalUsage.data?.totalKwh ?? 0;
  // Rough TX rate: $0.12/kWh
  const estimatedBill = monthKwh * 0.12;

  const backendUp = health.data?.status === 'UP';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Home Automation
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              CoServ Energy Dashboard
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                backendUp ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-gray-500">
              {backendUp ? 'System Online' : 'System Offline'}
            </span>
          </div>
        </header>

        {/* Stat Tiles */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <StatTile
            label="Today's Usage"
            value={todayKwh.toFixed(1)}
            unit="kWh"
            loading={usage.isLoading}
            icon={Icons.Bolt}
          />
          <StatTile
            label="Month Usage"
            value={monthKwh.toFixed(1)}
            unit="kWh"
            loading={totalUsage.isLoading}
            icon={Icons.Calendar}
          />
          <StatTile
            label="Estimated Bill"
            value={`$${estimatedBill.toFixed(2)}`}
            unit=""
            loading={totalUsage.isLoading}
            icon={Icons.Dollar}
          />
        </section>

        {/* Charts */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <UsageChart data={usage.data ?? []} loading={usage.isLoading} />
          <MonthlyComparison
            data={usage.data ?? []}
            loading={usage.isLoading}
          />
        </section>

        {/* Integration Panel */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <IntegrationPanel />
          <div className="lg:col-span-2 rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">
              Recent Activity
            </h3>
            {usage.isLoading ? (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 bg-gray-800 rounded" />
                ))}
              </div>
            ) : usage.data?.length ? (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {usage.data.slice(0, 10).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          d.sourceProvider === 'coserv'
                            ? 'bg-emerald-500'
                            : 'bg-blue-500'
                        }`}
                      />
                      <span className="text-sm text-gray-300">
                        {new Date(d.timestamp).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-400">
                        {d.source}
                      </span>
                      <span className="text-sm font-medium text-white tabular-nums">
                        {Number(d.usageKwh).toFixed(2)} kWh
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                No usage records yet — click "Sync Now" to pull data from
                CoServ
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-8 pt-6 border-t border-gray-800 text-xs text-gray-600 text-center">
          Home Automation Platform &middot; Phase 1 &middot; CoServ
          Integration &middot;{' '}
          {integrations.data?.length ?? 0} integration
          {integrations.data?.length !== 1 ? 's' : ''} registered
        </footer>
      </div>
    </div>
  );
}

export default App;
