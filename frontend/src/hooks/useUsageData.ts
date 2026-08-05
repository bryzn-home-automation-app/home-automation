import { useQuery } from '@tanstack/react-query';
import { fetchRecentUsage, fetchTotalUsage } from '../api/energy';
import { fetchMeters } from '../api/meters';
import api from '../api/client';
import type { EnergyUsage, Meter } from '../types';

/** Shared hook — all pages use this, React Query cache deduplicates. */
export function useUsageData() {
  // Meters
  const meters = useQuery<Meter[]>({
    queryKey: ['meters'],
    queryFn: fetchMeters,
    staleTime: 300_000,
  });

  // App config
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get('/config').then((r) => r.data),
    staleTime: 300_000,
  });

  // Per-meter totals
  const electricMeter = meters.data?.find((m) => m.type === 'ELECTRIC');
  const gasMeter = meters.data?.find((m) => m.type === 'GAS');

  const electricUsage = useQuery<EnergyUsage[]>({
    queryKey: ['energy-usage', electricMeter?.id],
    queryFn: () =>
      electricMeter
        ? fetchRecentUsage(electricMeter.id, 60)
        : Promise.resolve([]),
    enabled: !!electricMeter,
    staleTime: 300_000,
  });

  const gasUsage = useQuery<EnergyUsage[]>({
    queryKey: ['energy-usage', gasMeter?.id],
    queryFn: () =>
      gasMeter ? fetchRecentUsage(gasMeter.id, 60) : Promise.resolve([]),
    enabled: !!gasMeter,
    staleTime: 300_000,
  });

  const electricTotal = useQuery({
    queryKey: ['total-usage', electricMeter?.id],
    queryFn: () =>
      electricMeter
        ? fetchTotalUsage(electricMeter.id, 60)
        : Promise.resolve({ totalKwh: 0 }),
    enabled: !!electricMeter,
    staleTime: 300_000,
  });

  const gasTotal = useQuery({
    queryKey: ['total-usage', gasMeter?.id],
    queryFn: () =>
      gasMeter
        ? fetchTotalUsage(gasMeter.id, 60)
        : Promise.resolve({ totalKwh: 0 }),
    enabled: !!gasMeter,
    staleTime: 300_000,
  });

  return {
    meters,
    config,
    electricMeter,
    gasMeter,
    electricUsage,
    gasUsage,
    electricTotal,
    gasTotal,
  };
}
