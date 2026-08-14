import { useMemo } from 'react';
import StatTile, { Icons } from '../components/StatTile';
import DeferredRender from '../components/DeferredRender';
import VirtualizedList from '../components/VirtualizedList';
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

/** Theme-aware chart colors */
function useChartColors() {
  // We read CSS variables at runtime; these are the recharts config values
  return {
    tooltipBg: 'var(--appchart-bg)',
    tooltipBorder: 'var(--appchart-border)',
    tooltipText: 'var(--apptext)',
    tooltipLabel: 'var(--apptext-muted)',
    gridStroke: 'var(--appchart-grid)',
    tickFill: 'var(--appchart-tick)',
    axisStroke: 'var(--appchart-grid)',
  };
}

export default function Roomba() {
  const runs = useMemo(() => generateMockRoombaData(), []);
  const chartColors = useChartColors();

  const totalRuns = runs.length;
  const totalMinutes = runs.reduce((s, r) => s + r.duration, 0);
  const avgMinutes = Math.round(totalMinutes / totalRuns);
  const completedRuns = runs.filter((r) => r.completed).length;

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="rounded-[28px] border border-appwarning-border bg-appwarning-soft p-4">
        <p className="text-xs text-appwarning">
          🤖 Mock data — Roomba/smart device integration coming in Phase 3
        </p>
      </div>

      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
          Device Automation Preview
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
          Visualize smart device routines with the same dashboard system.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-apptext-soft sm:text-base">
          The Roomba preview demonstrates how future device telemetry can live beside utility analytics without introducing a separate UX pattern.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
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

      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Cleaning Map Preview
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
              Dummy floor map and run path
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-apptext-muted">
              Placeholder map for future room-aware cleaning history, no-go zones, and per-room run analytics.
            </p>
          </div>
          <span className="rounded-full border border-appwarning-border bg-appwarning-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-appwarning">
            Mock Layout
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(240px,0.75fr)]">
          <div className="rounded-[24px] border border-appborder bg-appinset p-4">
            <svg
              viewBox="0 0 640 420"
              className="h-auto w-full rounded-[18px] border border-appborder-light bg-[linear-gradient(180deg,var(--appinset)_0%,var(--appsurface)_100%)]"
              role="img"
              aria-label="Dummy Roomba floor map"
            >
              <rect x="16" y="16" width="608" height="388" rx="22" fill="#0f1726" stroke="#334155" strokeWidth="2" />

              <rect x="42" y="42" width="210" height="150" rx="18" fill="#152235" stroke="#475569" />
              <text x="62" y="74" fill="#e2e8f0" fontSize="20" fontWeight="600">Living Room</text>

              <rect x="270" y="42" width="156" height="112" rx="18" fill="#16273a" stroke="#475569" />
              <text x="290" y="74" fill="#e2e8f0" fontSize="18" fontWeight="600">Kitchen</text>

              <rect x="444" y="42" width="154" height="176" rx="18" fill="#142233" stroke="#475569" />
              <text x="466" y="74" fill="#e2e8f0" fontSize="18" fontWeight="600">Bedroom</text>

              <rect x="42" y="210" width="180" height="160" rx="18" fill="#16273a" stroke="#475569" />
              <text x="62" y="242" fill="#e2e8f0" fontSize="18" fontWeight="600">Office</text>

              <rect x="240" y="172" width="166" height="198" rx="18" fill="#132031" stroke="#475569" />
              <text x="260" y="204" fill="#e2e8f0" fontSize="18" fontWeight="600">Hall</text>

              <rect x="424" y="238" width="174" height="132" rx="18" fill="#17283b" stroke="#475569" />
              <text x="446" y="270" fill="#e2e8f0" fontSize="18" fontWeight="600">Dining</text>

              <rect x="256" y="92" width="16" height="48" rx="8" fill="#94a3b8" opacity="0.5" />
              <rect x="404" y="106" width="16" height="48" rx="8" fill="#94a3b8" opacity="0.5" />
              <rect x="214" y="262" width="48" height="16" rx="8" fill="#94a3b8" opacity="0.5" />
              <rect x="406" y="284" width="48" height="16" rx="8" fill="#94a3b8" opacity="0.5" />

              <path
                d="M112 134 C164 148, 182 176, 214 216 S286 272, 326 262 S392 214, 438 184 S494 218, 532 254 S544 318, 520 336"
                fill="none"
                stroke="#22c55e"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="14 14"
                opacity="0.9"
              />

              <circle cx="112" cy="134" r="14" fill="#38bdf8" />
              <circle cx="520" cy="336" r="16" fill="#f59e0b" />
              <circle cx="520" cy="336" r="30" fill="#f59e0b" opacity="0.12" />

              <rect x="470" y="314" width="74" height="28" rx="14" fill="#0f172a" stroke="#f59e0b" strokeWidth="1.5" />
              <text x="486" y="333" fill="#f8fafc" fontSize="14" fontWeight="700">Roomba</text>
            </svg>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Current Zone</p>
              <p className="mt-2 text-lg font-semibold text-apptext">Dining Room</p>
              <p className="mt-1 text-sm text-apptext-muted">Coverage 82% on this mock run.</p>
            </div>

            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Dock Status</p>
              <p className="mt-2 text-lg font-semibold text-apptext">Living Room Base</p>
              <p className="mt-1 text-sm text-apptext-muted">Battery return route available.</p>
            </div>

            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Future Uses</p>
              <div className="mt-2 space-y-2 text-sm text-apptext-soft">
                <p>Room-level clean history</p>
                <p>No-go zones and schedules</p>
                <p>Battery and stuck-event overlays</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="perf-section grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredRender minHeight={360}>
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Trend</p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
              Cleaning Duration
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={runs}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.gridStroke} />
              <XAxis
                dataKey="date"
                tick={{ fill: chartColors.tickFill, fontSize: 11 }}
                axisLine={{ stroke: chartColors.axisStroke }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: chartColors.tickFill, fontSize: 11 }}
                axisLine={{ stroke: chartColors.axisStroke }}
                tickLine={false}
                unit="m"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: chartColors.tooltipBg,
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  borderRadius: '16px',
                  fontSize: '13px',
                  color: chartColors.tooltipText,
                  boxShadow: `0 20px 50px var(--appshadow-lg)`,
                }}
                formatter={(value: number) => [
                  `${value} min`,
                  'Duration',
                ]}
                labelStyle={{ color: chartColors.tooltipLabel, marginBottom: 4 }}
              />
              <Area
                type="monotone"
                dataKey="duration"
                isAnimationActive={false}
                stroke="#f59e0b"
                fill="#f59e0b24"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        </DeferredRender>

        <DeferredRender minHeight={360}>
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
          <div className="mb-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Signal</p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
              Dirt Events per Run
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={runs}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.gridStroke} />
              <XAxis
                dataKey="date"
                tick={{ fill: chartColors.tickFill, fontSize: 11 }}
                axisLine={{ stroke: chartColors.axisStroke }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: chartColors.tickFill, fontSize: 11 }}
                axisLine={{ stroke: chartColors.axisStroke }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: chartColors.tooltipBg,
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  borderRadius: '16px',
                  fontSize: '13px',
                  color: chartColors.tooltipText,
                  boxShadow: `0 20px 50px var(--appshadow-lg)`,
                }}
                formatter={(value: number) => [
                  `${value} events`,
                  'Dirt Events',
                ]}
                labelStyle={{ color: chartColors.tooltipLabel, marginBottom: 4 }}
              />
              <Area
                type="monotone"
                dataKey="dirtEvents"
                isAnimationActive={false}
                stroke="#38bdf8"
                fill="#38bdf824"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        </DeferredRender>
      </section>

      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <h3 className="mb-4 text-lg font-semibold text-apptext">
          Recent Runs
        </h3>
        <div className="overflow-x-auto">
          <div className="text-sm">
            <div className="grid grid-cols-[1.5fr_1fr_0.8fr] md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.95fr] border-b border-appborder pb-2 text-left text-apptext-dim">
              <div className="font-medium">Date</div>
              <div className="text-right font-medium">Duration</div>
              <div className="hidden text-right font-medium md:block">Dirt Events</div>
              <div className="hidden text-right font-medium md:block">Sq Ft</div>
              <div className="text-right font-medium">Status</div>
            </div>
            <VirtualizedList
              items={[...runs].reverse()}
              height={360}
              itemHeight={54}
              overscan={6}
              className="mt-1"
              renderItem={(r, index) => (
                <div
                  key={`${r.date}-${index}`}
                  className="grid grid-cols-[1.5fr_1fr_0.8fr] md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.95fr] items-center border-b border-appborder-light pr-1 transition-colors hover:bg-appinset"
                >
                  <div className="py-3 text-apptext-soft">{r.date}</div>
                  <div className="py-3 text-right tabular-nums text-apptext">
                    {r.duration} min
                  </div>
                  <div className="hidden py-3 text-right tabular-nums text-apptext md:block">
                    {r.dirtEvents}
                  </div>
                  <div className="hidden py-3 text-right text-apptext-muted md:block">{r.sqft}</div>
                  <div className="py-3 text-right">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        r.completed
                          ? 'border border-appaccent-border bg-appaccent-soft text-appaccent'
                          : 'border border-appdanger-border bg-appdanger-soft text-appdanger'
                      }`}
                    >
                      {r.completed ? 'Done' : 'Stuck'}
                    </span>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
