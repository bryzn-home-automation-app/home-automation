import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Redirect to /login if not authenticated. */
export function ProtectedRoute() {
  const { user, token, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised px-6 py-5 text-sm text-apptext-soft shadow-[0_10px_30px_var(--appshadow)]">
          Verifying session...
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

/** Non-guest route guard. Redirects guests to home. */
export function MemberRoute() {
  const { isGuest, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised px-6 py-5 text-sm text-apptext-soft shadow-[0_10px_30px_var(--appshadow)]">
          Verifying access...
        </div>
      </div>
    );
  }

  if (isGuest) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

/** Admin-only route guard. Redirects non-admins to home. */
export function AdminRoute() {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised px-6 py-5 text-sm text-apptext-soft shadow-[0_10px_30px_var(--appshadow)]">
          Verifying permissions...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
