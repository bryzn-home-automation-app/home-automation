import api from './client';
import type {
  EnergyUsage,
  IntegrationAdapter,
  IntegrationResult,
  UsageRangeSummary,
} from '../types';

/** Fetch recent usage for a meter. Defaults to last 30 days. */
export async function fetchRecentUsage(meterId: number, days = 30): Promise<EnergyUsage[]> {
  const { data } = await api.get(`/energy-usage/meter/${meterId}/recent`, {
    params: { days },
  });
  return data;
}

/** Fetch total kWh for a meter over a given number of days. */
export async function fetchTotalUsage(
  meterId: number,
  days = 30
): Promise<{ meterId: number; days: number; totalKwh: number }> {
  const { data } = await api.get(`/energy-usage/meter/${meterId}/total`, {
    params: { days },
  });
  return data;
}

export async function fetchUsageSummary(
  meterId: number,
  start: string,
  end: string
): Promise<UsageRangeSummary> {
  const { data } = await api.get(`/energy-usage/meter/${meterId}/summary`, {
    params: { start, end },
  });
  return data;
}

/** List all registered integration adapters. */
export async function fetchIntegrations(): Promise<IntegrationAdapter[]> {
  const { data } = await api.get('/integrations');
  return data;
}

/** Get the last sync result for a provider. */
export async function fetchIntegrationStatus(
  providerKey: string
): Promise<IntegrationResult | { providerKey: string; status: string }> {
  const { data } = await api.get(`/integrations/${providerKey}`);
  return data;
}

/** Trigger a sync for a provider. */
export async function triggerSync(
  providerKey: string
): Promise<IntegrationResult> {
  const { data } = await api.post(`/integrations/${providerKey}/sync`);
  return data;
}
