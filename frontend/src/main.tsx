import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const HomeSummary = lazy(() => import('./pages/HomeSummary'));
const ElectricalUsage = lazy(() => import('./pages/ElectricalUsage'));
const GasUsage = lazy(() => import('./pages/GasUsage'));
const WaterUsage = lazy(() => import('./pages/WaterUsage'));
const Roomba = lazy(() => import('./pages/Roomba'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="min-h-screen bg-slate-950 text-slate-100">
              <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4">
                <div className="rounded-[28px] border border-white/10 bg-slate-900/88 px-6 py-5 text-sm text-slate-300 shadow-[0_10px_30px_rgba(2,8,23,0.26)]">
                  Loading dashboard...
                </div>
              </div>
            </div>
          }
        >
          <Routes>
            <Route element={<App />}>
              <Route index element={<HomeSummary />} />
              <Route path="electric" element={<ElectricalUsage />} />
              <Route path="gas" element={<GasUsage />} />
              <Route path="water" element={<WaterUsage />} />
              <Route path="roomba" element={<Roomba />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
