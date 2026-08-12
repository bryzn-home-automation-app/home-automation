export interface UtilityProvider {
  id: number;
  name: string;
  type: 'ELECTRIC' | 'GAS' | 'WATER' | 'SOLAR';
  portalUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UtilityAccount {
  id: number;
  providerId: number;
  provider?: UtilityProvider;
  accountNumber: string;
  serviceAddress?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface Meter {
  id: number;
  accountId: number;
  account?: UtilityAccount;
  meterNumber: string;
  type: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
}

/** Append-only — never updated or deleted. */
export interface EnergyUsage {
  id: number;
  meterId: number;
  meter?: Meter;
  timestamp: string;
  usageKwh: number;
  cost?: number;
  source: string;
  sourceProvider: string;
  ingestionBatchId: string;   // UUID — ties records from one sync together
  processingVersion: string;  // parser version that produced this record
  createdAt: string;
}

/** Append-only — new statement = new row, never overwritten. */
export interface UtilityBill {
  id: number;
  accountId: number;
  account?: UtilityAccount;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  usageKwh?: number;
  amount: number;
  dueDate?: string;
  status: 'ISSUED' | 'PAID' | 'OVERDUE';
  source: string;
  sourceProvider: string;
  ingestionBatchId: string;   // UUID — ties records from one sync together
  processingVersion: string;  // parser version that produced this record
  createdAt: string;
}

export interface IntegrationAdapter {
  key: string;
  name: string;
  healthy: string;
}

export interface IntegrationResult {
  providerKey: string;
  providerName: string;
  batchId: string;            // UUID — all records from this sync run
  success: boolean;
  usageRecordsSynced: number;
  billRecordsSynced: number;
  errors: string[];
  tempFiles: string[];        // temp files created (deleted after success)
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface UsageSummaryPoint {
  timestamp: string;
  usageKwh: number;
}

export interface UsageRangeSummary {
  meterId: number;
  start: string;
  end: string;
  totalKwh: number;
  averageKwh: number;
  readingCount: number;
  highest: UsageSummaryPoint | null;
  lowest: UsageSummaryPoint | null;
}

/** Pre-aggregated daily kWh from server — one row per date. */
export interface DailyUsagePoint {
  date: string;
  totalKwh: number;
  readingCount: number;
  sourceProvider: string;
}

// ── Weather ───────────────────────────────────────────────

export interface WeatherCurrent {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitation: number;
  weatherCode: number;
}

export interface WeatherDay {
  date: string;
  minTemperature: number;
  maxTemperature: number;
  meanTemperature: number;
  precipitation: number;
  weatherCode: number;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitation: number;
  weatherCode: number;
}

export interface WeatherAggregation {
  averageTemperature: number | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  totalPrecipitation: number | null;
  heatingDegreeDays: number | null;
}

export interface WeatherResponse {
  latitude: number;
  longitude: number;
  current: WeatherCurrent | null;
  daily: WeatherDay[];
  hourly: WeatherHour[];
  aggregation: WeatherAggregation | null;
}
