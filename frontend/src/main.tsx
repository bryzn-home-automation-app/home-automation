import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, AdminRoute, MemberRoute } from './components/Guard';
import App from './App';
import './index.css';

// ── Public pages (no auth required) ──
const GuestLogin = lazy(() => import('./pages/GuestLogin'));
const GuestHome = lazy(() => import('./pages/GuestHome'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

// ── Protected pages (auth required) ──
const HomeSummary = lazy(() => import('./pages/HomeSummary'));
const ElectricalUsage = lazy(() => import('./pages/ElectricalUsage'));
const GasUsage = lazy(() => import('./pages/GasUsage'));
const WaterUsage = lazy(() => import('./pages/WaterUsage'));
const Roomba = lazy(() => import('./pages/Roomba'));
const WiFiPage = lazy(() => import('./pages/WiFiPage'));

// ── Other protected pages ──
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MaintenanceDashboard = lazy(() => import('./pages/MaintenanceDashboard'));

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

function SuspenseFallback() {
  return (
    <div className="min-h-screen bg-appbg text-apptext">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4">
        <div className="rounded-[28px] border border-appborder bg-appsurface-raised px-6 py-5 text-sm text-apptext-soft shadow-[0_10px_30px_var(--appshadow)]">
          Loading...
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<SuspenseFallback />}>
              <Routes>
                {/* ── Public routes (no auth required) ── */}
                <Route path="/guest" element={<GuestLogin />} />
                <Route path="/guest/home" element={<GuestHome />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />

                {/* ── Protected: main app shell (any authenticated user) ── */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<App />}>
                    <Route index element={<HomeSummary />} />
                    <Route path="electric" element={<ElectricalUsage />} />
                    <Route path="gas" element={<GasUsage />} />
                    <Route path="water" element={<WaterUsage />} />
                    <Route path="roomba" element={<Roomba />} />
                    <Route path="wifi" element={<WiFiPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="users" element={<UserManagement />} />
                    <Route element={<MemberRoute />}>
                      <Route path="maintenance" element={<MaintenanceDashboard />} />
                    </Route>

                    {/* ── Admin-only routes ── */}
                    <Route element={<AdminRoute />}>
                      <Route path="admin/guests" element={<GuestManagement />} />
                      <Route path="admin/logs" element={<AuditLogs />} />
                      <Route path="admin/debug" element={<DebugDashboard />} />
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
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
