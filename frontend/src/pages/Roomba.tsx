import { useMemo } from 'react';
import StatTile, { Icons } from '../components/StatTile';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface RoombaRun {
  date: string;
  duration: number; // minutes
  dirtEvents: number;
  sqft: number;
  completed: boolean;
}

function generateMockRoombaData(): RoombaRun[] {
  const runs: RoombaRun[] = [];
  const now = new Date();

  for (let i = 30; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    // Roomba runs ~5 days a week
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 2 || dayOfWeek === 5) continue; // skip Tue/Fri

    const duration = 45 + Math.floor(Math.random() * 40); // 45-85 min
    runs.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      duration,
      dirtEvents: Math.floor(Math.random() * 12),
      sqft: 1800,
      completed: Math.random() > 0.1,
    });
  }

  return runs;
}

export default function Roomba() {
  const runs = useMemo(() => generateMockRoombaData(), []);

  const totalRuns = runs.length;
  const totalMinutes = runs.reduce((s, r) => s + r.duration, 0);
  const avgMinutes = Math.round(totalMinutes / totalRuns);
  const completedRuns = runs.filter((r) => r.completed).length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-4 mb-2">
        <p className="text-xs text-violet-400/80">
          🤖 Mock data — Roomba/smart device integration coming in Phase 3
        </p>
      </div>

      {/* Stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Runs (30d)"
          value={String(totalRuns)}
          unit=""
          loading={false}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Total Time"
          value={String(totalMinutes)}
          unit="min"
          loading={false}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Avg Duration"
          value={String(avgMinutes)}
          unit="min"
          loading={false}
          icon={Icons.Bolt}
        />
        <StatTile
          label="Completed"
          value={`${completedRuns}/${totalRuns}`}
          unit=""
          loading={false}
          icon={Icons.Dollar}
        />
      </section>

      {/* Duration chart */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">
            Cleaning Duration
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={runs}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
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
                unit="m"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #1f2937',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#f3f4f6',
                }}
                formatter={(value: number) => [
                  `${value} min`,
                  'Duration',
                ]}
              />
              <Area
                type="monotone"
                dataKey="duration"
                stroke="#8b5cf6"
                fill="#8b5cf620"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Dirt events chart */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">
            Dirt Events per Run
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={runs}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
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
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #1f2937',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#f3f4f6',
                }}
                formatter={(value: number) => [
                  `${value} events`,
                  'Dirt Events',
                ]}
              />
              <Area
                type="monotone"
                dataKey="dirtEvents"
                stroke="#f59e0b"
                fill="#f59e0b20"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Run log */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">
          Recent Runs
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium text-right">Duration</th>
                <th className="pb-2 font-medium text-right">Dirt Events</th>
                <th className="pb-2 font-medium text-right">Sq Ft</th>
                <th className="pb-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(-10).reverse().map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="py-2 text-gray-300">{r.date}</td>
                  <td className="py-2 text-right text-white tabular-nums">
                    {r.duration} min
                  </td>
                  <td className="py-2 text-right text-white tabular-nums">
                    {r.dirtEvents}
                  </td>
                  <td className="py-2 text-right text-gray-400">{r.sqft}</td>
                  <td className="py-2 text-right">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        r.completed
                          ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/50'
                          : 'bg-red-950/50 text-red-400 border border-red-800/50'
                      }`}
                    >
                      {r.completed ? 'Done' : 'Stuck'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
