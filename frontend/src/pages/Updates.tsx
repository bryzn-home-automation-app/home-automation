import { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReleaseChangeList from '../components/ReleaseChangeList';
import { fetchReleases, type Release } from '../api/releases';
import {
  Badge,
  Disclosure,
  EmptyState,
  InstrumentPanel,
  Num,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Screen,
  SkelInstrumentPanel,
  SkelPanel,
  Stack,
  Verdict,
} from '../components/ui';
import { formatDate, formatDayName, formatMonthYear, plural } from '../utils/format';

/** Older releases listed before "Show N more" (the rest stay one tap away). */
const OLDER_SHOWN = 6;

/** "came out today" / "came out yesterday" / "came out on Fri, Nov 6". */
function cameOut(day: string): string {
  const name = formatDayName(day);
  return name === 'Today' || name === 'Yesterday' ? `came out ${name.toLowerCase()}` : `came out on ${formatDate(day)}`;
}

/** "2 fixes", "3 new, 1 fix": a release's changes counted by kind. */
export function changeSummary(r: Pick<Release, 'changes'>): string {
  const n = (t: string) => r.changes.filter((c) => c.type === t).length;
  const parts = [
    n('new') ? `${n('new')} new` : null,
    n('improved') ? `${n('improved')} improved` : null,
    n('fixed') ? plural(n('fixed'), 'fix', 'fixes') : null,
  ].filter(Boolean);
  return parts.join(', ') || 'No changes listed';
}

/** The version as a stamped plate: the number, the stage and the day it came out. */
function VersionPlate({ release }: { release: Release }) {
  return (
    <figure className="m-0 flex w-full max-w-[330px] flex-col items-center gap-3.5 rounded-well border border-appborder-strong bg-appsurface px-6 pb-4 pt-5">
      <p className="fp-label">HomeOS version</p>
      <Num size="xl" value={release.version} />
      <dl className="grid w-full grid-cols-2 border-t border-appborder">
        <div className="flex flex-col items-center gap-1 px-1 pt-3">
          <dt className="fp-label">Stage</dt>
          <dd className="fp-mono capitalize text-apptext">{release.stage}</dd>
        </div>
        <div className="flex flex-col items-center gap-1 border-l border-appborder px-1 pt-3">
          <dt className="fp-label">Out</dt>
          <dd className="fp-mono whitespace-nowrap text-apptext">{formatDate(release.releasedAt)}</dd>
        </div>
      </dl>
    </figure>
  );
}

export default memo(function Updates() {
  const releasesQuery = useQuery({
    queryKey: ['releases'],
    queryFn: fetchReleases,
    staleTime: 600_000,
  });

  return (
    <Screen>
      <QueryState
        query={releasesQuery}
        what="release notes"
        loadingLabel="Loading release notes"
        loading={
          <Stack gap="page">
            <SkelInstrumentPanel readouts={3} />
            <SkelPanel rows={3} />
          </Stack>
        }
        empty={
          <EmptyState icon="sparkles" title="No release notes yet">
            Check back after the next update.
          </EmptyState>
        }
      >
        {(releases) => {
          const [latest, ...older] = releases;
          const month = formatMonthYear(latest.releasedAt);
          const thisMonth = releases.filter((r) => formatMonthYear(r.releasedAt) === month);
          const first = releases[releases.length - 1];
          const shown = older.slice(0, OLDER_SHOWN);
          const more = older.slice(OLDER_SHOWN);
          return (
            <>
              <InstrumentPanel
                instrument={<VersionPlate release={latest} />}
                verdict={
                  <Verdict tone="info" note={`${latest.summary} Version ${latest.version} ${cameOut(latest.releasedAt)}.`}>
                    {latest.title}
                  </Verdict>
                }
                readouts={
                  <Readouts count={3}>
                    <Readout
                      label="This update"
                      value={latest.changes.length}
                      unit={latest.changes.length === 1 ? 'change' : 'changes'}
                      note={changeSummary(latest)}
                    />
                    <Readout
                      label={month}
                      value={thisMonth.length}
                      unit={thisMonth.length === 1 ? 'update' : 'updates'}
                      note={`${plural(thisMonth.reduce((n, r) => n + r.changes.length, 0), 'change')} in all`}
                    />
                    <Readout
                      label="In all"
                      value={releases.length}
                      unit={releases.length === 1 ? 'update' : 'updates'}
                      note={`The first came ${formatDate(first.releasedAt)}`}
                    />
                  </Readouts>
                }
              />

              <Panel
                title="What changed"
                subtitle={`Version ${latest.version} · ${formatDate(latest.releasedAt)}`}
                action={<Badge ink plain icon="sparkles">Latest</Badge>}
              >
                <ReleaseChangeList changes={latest.changes} />
              </Panel>

              {older.length > 0 && (
                <Panel title="Every update" subtitle="Newest first. Open one to see what changed">
                  <ReleaseIndex releases={shown} />
                  {more.length > 0 && (
                    <Disclosure variant="row" summary={`Show ${plural(more.length, 'older update')}`} openSummary="Hide older updates">
                      <ReleaseIndex releases={more} />
                    </Disclosure>
                  )}
                </Panel>
              )}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
});

/** Older releases, each collapsed to its title until opened. */
function ReleaseIndex({ releases }: { releases: Release[] }) {
  return (
    <ul className="fp-list">
      {releases.map((r) => (
        // Custom rows in the panel's edge-to-edge list take the panel's inset themselves.
        <li key={r.version} className="px-[var(--apppanel-pad)] py-1">
          <Disclosure
            className="[&>summary]:flex [&>summary]:w-full [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3"
            summary={
              <span className="flex min-w-0 flex-col py-1 text-left">
                <span className="font-medium text-apptext">{r.title}</span>
                <span className="fp-small fp-muted">
                  <span className="fp-mono">v{r.version}</span> · {formatDate(r.releasedAt)}
                  {r.stage === 'beta' ? ' · beta' : ''} · {changeSummary(r)}
                </span>
              </span>
            }
          >
            <Stack gap="m" className="pb-3 pt-2">
              {r.summary && <p className="fp-prose text-apptext-soft">{r.summary}</p>}
              <ReleaseChangeList changes={r.changes} />
            </Stack>
          </Disclosure>
        </li>
      ))}
    </ul>
  );
}
