// Reload stale app copies. A Home Screen app on iPhone is resumed from memory, not
// reloaded, so after a deploy it can keep running old code for days (that's how a
// fixed player kept showing black tiles). On coming back to the foreground — and
// every few minutes while open — compare the entry script the server's index.html
// points at with the one this page is running; if they differ, reload.

const CHECK_EVERY_MS = 5 * 60_000;
/** Don't re-check on every quick app switch. */
const MIN_GAP_MS = 30_000;

/** The hashed entry bundle (e.g. /assets/index-AbC123.js) referenced by an index.html. */
export function entryScript(html: string): string | null {
  const m = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/);
  return m ? m[1] : null;
}

function runningEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el ? new URL(el.src, location.href).pathname : null;
}

let lastCheck = 0;

async function checkForUpdate(): Promise<void> {
  const now = Date.now();
  if (now - lastCheck < MIN_GAP_MS) return;
  lastCheck = now;
  const running = runningEntry();
  if (!running) return; // dev server (no hashed bundle)
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!res.ok) return;
    const latest = entryScript(await res.text());
    if (latest && new URL(latest, location.href).pathname !== running) location.reload();
  } catch {
    /* offline — try again next time */
  }
}

export function watchForAppUpdates(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) void checkForUpdate(); // restored from the back/forward cache
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  }, CHECK_EVERY_MS);
}
