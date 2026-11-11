import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchReleases } from '../api/releases';
import ReleaseChangeList from './ReleaseChangeList';
import { useScrollLock } from '../hooks/useScrollLock';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useBackToClose } from '../hooks/useBackToClose';
import { Icon } from './ui/Icon';

const SEEN_KEY_PREFIX = 'homeos:seenReleaseVersion:';

/**
 * Shows the newest release notes as a one-time popup the next time a user logs
 * in after a new version ships. Dismissing it records the version (per user, in
 * localStorage), so it won't reappear until an even newer version lands. Mounted
 * once in the authenticated app shell; renders nothing until it has a reason to.
 *
 * A kit dialog (a sheet on a phone): focus moves into it and is trapped there,
 * Escape and the phone's back gesture close it, and focus goes back to wherever it
 * was when it opened (B-043: it used to leave focus on the page behind).
 */
export default function ReleaseNotesModal() {
  const { user } = useAuth();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // It opens on its own, so there is no trigger to return to: remember what had focus.
  const returnRef = useRef<HTMLElement | null>(null);
  const decidedRef = useRef(false);
  const [open, setOpen] = useState(false);

  const releasesQuery = useQuery({
    queryKey: ['releases'],
    queryFn: fetchReleases,
    staleTime: 600_000,
    enabled: !!user,
  });

  const latest = releasesQuery.data?.[0];
  const shown = open && !!latest;
  const seenKey = user ? `${SEEN_KEY_PREFIX}${user.userId}` : null;

  // Decide once per mount (i.e. once per login/app load): open only if the newest
  // version differs from the one this user last acknowledged.
  useEffect(() => {
    if (decidedRef.current || !latest || !seenKey) return;
    decidedRef.current = true;
    if (localStorage.getItem(seenKey) !== latest.version) {
      returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }
  }, [latest, seenKey]);

  const close = useCallback(() => {
    if (latest && seenKey) localStorage.setItem(seenKey, latest.version);
    setOpen(false);
  }, [latest, seenKey]);

  useScrollLock(shown);
  useFocusTrap(shown, panelRef, returnRef, close);
  useBackToClose(close, shown);

  if (!shown) return null;

  return (
    <div
      className="fp-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        className="fp-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
      >
        <header className="fp-dialog-head">
          <div className="fp-dialog-heading">
            <p className="fp-label">What's new · v{latest.version}</p>
            <h2 id="release-notes-title" className="fp-dialog-title">
              {latest.title}
            </h2>
            {latest.summary && <p className="fp-dialog-sub">{latest.summary}</p>}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="fp-icon-btn fp-icon-btn--quiet">
            <Icon name="x" />
          </button>
        </header>

        <div className="fp-dialog-body">
          <ReleaseChangeList changes={latest.changes} />
        </div>

        <div className="fp-dialog-foot fp-dialog-foot--split">
          {/* replace: the dialog's Back entry becomes /updates (see MoreSheet). */}
          <Link to="/updates" replace onClick={close} className="fp-btn fp-btn--quiet">
            See all updates
          </Link>
          <button type="button" onClick={close} className="fp-btn fp-btn--primary">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
