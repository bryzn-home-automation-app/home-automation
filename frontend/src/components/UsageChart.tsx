import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EnergyUsage } from '../types';

interface UsageChartProps {
  data: EnergyUsage[];
  loading?: boolean;
}

export default function UsageChart({ data, loading }: UsageChartProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 animate-pulse">
        <div className="h-5 w-40 bg-gray-800 rounded mb-4" />
        <div className="h-64 bg-gray-800/50 rounded" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Daily Usage</h3>
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          No usage data yet — sync to pull data from CoServ
        </div>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: new Date(d.timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    kWh: Number(d.usageKwh),
  }));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Daily Usage</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#1f2937' }}
            tickLine={false}
            interval="preserveStartEnd"
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
            formatter={(value: number) => [`${value.toFixed(2)} kWh`, 'Usage']}
            labelStyle={{ color: '#9ca3af', marginBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey="kWh"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }}
            activeDot={{ fill: '#34d399', r: 5, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
