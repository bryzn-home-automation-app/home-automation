import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import UsageChart from '../components/UsageChart';
import MonthlyComparison from '../components/MonthlyComparison';

export default function GasUsage() {
  const { gasUsage, gasTotal } = useUsageData();

  const data = gasUsage.data ?? [];
  const loading = gasUsage.isLoading;
  const monthKwh = gasTotal.data?.totalKwh ?? 0;
  const realData = data.filter((d) => d.usageKwh > 0);
  const hasData = realData.length > 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile
          label="Gas Total (60d)"
          value={monthKwh.toFixed(0)}
          unit="kWh"
          loading={loading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Records"
          value={String(data.length)}
          unit=""
          loading={loading}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Active Days"
          value={String(realData.length)}
          unit=""
          loading={loading}
          icon={Icons.Bolt}
        />
      </section>

      {/* Charts */}
      {hasData ? (
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
      ) : (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
          <div className="text-4xl mb-3">🔥</div>
          <h3 className="text-lg font-semibold text-gray-200 mb-2">
            No Gas Usage Yet
          </h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Natural gas data will appear here once you start using gas
            appliances. CoServ tracks both electric and gas on the same meter.
            Data is pulled automatically during each sync.
          </p>
        </section>
      )}
    </div>
  );
}
