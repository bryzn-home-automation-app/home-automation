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
  windSpeed: number;
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
  precipitationProbability: number;
  windSpeed: number;
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

// ── Roomba ────────────────────────────────────────────────
// Shapes mirror the backend REST contract (BUILD_CONTRACT.md). The poller
// writes append-only run rows + latest status/map snapshots; the backend
// exposes them read-only. `null` from a fetch fn means 204 (nothing yet).

/** Latest live snapshot from GET /api/roomba/status (or null = 204, no row yet). */
export interface RoombaStatus {
  robotId: string;
  name: string | null;
  batteryPct: number | null;
  /** raw V4 phase: run | charge | stop | idle | evac | hmPostMsn | ... */
  phase: string | null;
  /** raw V4 cycle: clean | none | ... */
  cycle: string | null;
  error: number;
  /** true when phase is an active-cleaning phase (run/evac/...). */
  running: boolean;
  binPresent: boolean | null;
  tankPresent: boolean | null;
  currentMissionId: string | null;
  missionStart: string | null;
  sqft: number | null;
  runtimeMinutes: number | null;
  dockState: number | null;
  lifetimeMissions: number | null;
  lifetimeRunMinutes: number | null;
  mapVersion: string | null;
  /** updated_at within the last 10 min. */
  online: boolean;
  updatedAt: string;
}

export type RoombaRunStatus = 'COMPLETED' | 'STUCK' | 'CANCELLED';

/** One completed mission from GET /api/roomba/runs (newest first). */
export interface RoombaRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
  squareFeet: number | null;
  /** COMPLETED | STUCK | CANCELLED (widened to string for forward-compat). */
  status: RoombaRunStatus | string;
  missionId: string | null;
}

// ── Minimal GeoJSON (only what the map renderer consumes) ──

export type GeoPosition = number[]; // [x, y] in meters

export interface GeoPointGeometry {
  type: 'Point';
  coordinates: GeoPosition;
}

export interface GeoPolygonGeometry {
  type: 'Polygon';
  coordinates: GeoPosition[][]; // rings
}

export interface GeoLineStringGeometry {
  type: 'LineString';
  coordinates: GeoPosition[];
}

export interface GeoMultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: GeoPosition[][][];
}

export type GeoGeometry =
  | GeoPointGeometry
  | GeoPolygonGeometry
  | GeoLineStringGeometry
  | GeoMultiPolygonGeometry;

export interface GeoFeature {
  type: 'Feature';
  id?: string | number;
  geometry: GeoGeometry | null;
  properties?: Record<string, unknown> | null;
}

export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

/** Parsed map bundle stored by the poller — each layer is a FeatureCollection. */
export interface RoombaMapGeoJson {
  manifest?: unknown;
  metadata?: unknown;
  rooms?: GeoFeatureCollection | null;
  borders?: GeoFeatureCollection | null;
  floorPlan?: GeoFeatureCollection | null;
  dockPose?: GeoFeatureCollection | null;
}

/** GET /api/roomba/map (or null = 204, no map built yet). */
export interface RoombaMap {
  robotId: string;
  mapId: string | null;
  mapVersion: string | null;
  name: string | null;
  geojson: RoombaMapGeoJson;
  updatedAt: string;
}
