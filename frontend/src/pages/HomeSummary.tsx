import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import IntegrationPanel from '../components/IntegrationPanel';

export default function HomeSummary() {
  const {
    electricUsage,
    gasUsage,
    electricTotal,
    gasTotal,
    config,
  } = useUsageData();

  const kwhRate = config.data?.kwhRate ?? 0.1171;
  const elecKwh = electricTotal.data?.totalKwh ?? 0;
  const gasKwh = gasTotal.data?.totalKwh ?? 0;
  const totalKwh = elecKwh + gasKwh;
  const estimatedBill = totalKwh * kwhRate;

  // Today's electric usage
  const today = new Date().toISOString().split('T')[0];
  const todayElec =
    electricUsage.data
      ?.filter((d) => d.timestamp.startsWith(today))
      .reduce((s, d) => s + d.usageKwh, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Today (Elec)"
          value={todayElec.toFixed(1)}
          unit="kWh"
          loading={electricUsage.isLoading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Electric (60d)"
          value={elecKwh.toFixed(0)}
          unit="kWh"
          loading={electricTotal.isLoading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Est. Bill"
          value={`$${estimatedBill.toFixed(2)}`}
          unit=""
          loading={electricTotal.isLoading}
          icon={Icons.Dollar}
        />
        <StatTile
          label="Gas (60d)"
          value={gasKwh.toFixed(0)}
          unit="kWh"
          loading={gasTotal.isLoading}
          icon={Icons.Calendar}
        />
      </section>

      {/* Service cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Electric', count: electricUsage.data?.length ?? 0, color: 'bg-emerald-500', route: '/electric' },
          { label: 'Gas', count: gasUsage.data?.length ?? 0, color: 'bg-blue-500', route: '/gas' },
          { label: 'Water', count: '—', color: 'bg-cyan-500', route: '/water' },
          { label: 'Roomba', count: '—', color: 'bg-violet-500', route: '/roomba' },
        ].map((svc) => (
          <a
            key={svc.label}
            href={svc.route}
            className="rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-gray-600 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${svc.color}`} />
              <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
                {svc.label}
              </span>
            </div>
            <span className="text-2xl font-bold text-white tabular-nums">
              {svc.count}
            </span>
            <span className="text-xs text-gray-500 ml-1">records</span>
          </a>
        ))}
      </section>

      {/* Activity feed + Integration */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">
            Recent Activity
          </h3>
          {electricUsage.isLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-gray-800 rounded" />
              ))}
            </div>
          ) : electricUsage.data?.length ? (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {[...electricUsage.data]
                .sort(
                  (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime()
                )
                .slice(0, 12)
                .map((d) => (
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
                      <span className="text-xs text-gray-500">{d.sourceProvider}</span>
                      <span className="text-sm font-medium text-white tabular-nums">
                        {Number(d.usageKwh).toFixed(2)} kWh
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              No usage data yet — run <code className="text-gray-400">npm run sync</code>
            </div>
          )}
        </div>
        <IntegrationPanel />
      </section>
    </div>
  );
}
