/*
 * Where to go after signing in (B-058). ProtectedRoute sends a signed-out person to /login with
 * `state.from` (the page or alert they tried to open); the password form reads it straight from
 * the router. Home SSO is a full-page round trip that drops router state, so the path is parked
 * in sessionStorage before leaving and picked up after the code is exchanged.
 */

const KEY = 'sso_return_to';

/**
 * A same-origin app path, or null. Only "/x…" (never "//host", a scheme, or a backslash trick),
 * and never the doors themselves, which would only bounce back to sign-in.
 */
export function safeReturnPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  const bare = path.split(/[?#]/)[0];
  if (bare === '/login' || bare === '/register' || bare === '/forgot-password' || bare.startsWith('/guest')) return null;
  return path;
}

/** The path from ProtectedRoute's `state.from` (a router location), or null. */
export function returnPathFromState(state: unknown): string | null {
  const from = (state as { from?: { pathname?: unknown; search?: unknown; hash?: unknown } } | null)?.from;
  if (!from || typeof from.pathname !== 'string') return null;
  const search = typeof from.search === 'string' ? from.search : '';
  const hash = typeof from.hash === 'string' ? from.hash : '';
  return safeReturnPath(from.pathname + search + hash);
}

/** Before leaving for home SSO: remember where to come back to (or forget a stale one). */
export function rememberReturnPath(path: string | null): void {
  try {
    if (path) sessionStorage.setItem(KEY, path);
    else sessionStorage.removeItem(KEY);
  } catch { /* storage off: land on Home */ }
}

/** After home SSO: the remembered path (checked again), removed so it is used once. */
export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeReturnPath(path);
  } catch {
    return null;
  }
}
