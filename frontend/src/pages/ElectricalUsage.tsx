import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';

export default function ElectricalUsage() {
  const { electricUsage, electricTotal, config } = useUsageData();

  const data = electricUsage.data ?? [];
  const loading = electricUsage.isLoading;
  const monthKwh = electricTotal.data?.totalKwh ?? 0;
  const kwhRate = config.data?.kwhRate ?? 0.1171;

  // Filter to Electric-only (exclude 0-kWh placeholders for display)
  const realData = data.filter((d) => d.usageKwh > 0);
  const today = new Date().toISOString().split('T')[0];
  const todayKwh = realData
    .filter((d) => d.timestamp.startsWith(today))
    .reduce((s, d) => s + d.usageKwh, 0);

  // 7-day and 30-day averages
  const last7 = realData.filter(
    (d) =>
      new Date(d.timestamp) >
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );
  const avg7 =
    last7.length > 0
      ? last7.reduce((s, d) => s + d.usageKwh, 0) / last7.length
      : 0;

  const last30 = realData.filter(
    (d) =>
      new Date(d.timestamp) >
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );
  const avg30 =
    last30.length > 0
      ? last30.reduce((s, d) => s + d.usageKwh, 0) / last30.length
      : 0;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Today"
          value={todayKwh.toFixed(1)}
          unit="kWh"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="60-Day Total"
          value={monthKwh.toFixed(0)}
          unit="kWh"
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="7-Day Avg"
          value={avg7.toFixed(1)}
          unit="kWh/day"
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="30-Day Avg"
          value={avg30.toFixed(1)}
          unit="kWh/day"
          loading={loading}
          icon={Icons.Bolt}
        />
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UsageChart
          data={realData.sort(
            (a, b) =>
              new Date(a.timestamp).getTime() -
              new Date(b.timestamp).getTime()
          )}
          loading={loading}
        />
        <MonthlyComparison data={realData} loading={loading} />
      </section>

      {/* Data table */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">
          Electric Usage Log
        </h3>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-gray-800 rounded" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium text-right">kWh</th>
                  <th className="pb-2 font-medium text-right">Est. Cost</th>
                  <th className="pb-2 font-medium text-right">Source</th>
                </tr>
              </thead>
              <tbody>
                {realData
                  .sort(
                    (a, b) =>
                      new Date(b.timestamp).getTime() -
                      new Date(a.timestamp).getTime()
                  )
                  .slice(0, 30)
                  .map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="py-2 text-gray-300">
                        {new Date(d.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-2 text-right text-white tabular-nums">
                        {Number(d.usageKwh).toFixed(2)}
                      </td>
                      <td className="py-2 text-right text-gray-400 tabular-nums">
                        ${(Number(d.usageKwh) * kwhRate).toFixed(2)}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {d.sourceProvider}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
