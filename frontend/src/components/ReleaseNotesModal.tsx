import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchReleases } from '../api/releases';
import ReleaseChangeList from './ReleaseChangeList';

const SEEN_KEY_PREFIX = 'homeos:seenReleaseVersion:';

/**
 * Shows the newest release notes as a one-time popup the next time a user logs
 * in after a new version ships. Dismissing it records the version (per user, in
 * localStorage), so it won't reappear until an even newer version lands. Mounted
 * once in the authenticated app shell; renders nothing until it has a reason to.
 */
export default function ReleaseNotesModal() {
  const { user } = useAuth();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const decidedRef = useRef(false);
  const [open, setOpen] = useState(false);

  const releasesQuery = useQuery({
    queryKey: ['releases'],
    queryFn: fetchReleases,
    staleTime: 600_000,
    enabled: !!user,
  });

  const latest = releasesQuery.data?.[0];
  const seenKey = user ? `${SEEN_KEY_PREFIX}${user.userId}` : null;

  // Decide once per mount (i.e. once per login/app load): open only if the newest
  // version differs from the one this user last acknowledged.
  useEffect(() => {
    if (decidedRef.current || !latest || !seenKey) return;
    decidedRef.current = true;
    if (localStorage.getItem(seenKey) !== latest.version) setOpen(true);
  }, [latest, seenKey]);

  const close = useCallback(() => {
    if (latest && seenKey) localStorage.setItem(seenKey, latest.version);
    setOpen(false);
  }, [latest, seenKey]);

  // Escape-to-close, matching the app's other modals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open || !latest) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="What's New"
      onClick={close}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-appborder bg-appsurface-raised shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-appborder p-6 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-appaccent-text">
              What's New · v{latest.version}
            </p>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-apptext">{latest.title}</h3>
            {latest.summary && (
              <p className="mt-1.5 text-sm leading-6 text-apptext-soft">{latest.summary}</p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-apptext-muted transition-colors hover:bg-appinset hover:text-apptext"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-6 pt-4">
          <ReleaseChangeList changes={latest.changes} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-appborder p-6 pt-4">
          <Link
            to="/updates"
            onClick={close}
            className="text-sm font-medium text-appaccent-text transition-colors hover:text-appaccent"
          >
            See all updates
          </Link>
          <button
            type="button"
            onClick={close}
            className="rounded-xl border border-appaccent-border bg-appaccent-soft px-4 py-2 text-sm font-semibold text-appaccent-text transition-colors hover:bg-appaccent-soft/70"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
