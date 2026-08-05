import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import HomeSummary from './pages/HomeSummary';
import ElectricalUsage from './pages/ElectricalUsage';
import GasUsage from './pages/GasUsage';
import WaterUsage from './pages/WaterUsage';
import Roomba from './pages/Roomba';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<HomeSummary />} />
            <Route path="electric" element={<ElectricalUsage />} />
            <Route path="gas" element={<GasUsage />} />
            <Route path="water" element={<WaterUsage />} />
            <Route path="roomba" element={<Roomba />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
