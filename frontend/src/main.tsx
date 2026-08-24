import React, { Suspense, lazy, type ComponentType } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, AdminRoute, MemberRoute } from './components/Guard';
import PageSkeleton, { type PageSkeletonVariant } from './components/PageSkeleton';
import App from './App';
import './index.css';

// ── Public pages (no auth required) ──
const GuestLogin = lazy(() => import('./pages/GuestLogin'));
const GuestHome = lazy(() => import('./pages/GuestHome'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

// ── Protected pages (auth required) ──
const HomeSummary = lazy(() => import('./pages/HomeSummary'));
const Utility = lazy(() => import('./pages/Utility'));
const Roomba = lazy(() => import('./pages/Roomba'));
const WiFiPage = lazy(() => import('./pages/WiFiPage'));

// ── Other protected pages ──
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MaintenanceDashboard = lazy(() => import('./pages/MaintenanceDashboard'));
const Updates = lazy(() => import('./pages/Updates'));

// ── Admin pages ──
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const GuestManagement = lazy(() => import('./pages/admin/GuestManagement'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
const DebugDashboard = lazy(() => import('./pages/admin/DebugDashboard'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Lazily-loaded route wrapper. Renders a shape-matched `PageSkeleton` until
 * the chunk resolves, then swaps in the real page component. This replaces
 * the previous single `SuspenseFallback` so each route flashes a layout that
 * matches the destination page (stats-charts / list / form / hero / default)
 * instead of a generic "Loading..." card.
 */
function lazyRoute<P extends object>(
  Component: ComponentType<P>,
  variant: PageSkeletonVariant
) {
  return function LazyRoute(props: P) {
    return (
      <Suspense fallback={<PageSkeleton variant={variant} />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

const GuestLoginRoute = lazyRoute(GuestLogin, 'form');
const GuestHomeRoute = lazyRoute(GuestHome, 'hero');
const LoginRoute = lazyRoute(Login, 'form');
const RegisterRoute = lazyRoute(Register, 'form');
const HomeSummaryRoute = lazyRoute(HomeSummary, 'stats-charts');
const UtilityRoute = lazyRoute(Utility, 'stats-charts');
const RoombaRoute = lazyRoute(Roomba, 'stats-charts');
const WiFiPageRoute = lazyRoute(WiFiPage, 'list');
const NotificationsRoute = lazyRoute(NotificationsPage, 'list');
const ProfilePageRoute = lazyRoute(ProfilePage, 'form');
const MaintenanceDashboardRoute = lazyRoute(MaintenanceDashboard, 'list');
const UpdatesRoute = lazyRoute(Updates, 'list');
const UserManagementRoute = lazyRoute(UserManagement, 'list');
const GuestManagementRoute = lazyRoute(GuestManagement, 'list');
const AuditLogsRoute = lazyRoute(AuditLogs, 'list');
const DebugDashboardRoute = lazyRoute(DebugDashboard, 'default');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* ── Public routes (no auth required) ── */}
              <Route path="/guest" element={<GuestLoginRoute />} />
              <Route path="/guest/home" element={<GuestHomeRoute />} />
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/register" element={<RegisterRoute />} />

              {/* ── Protected: main app shell (any authenticated user) ── */}
              <Route element={<ProtectedRoute />}>
                <Route element={<App />}>
                  <Route index element={<HomeSummaryRoute />} />
                  <Route path="utility" element={<UtilityRoute />} />
                  {/* Old split tabs now live under one Utility tab. */}
                  <Route path="electric" element={<Navigate to="/utility" replace />} />
                  <Route path="gas" element={<Navigate to="/utility?view=gas" replace />} />
                  <Route path="water" element={<Navigate to="/utility?view=water" replace />} />
                  <Route path="roomba" element={<RoombaRoute />} />
                  <Route path="wifi" element={<WiFiPageRoute />} />
                  <Route path="notifications" element={<NotificationsRoute />} />
                  <Route path="updates" element={<UpdatesRoute />} />
                  <Route path="profile" element={<ProfilePageRoute />} />
                  <Route path="users" element={<UserManagementRoute />} />
                  <Route element={<MemberRoute />}>
                    <Route path="maintenance" element={<MaintenanceDashboardRoute />} />
                  </Route>

                  {/* ── Admin-only routes ── */}
                  <Route element={<AdminRoute />}>
                    <Route path="admin/guests" element={<GuestManagementRoute />} />
                    <Route path="admin/logs" element={<AuditLogsRoute />} />
                    <Route path="admin/debug" element={<DebugDashboardRoute />} />
                  </Route>
                </Route>
              </Route>

              {/* ── Catch-all redirect ── */}
              <Route path="*" element={
                <div className="flex min-h-screen items-center justify-center bg-appbg">
                  <div className="text-center">
                    <p className="text-4xl mb-4">🏠</p>
                    <h1 className="text-2xl font-semibold text-apptext">Page Not Found</h1>
                    <p className="mt-2 text-apptext-muted">
                      <a href="/" className="text-appaccent-text hover:text-appaccent">Return home</a>
                    </p>
                  </div>
                </div>
              } />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
