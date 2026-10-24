import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTabUsage } from '../../api/activity';
import { errorMessage } from '../../api/climate';
import { FOCUS_RING } from '../../components/ThermostatControls';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { HEARTBEAT_MS } from '../../hooks/useAppPresence';
import { ago } from '../../utils/cameras';
import { minutesLabel, tabLabel } from '../../utils/tabs';
import type { TabTotal } from '../../types';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/**
 * One row per tab: name, a bar for active minutes (scaled to the busiest tab in the
 * list), and the exact minutes and visits as text, so the numbers never depend on the bar.
 */
function TabBars({ tabs, limit }: { tabs: TabTotal[]; limit?: number }) {
  const shown = limit ? tabs.slice(0, limit) : tabs;
  const max = Math.max(1, ...shown.map((t) => t.activeMinutes));
  if (!shown.length) return <p className="text-xs text-apptext-muted">No activity in this range.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {shown.map((t) => (
        <li
          key={t.tab}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
          title={`${tabLabel(t.tab)}: ${minutesLabel(t.activeMinutes)} active, ${t.visits} visit${t.visits === 1 ? '' : 's'}`}
        >
          <span className="truncate font-medium text-apptext">{tabLabel(t.tab)}</span>
          <span className="h-2 rounded-full bg-appinset" aria-hidden="true">
            <span
              className="block h-2 rounded-full bg-appaccent"
              style={{ width: `${t.activeMinutes ? Math.max(2, (t.activeMinutes / max) * 100) : 0}%` }}
            />
          </span>
          <span className="whitespace-nowrap tabular-nums text-apptext-muted">
            <span className="font-semibold text-apptext">{minutesLabel(t.activeMinutes)}</span> · {t.visits} visit
            {t.visits === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-appborder bg-appsurface-raised p-4 shadow-[0_10px_28px_var(--appshadow)] sm:p-5">
      {children}
    </section>
  );
}

export default function TabUsage() {
  const [days, setDays] = useState<Range>(30);
  // Activity lands once a minute (the heartbeat), so refresh on the same beat while
  // the page is in view.
  const refreshInterval = useJitteredInterval(HEARTBEAT_MS);
  const query = useQuery({
    queryKey: ['admin-tab-usage', days],
    queryFn: () => fetchTabUsage(days),
    staleTime: 30_000,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-apptext-muted">
          Which tabs house members open and spend time on. A visit is each time a tab is opened; active time counts
          the minutes the app was open on that tab and in use. Guests aren't tracked.
        </p>
        <div role="tablist" aria-label="Date range" className="flex gap-1 rounded-xl bg-appinset p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={days === r}
              onClick={() => setDays(r)}
              className={`h-9 rounded-lg px-3 text-sm font-semibold transition-colors ${FOCUS_RING} ${
                days === r ? 'bg-appsurface-raised text-apptext shadow-sm' : 'text-apptext-muted hover:text-apptext'
              }`}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      {query.isLoading && <div className="h-40 animate-pulse rounded-[24px] bg-appinset" />}
      {query.isError && (
        <Card>
          <p className="text-sm text-apptext">Couldn't load usage: {errorMessage(query.error)}</p>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <h3 className="text-sm font-semibold text-apptext">Most used tabs · everyone</h3>
            <div className="mt-3">
              <TabBars tabs={data.household} />
            </div>
          </Card>

          {data.members.length === 0 ? (
            <Card>
              <p className="text-sm text-apptext-muted">No member activity in the last {data.days} days yet.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
              {data.members.map((m) => (
                <Card key={m.userId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-apptext">
                      {m.displayName || m.username}
                      <span className="ml-2 text-2xs font-medium text-apptext-muted">{m.role === 'ADMIN' ? 'Admin' : 'Member'}</span>
                    </h3>
                    {m.lastActiveAt && <span className="text-2xs text-apptext-muted">Last active {ago(m.lastActiveAt)}</span>}
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-apptext-muted">
                    {minutesLabel(m.activeMinutes)} active · {m.visits} visit{m.visits === 1 ? '' : 's'}
                  </p>
                  <div className="mt-3">
                    <TabBars tabs={m.tabs} limit={6} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
