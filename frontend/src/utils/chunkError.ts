// After a deploy the old hashed chunks are gone, so one failed import() would blank the app.
// Reload once to pick up the new index.html; the sessionStorage stamp stops a reload loop.

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_KEY = 'chunk_reload_at';
/** A second chunk failure inside this window is a real outage, not a stale deploy. */
const RELOAD_WINDOW_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR_RE.test(message);
}

/** Reloads at most once per window. Returns true if a reload was started. */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (last && Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // can't guard against a loop, so don't risk one
  }
  window.location.reload();
  return true;
}

export function installChunkErrorRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnceForChunkError();
  });
}
