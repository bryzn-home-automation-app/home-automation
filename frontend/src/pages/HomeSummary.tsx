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
        <div className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
                Command Center
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
                Your home's utility story, summarized in one place.
              </h2>
              <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
                Keep an eye on live consumption, monthly cost exposure, sync reliability, and which home systems are ready for deeper automation next.
              </p>
            </div>

            <div className="grid min-w-[14rem] gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Latest Reading</p>
                <p className="mt-2 text-lg font-semibold text-apptext">
                  {lastReading
                    ? new Date(lastReading.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'No data'}
                </p>
                <p className="mt-1 text-sm text-apptext-muted">
                  {lastReading ? `${Number(lastReading.usageKwh).toFixed(2)} kWh` : 'Run sync to ingest usage'}
                </p>
              </div>

              <div className="rounded-2xl border border-appborder bg-appinset p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Estimated Monthly Spend</p>
                <p className="mt-2 text-lg font-semibold text-apptext">
                  ${estimatedBill.toFixed(2)}
                </p>
                <p className="mt-1 text-sm text-apptext-muted">
                  Based on {kwhRate.toFixed(4)} per kWh across electric and gas totals.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-appaccent-border/30 bg-[linear-gradient(180deg,var(--appaccent-soft),var(--appinset))] p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-appaccent-text/75">
            System Snapshot
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-4xl font-semibold tracking-[-0.05em] text-apptext">
                {totalKwh.toFixed(0)}
              </p>
              <p className="mt-1 text-sm text-appaccent-text/85">Combined 60-day utility usage in kWh-equivalent</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-appborder bg-appinset/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-appaccent-text/60">Today</p>
                <p className="mt-2 text-xl font-semibold text-apptext">{todayElec.toFixed(1)} kWh</p>
              </div>
              <div className="rounded-2xl border border-appborder bg-appinset/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-appaccent-text/60">Active Modules</p>
                <p className="mt-2 text-xl font-semibold text-apptext">2 live</p>
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
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Modules
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-apptext">
              Built for expansion beyond energy.
            </h3>
          </div>
          <p className="hidden text-sm text-apptext-muted sm:block">
            Reusable cards now, shared design system later.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {activeModules.map((svc) => (
            <Link
              key={svc.label}
              to={svc.route}
              className="group rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] transition-colors hover:border-appborder-hover hover:bg-appinset-strong"
            >
              <div className={`mb-4 h-24 rounded-2xl border border-appborder bg-gradient-to-br ${svc.accent}`} />
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-base font-semibold text-apptext">{svc.label}</h4>
                <span className="rounded-full border border-appborder bg-appinset px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-apptext-soft">
                  {svc.pill}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-apptext-soft">
                {svc.detail}
              </p>
              <p className="mt-4 text-sm font-medium text-appaccent-text transition-colors group-hover:text-appaccent">
                Open module →
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="perf-section grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
                Activity Feed
              </p>
              <h3 className="mt-2 text-lg font-semibold text-apptext">
                Recent electric usage events
              </h3>
            </div>
            <Link
              to="/electric"
              className="text-sm font-medium text-apptext-soft transition-colors hover:text-apptext"
            >
              View full log
            </Link>
          </div>

          {electricUsage.isLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-2xl bg-appinset" />
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
                    className="flex items-center justify-between gap-4 rounded-2xl border border-appborder-light bg-appinset px-4 py-3 transition-colors hover:border-appborder hover:bg-appinset-strong"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          d.sourceProvider === 'coserv'
                            ? 'bg-appsuccess shadow-[0_0_16px_var(--appsuccess)]'
                            : 'bg-sky-400'
                        }`}
                      />
                      <div>
                        <p className="text-sm font-medium text-apptext">
                          {new Date(d.timestamp).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-xs text-apptext-dim">{d.sourceProvider}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${usageLevel.textClass}`}>
                        {Number(d.usageKwh).toFixed(2)} kWh
                      </p>
                      <p className="text-xs text-apptext-dim">
                        ${(Number(d.usageKwh) * kwhRate).toFixed(2)} est. cost
                      </p>
                    </div>
                  </div>
                );
              }}
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-appborder bg-appinset text-sm text-apptext-muted">
              No usage data yet. Run <code className="mx-1 text-apptext-soft">npm run sync</code> to populate the dashboard.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <IntegrationPanel />

          <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Next Up
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
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
                  className="rounded-2xl border border-appborder bg-appinset px-4 py-3 text-sm text-apptext-soft"
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
