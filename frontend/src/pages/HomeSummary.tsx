import { useMemo } from 'react';
import { useUsageData } from '../hooks/useUsageData';
import StatTile, { Icons } from '../components/StatTile';
import IntegrationPanel from '../components/IntegrationPanel';
import { Link } from 'react-router-dom';
import { getUsageLevel } from '../utils/usageColor';
import VirtualizedList from '../components/VirtualizedList';

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
  const todayElec = useMemo(
    () =>
      electricUsage.data
        ?.filter((d) => d.timestamp.startsWith(today))
        .reduce((sum, d) => sum + d.usageKwh, 0) ?? 0,
    [electricUsage.data, today]
  );

  const recentElectric = useMemo(
    () =>
      [...(electricUsage.data ?? [])]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() -
            new Date(a.timestamp).getTime()
        )
        .slice(0, 12),
    [electricUsage.data]
  );

  const lastReading = recentElectric[0];
  const activeModules = useMemo(
    () => [
      {
        label: 'Electric Intelligence',
        detail: `${electricUsage.data?.length ?? 0} records available`,
        route: '/electric',
        accent: 'from-emerald-400/30 to-teal-400/10',
        pill: 'Live',
      },
      {
        label: 'Gas Monitoring',
        detail: `${gasUsage.data?.length ?? 0} records synced`,
        route: '/gas',
        accent: 'from-sky-400/30 to-cyan-400/10',
        pill: 'Tracking',
      },
      {
        label: 'Water Usage',
        detail: 'Module scaffolded for next integration',
        route: '/water',
        accent: 'from-cyan-300/25 to-blue-400/10',
        pill: 'Planned',
      },
      {
        label: 'Roomba Automation',
        detail: 'Reserved for device telemetry and routines',
        route: '/roomba',
        accent: 'from-amber-300/20 to-rose-400/10',
        pill: 'Planned',
      },
    ],
    [electricUsage.data?.length, gasUsage.data?.length]
  );

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="rounded-[30px] border border-white/10 bg-slate-900/84 p-6 shadow-[0_12px_34px_rgba(2,8,23,0.24)] sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
                Command Center
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Your home's utility story, summarized in one place.
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
                Keep an eye on live consumption, monthly cost exposure, sync reliability, and which home systems are ready for deeper automation next.
              </p>
            </div>

            <div className="grid min-w-[14rem] gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Latest Reading</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {lastReading
                    ? new Date(lastReading.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'No data'}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {lastReading ? `${Number(lastReading.usageKwh).toFixed(2)} kWh` : 'Run sync to ingest usage'}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Estimated Monthly Spend</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  ${estimatedBill.toFixed(2)}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Based on {kwhRate.toFixed(4)} per kWh across electric and gas totals.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-emerald-300/12 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(15,23,42,0.78))] p-6 shadow-[0_12px_34px_rgba(2,8,23,0.24)] sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-100/75">
            System Snapshot
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-4xl font-semibold tracking-[-0.05em] text-white">
                {totalKwh.toFixed(0)}
              </p>
              <p className="mt-1 text-sm text-emerald-50/85">Combined 60-day utility usage in kWh-equivalent</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/28 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-50/60">Today</p>
                <p className="mt-2 text-xl font-semibold text-white">{todayElec.toFixed(1)} kWh</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/28 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-50/60">Active Modules</p>
                <p className="mt-2 text-xl font-semibold text-white">2 live</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
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

      <section className="perf-section">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
              Modules
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
              Built for expansion beyond energy.
            </h3>
          </div>
          <p className="hidden text-sm text-slate-400 sm:block">
            Reusable cards now, shared design system later.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {activeModules.map((svc) => (
            <Link
              key={svc.label}
              to={svc.route}
              className="group rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)] transition-colors hover:border-white/20 hover:bg-slate-900/90"
            >
              <div className={`mb-4 h-24 rounded-2xl border border-white/10 bg-gradient-to-br ${svc.accent}`} />
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-base font-semibold text-white">{svc.label}</h4>
                <span className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                  {svc.pill}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {svc.detail}
              </p>
              <p className="mt-4 text-sm font-medium text-emerald-200 transition-colors group-hover:text-white">
                Open module →
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="perf-section grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                Activity Feed
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                Recent electric usage events
              </h3>
            </div>
            <Link
              to="/electric"
              className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              View full log
            </Link>
          </div>

          {electricUsage.isLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-2xl bg-white/8" />
              ))}
            </div>
          ) : recentElectric.length ? (
            <VirtualizedList
              items={recentElectric}
              height={448}
              itemHeight={76}
              overscan={5}
              className="pr-1"
              contentClassName="space-y-2"
              renderItem={(d) => {
                const usageLevel = getUsageLevel(Number(d.usageKwh));

                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-slate-950/30 px-4 py-3 transition-colors hover:border-white/15 hover:bg-slate-950/45"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          d.sourceProvider === 'coserv'
                            ? 'bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.7)]'
                            : 'bg-sky-400'
                        }`}
                      />
                      <div>
                        <p className="text-sm font-medium text-white">
                          {new Date(d.timestamp).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-xs text-slate-500">{d.sourceProvider}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${usageLevel.textClass}`}>
                        {Number(d.usageKwh).toFixed(2)} kWh
                      </p>
                      <p className="text-xs text-slate-500">
                        ${(Number(d.usageKwh) * kwhRate).toFixed(2)} est. cost
                      </p>
                    </div>
                  </div>
                );
              }}
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-950/20 text-sm text-slate-400">
              No usage data yet. Run <code className="mx-1 text-slate-200">npm run sync</code> to populate the dashboard.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <IntegrationPanel />

          <div className="rounded-[28px] border border-white/10 bg-slate-900/82 p-5 shadow-[0_10px_28px_rgba(2,8,23,0.24)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
              Next Up
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              Suggested expansion areas
            </h3>
            <div className="mt-4 space-y-3">
              {[
                'Billing history and forecast views',
                'Mortgage and maintenance intelligence',
                'Device telemetry for smart-home routines',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3 text-sm text-slate-300"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
