import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EnergyUsage } from '../types';

interface MonthlyComparisonProps {
  data: EnergyUsage[];
  loading?: boolean;
}

export default function MonthlyComparison({ data, loading }: MonthlyComparisonProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 animate-pulse">
        <div className="h-5 w-48 bg-gray-800 rounded mb-4" />
        <div className="h-64 bg-gray-800/50 rounded" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">
          Monthly Comparison
        </h3>
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          Not enough data for monthly comparison yet
        </div>
      </div>
    );
  }

  // Group usage by month
  const byMonth = new Map<string, number>();
  data.forEach((d) => {
    const key = new Date(d.timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
    byMonth.set(key, (byMonth.get(key) || 0) + Number(d.usageKwh));
  });

  const chartData = Array.from(byMonth.entries()).map(([month, kWh]) => ({
    month,
    kWh: Math.round(kWh * 100) / 100,
  }));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">
        Monthly Comparison
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="month"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#1f2937' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#1f2937' }}
            tickLine={false}
            unit=" kWh"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#111827',
              border: '1px solid #1f2937',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#f3f4f6',
            }}
            formatter={(value: number) => [`${value.toFixed(2)} kWh`, 'Total']}
            labelStyle={{ color: '#9ca3af', marginBottom: 4 }}
          />
          <Bar
            dataKey="kWh"
            fill="#059669"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
