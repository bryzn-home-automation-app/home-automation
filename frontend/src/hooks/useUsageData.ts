import { useQuery } from '@tanstack/react-query';
import { fetchDailyUsage, fetchRecentUsage, fetchTotalUsage } from '../api/energy';
import { fetchMeters } from '../api/meters';
import api from '../api/client';
import { useJitteredInterval } from './useJitteredInterval';
import type { DailyUsagePoint, EnergyUsage, Meter } from '../types';

/**
 * Shared hook — all pages use this, React Query cache deduplicates.
 *
 * `hourly` (default true) controls whether the two heavy raw-hourly usage
 * queries (`fetchRecentUsage`, ~1,440 rows/meter) run. Pages that only need the
 * pre-aggregated daily/total data (e.g. HomeSummary) pass `hourly: false` so the
 * landing screen doesn't transfer + parse thousands of rows it never displays.
 */
export function useUsageData(options?: { hourly?: boolean }) {
  const includeHourly = options?.hourly ?? true;

  // CoServ only posts new rows ~every 30 min (see backend schedulers), so a
  // 10-min poll is already well ahead of the data. Each interval is memoized
  // (distinct staggered values) so the RQ poll timer isn't reset every render.
  const usageInterval = useJitteredInterval(600_000);
  const totalInterval = useJitteredInterval(600_000);
  const dailyInterval = useJitteredInterval(600_000);

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
    enabled: !!electricMeter && includeHourly,
    staleTime: 120_000,
    refetchInterval: usageInterval,
    refetchIntervalInBackground: false,
  });

  const gasUsage = useQuery<EnergyUsage[]>({
    queryKey: ['energy-usage', gasMeter?.id],
    queryFn: () =>
      gasMeter ? fetchRecentUsage(gasMeter.id, 60) : Promise.resolve([]),
    enabled: !!gasMeter && includeHourly,
    staleTime: 120_000,
    refetchInterval: usageInterval,
    refetchIntervalInBackground: false,
  });

  const electricTotal = useQuery({
    queryKey: ['total-usage', electricMeter?.id],
    queryFn: () =>
      electricMeter
        ? fetchTotalUsage(electricMeter.id, 60)
        : Promise.resolve({ totalKwh: 0 }),
    enabled: !!electricMeter,
    staleTime: 120_000,
    refetchInterval: totalInterval,
    refetchIntervalInBackground: false,
  });

  // Pre-aggregated daily data — ~60 rows instead of 1,440 hourly records
  const electricDaily = useQuery<DailyUsagePoint[]>({
    queryKey: ['energy-daily', electricMeter?.id],
    queryFn: () =>
      electricMeter
        ? fetchDailyUsage(electricMeter.id, 60)
        : Promise.resolve([]),
    enabled: !!electricMeter,
    staleTime: 120_000,
    refetchInterval: dailyInterval,
    refetchIntervalInBackground: false,
  });

  const gasTotal = useQuery({
    queryKey: ['total-usage', gasMeter?.id],
    queryFn: () =>
      gasMeter
        ? fetchTotalUsage(gasMeter.id, 60)
        : Promise.resolve({ totalKwh: 0 }),
    enabled: !!gasMeter,
    staleTime: 120_000,
    refetchInterval: totalInterval,
    refetchIntervalInBackground: false,
  });

  return {
    meters,
    config,
    electricMeter,
    gasMeter,
    electricUsage,
    gasUsage,
    electricDaily,
    electricTotal,
    gasTotal,
  };
}
