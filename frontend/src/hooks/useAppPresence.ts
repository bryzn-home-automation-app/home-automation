import { useEffect, useRef } from 'react';
import { primeCameras, recordTab } from '../api/activity';
import { tabKey } from '../utils/tabs';
import { usePageVisible } from './useViewerPresence';

/** How often an active page reports in: one active minute, and another camera warm-up. */
export const HEARTBEAT_MS = 60_000;

/**
 * For house members only (guests send nothing):
 * - each tab they open is recorded as a visit;
 * - while the page is visible and in use, it reports every minute. That counts one
 *   active minute on the current tab and keeps the cameras' live streams running, so
 *   the Cameras tab opens already live rather than waiting for a battery camera to wake.
 *
 * The first warm-up goes out as soon as the page becomes active (sign-in, waking, or
 * coming back to the app). The server lets the streams go ~90 s after the last one, so
 * an app that's hidden or asleep (useAppSleep) frees the cameras within two minutes.
 */
export function useAppPresence(pathname: string, member: boolean, asleep = false) {
  const visible = usePageVisible();
  const tab = tabKey(pathname);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const active = member && visible && !asleep;

  useEffect(() => {
    if (member && tab) void recordTab(tab, 'view');
  }, [member, tab]);

  useEffect(() => {
    if (!active) return;
    void primeCameras();
    const timer = window.setInterval(() => {
      if (tabRef.current) void recordTab(tabRef.current, 'active');
      void primeCameras();
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [active]);
}
