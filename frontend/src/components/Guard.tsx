import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Lamp } from './ui';

/**
 * The short wait while the session is checked. ProtectedRoute shows it before the
 * shell exists, so `page` paints a whole enamel page; the member and admin guards
 * show it inside the shell, as a single line in the content area.
 */
function Checking({ text, page = false }: { text: string; page?: boolean }) {
  const line = (
    <p role="status" className="fp-panel flex items-center gap-3 text-sm text-apptext-muted">
      <span className="fp-lamp fp-lamp--pulse" aria-hidden="true" />
      {text}
    </p>
  );
  if (!page) return line;
  return <div className="flex min-h-[100dvh] items-center justify-center bg-appbg px-4">{line}</div>;
}

/**
 * The server didn't answer the session check (a 502 mid-deploy, weak Wi-Fi, Tailscale still
 * connecting). The person is still signed in, so this is a whole page of its own (the shell needs
 * the user), not the sign-in page; AuthContext keeps retrying and the app opens when it answers
 * (B-014).
 */
function Unreachable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  // Drawn like the not-found page (enamel, one panel, one way on): the shell can't draw yet.
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-appbg px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div className="fp-panel fp-stack fp-stack--m w-full max-w-sm items-center text-center" role="alert">
        <p className="fp-label flex items-center gap-2"><Lamp tone="problem" /> Home server</p>
        <h1 className="text-title font-semibold text-apptext">Can't reach the home server</h1>
        <p className="fp-small fp-muted">You're still signed in. The app keeps trying and opens as soon as the server answers.</p>
        <Button variant="primary" icon="refresh" className="fp-mt-s" onClick={onRetry} busy={retrying} busyLabel="Trying again…">
          Try again
        </Button>
      </div>
    </main>
  );
}

/** Redirect to /login if not authenticated. */
export function ProtectedRoute() {
  const { user, token, isLoading, sessionCheck, retrySession, retryingSession } = useAuth();
  const location = useLocation();

  if (isLoading) return <Checking page text="Verifying session…" />;

  // Only a rejected token sends someone to sign in; an unanswered check waits here instead.
  if (token && !user && sessionCheck === 'unreachable') {
    return <Unreachable onRetry={retrySession} retrying={retryingSession} />;
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

/** Non-guest route guard. Redirects guests to home. */
export function MemberRoute() {
  const { isGuest, isLoading } = useAuth();

  if (isLoading) return <Checking text="Verifying access…" />;

  if (isGuest) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

/** Admin-only route guard. Redirects non-admins to home. */
export function AdminRoute() {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) return <Checking text="Verifying permissions…" />;

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
