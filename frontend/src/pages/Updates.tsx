import { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import ReleaseChangeList from '../components/ReleaseChangeList';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useTheme } from '../context/ThemeContext';
import { fetchReleases } from '../api/releases';

// ── Presentation helpers ──────────────────────────────────
//
// The app themes via CSS-variable tokens (no Tailwind `dark:` variant), so raw
// palette classes render the SAME in both themes. The "Latest" pill therefore
// carries an explicit light/dark pair so it doesn't wash out on the near-white
// light-mode card. (Change-item chips live in ReleaseChangeList.)
const LATEST_PILL = {
  dark: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-300',
  light: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700',
};

/** Format an ISO yyyy-mm-dd date as e.g. "August 22, 2026" (date-only, no TZ shift). */
function formatReleaseDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Page ──────────────────────────────────────────────────

export default memo(function Updates() {
  useDocumentTitle("What's New");
  const { isDark } = useTheme();

  const releasesQuery = useQuery({
    queryKey: ['releases'],
    queryFn: fetchReleases,
    staleTime: 600_000,
  });

  const releases = releasesQuery.data ?? [];
  const currentVersion = releases[0]?.version;

  return (
    <div className="space-y-6 sm:space-y-7">
      <PageHeader
        eyebrow="Release Notes"
        title="What's New"
        subtitle="A plain-language rundown of everything that's changed, most recent first."
        actions={
          currentVersion ? (
            <div className="rounded-xl border border-appborder bg-appinset px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-apptext-muted">Version</p>
              <p className="mt-1 text-sm font-semibold text-apptext">v{currentVersion}</p>
            </div>
          ) : undefined
        }
      />

      {releasesQuery.isLoading ? (
        <div className="animate-pulse space-y-6 sm:space-y-7">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-appborder bg-appsurface-raised p-6 sm:p-7 lg:rounded-[28px]"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="h-6 w-20 rounded-lg bg-appinset" />
                <div className="h-5 w-16 rounded-full bg-appinset" />
              </div>
              <div className="mt-4 h-5 w-2/3 rounded bg-appinset" />
              <div className="mt-3 space-y-2.5">
                <div className="h-12 rounded-xl bg-appinset" />
                <div className="h-12 rounded-xl bg-appinset" />
              </div>
            </div>
          ))}
        </div>
      ) : releasesQuery.isError ? (
        <div className="rounded-2xl border border-appdanger/30 bg-appdanger/10 p-6">
          <p className="text-sm text-appdanger">Couldn't load release notes. Please try again.</p>
          <button
            type="button"
            onClick={() => releasesQuery.refetch()}
            className="mt-3 inline-flex items-center rounded-full border border-appdanger/30 bg-appdanger/10 px-4 py-2 text-sm font-semibold text-appdanger transition-colors hover:bg-appdanger/20"
          >
            Retry
          </button>
        </div>
      ) : releases.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-appborder bg-appsurface-raised p-12 text-center">
          <span className="text-4xl" aria-hidden="true">✨</span>
          <p className="text-sm text-apptext-muted">No release notes yet. Check back after the next update.</p>
        </div>
      ) : (
        <ol className="space-y-6 sm:space-y-7">
          {releases.map((release, idx) => (
            <li
              key={release.version}
              className="rounded-2xl border border-appborder bg-appsurface-raised p-6 shadow-[0_10px_30px_var(--appshadow)] sm:p-7 lg:rounded-[28px]"
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <span className="inline-flex items-center rounded-lg border border-appaccent-border bg-appaccent-soft px-2.5 py-1 text-sm font-semibold tracking-[-0.01em] text-appaccent-text">
                  v{release.version}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-apptext-dim">
                  {release.stage}
                </span>
                {idx === 0 && (
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                      isDark ? LATEST_PILL.dark : LATEST_PILL.light
                    }`}
                  >
                    Latest
                  </span>
                )}
                <span className="w-full text-xs text-apptext-dim sm:ml-auto sm:w-auto">
                  {formatReleaseDate(release.releasedAt)}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-apptext sm:text-xl">
                {release.title}
              </h3>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-apptext-soft">{release.summary}</p>

              <div className="mt-4">
                <ReleaseChangeList changes={release.changes} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
