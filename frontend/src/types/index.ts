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

/** Itemized water bill parsed from the Gmail-forwarded PDF. Append-only. */
export interface WaterBill {
  id: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  billingDate?: string;
  dueDate?: string;
  usageThousands?: number;
  waterCharge?: number;
  sewerCharge?: number;
  refuseCharge?: number;
  taxCharge?: number;
  stormwaterCharge?: number;
  achDiscount?: number;
  totalDue: number;
  pdfPath?: string;
  source: string;
  sourceProvider: string;
  ingestionBatchId: string;
  processingVersion: string;
  createdAt: string;
}

/** Combined electric+gas CoServ bill downloaded from SmartHub Billing History. Append-only. */
export interface CoservBill {
  id: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  billingDate?: string;
  dueDate?: string;
  electricUsageKwh?: number;
  electricCharge?: number;
  gasUsageCcf?: number;
  gasCharge?: number;
  currentCharges?: number;
  totalDue: number;
  pdfPath?: string;
  source: string;
  sourceProvider: string;
  ingestionBatchId: string;
  processingVersion: string;
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
  error: number | null;
  /** Decoded error title (poller-side vendor_error lookup), null when no error. */
  errorText: string | null;
  /** true when phase is an active-cleaning phase (run/evac/...). */
  running: boolean;
  binPresent: boolean | null;
  tankPresent: boolean | null;
  currentMissionId: string | null;
  missionStart: string | null;
  sqft: number | null;
  runtimeMinutes: number | null;
  dockState: number | null;
  dockError: number | null;
  /** Friendly dock-state label (e.g. "Bag Full", "Evacuation In Progress"). */
  dockText: string | null;
  notReady: number | null;
  /** Who/what started the current mission (rmtApp / schedule / cloud / ...). */
  initiator: string | null;
  detectedPad: string | null;
  chargeCycles: number | null;
  chargeErrors: number | null;
  /** Free-text fault the numeric error code doesn't cover, or null. */
  faultText: string | null;
  /** Wear/stall/cliff counters (bbrun) passthrough, or null on this firmware. */
  wear: Record<string, number> | null;
  lifetimeMissions: number | null;
  lifetimeRunMinutes: number | null;
  mapVersion: string | null;
  /** updated_at within the last 10 min. */
  online: boolean;
  /** true when any attentionReasons are present. */
  needsAttention: boolean;
  attentionReasons: string[];
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
  /** Enrichment fields — populated for runs recorded after the detail work; else null. */
  missionNumber: number | null;
  error: number | null;
  errorText: string | null;
  initiator: string | null;
  cycle: string | null;
  source: string | null;
}

/**
 * Live robot position for the map dot (GET /api/roomba/position, or null = 204
 * when none/stale). x/y are meters in the map bundle's coordinate space; theta
 * is the raw wire heading in radians (provisional — may point out the back).
 */
export interface RoombaPosition {
  robotId: string;
  x: number;
  y: number;
  theta: number | null;
  updatedAt: string;
}

/** Static device identity + firmware (GET /api/roomba/device). */
export interface RoombaDevice {
  robotId: string;
  sku: string | null;
  series: string | null;
  family: string | null;
  serialNumber: string | null;
  firmware: string | null;
  updatedAt: string;
}

/**
 * One consumable / maintenance counter (GET /api/roomba/parts) — the robot's cloud
 * record behind the iRobot app's Maintenance screen. `countRemaining`/`countUsed`
 * are read in `unit` (hours = values are minutes; missions; empties = dock
 * evacuations; washes). Sorted worst first by the API.
 */
export interface RoombaPart {
  partId: string;
  label: string;
  hint: string | null;
  countType: string | null;
  counterCategory: string | null;
  /** replace | clean | null */
  action: string | null;
  /** user (reset in the iRobot app) | cloud (auto, e.g. a new dock bag) */
  resetBy: string | null;
  /** hours | missions | empties | washes | count */
  unit: string;
  countRemaining: number | null;
  countUsed: number | null;
  minutesRemaining: number | null;
  /** remaining / (remaining + used), 0–100. */
  pctRemaining: number | null;
  status: 'ok' | 'due_soon' | 'overdue' | 'unknown' | string;
  lastUpdatedAt: string | null;
  updatedAt: string;
}

/** A queued/processed control command (ADMIN only). */
export interface RoombaCommand {
  id: number;
  command: string;
  arg: string | null;
  /** PENDING | SENT | OK | FAILED. "OK" = broker accepted, not necessarily acted. */
  status: string;
  detail: string | null;
  requestedBy: string | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * A REAL (robot/cloud-side) cleaning schedule, as last read from
 * get_schedules() — not an app-side approximation. {@link days} are ISO-8601
 * day numbers (1 = Monday … 7 = Sunday, confirmed on hardware). {@link
 * operatingModes} are the distinct vendor mode codes used across the
 * schedule's rooms (2 = vacuum, 4 = mop, 6 = vac+mop).
 */
export interface RoombaNativeSchedule {
  householdScheduleId: string;
  name: string | null;
  frequency: string | null;
  days: number[];
  hour: number | null;
  minute: number | null;
  enabled: boolean;
  roomCount: number;
  operatingModes: number[];
  updatedAt: string;
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
  /**
   * Keep-out / no-mop / virtual-wall zones. Feature `properties.category` is a
   * PolicyZoneCategory (KEEP_OUT_ZONE | NO_MOP_ZONE | VIRTUAL_WALL | THRESHOLD).
   * NOTE: a virtual wall is a KEEP_OUT_ZONE-typed feature whose geometry is a
   * LineString, not its own category string. Absent on maps with no zones.
   */
  policyZones?: GeoFeatureCollection | null;
}

// ── Forecast ─────────────────────────────────────────────

export interface ForecastDailyPoint {
  date: string;
  predictedKwh: number;
  predictedCost: number;
  lowerBound: number;
  upperBound: number;
  weatherHigh: number | null;
  weatherLow: number | null;
  weatherAvg: number | null;
  cdd: number | null;
  hdd: number | null;
  confidencePct: number;
}

export interface ForecastSnapshot {
  targetDate: string;
  predictedKwh: number;
  actualKwh: number | null;
  predictedCost: number;
  actualCost: number | null;
}

export interface ForecastResponse {
  status: string;
  message?: string;
  modelId?: number;
  dataPointsUsed?: number;
  rSquared?: number;
  /** Learned per-weekday multiplier on top of the weather-only prediction —
   *  e.g. THURSDAY: 1.08 means Thursdays run ~8% above what weather alone
   *  would predict, keyed by java.time.DayOfWeek names (MONDAY..SUNDAY). */
  dowAdjustments?: Record<string, number>;
  forecasts?: ForecastDailyPoint[];
  snapshots?: ForecastSnapshot[];
}

export interface ForecastAccuracyPoint {
  date: string;
  predicted: number;
  actual: number;
  error: number;
}

export interface ForecastAccuracy {
  dataPoints: number;
  mae: number;
  rmse: number;
  mape: number;
  trailingDays: number;
  points: ForecastAccuracyPoint[];
}

/** One reconstructed hourly-accuracy point (self-improvement hourly view). */
export interface ForecastHourlyAccuracyPoint {
  /** Local `yyyy-MM-ddTHH:00` the point belongs to. */
  timestamp: string;
  date: string;
  hour: number;
  predicted: number;
  actual: number;
  /** |predicted - actual| kWh for that hour. */
  error: number;
}

export interface ForecastHourlyAccuracy {
  dataPoints: number;
  mae: number;
  trailingDays: number;
  points: ForecastHourlyAccuracyPoint[];
}

export interface ForecastHourlyPoint {
  hour: number;
  predictedKwh: number;
  predictedCost: number;
}

export interface ForecastHourlyResponse {
  status: string;
  date: string;
  avgTemp: number;
  hours?: ForecastHourlyPoint[];
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

// ── Climate (Home Assistant → ecobee) ──────────────────────

/**
 * GET /api/home/thermostats[/{id}]. `id` is the app's stable device ID (never
 * the HA entity ID). Any reading may be null when HA reports it unavailable.
 * Timestamps are UTC ISO-8601 strings.
 */
export interface Thermostat {
  id: string;
  name: string;
  available: boolean;
  temperature: number | null;
  humidity: number | null;
  /** Single setpoint in heat or cool mode; null in heat_cool (use the range). */
  targetTemperature: number | null;
  heatSetpoint: number | null;
  coolSetpoint: number | null;
  /** off | heat | cool | heat_cool */
  hvacMode: string | null;
  /** idle | heating | cooling | fan | drying | off */
  hvacAction: string | null;
  /** Comfort setting or hold: home | away | sleep | away_indefinitely | temp (manual hold) | vacation */
  presetMode: string | null;
  temperatureUnit: string | null;
  minTemp: number | null;
  maxTemp: number | null;
  hvacModes: string[];
  presetModes: string[];
  updatedAt: string | null;
  /** Latest setpoint/mode/hold change and who made it (null until one is seen). */
  lastChange: ThermostatChange | null;
}

/**
 * Who changed a thermostat and to what (values are the state after the change).
 * actor: `app` = a user of this app (`by` = display name, `byUserId` = their id),
 * `home_assistant`, or `ecobee` (the thermostat, the ecobee app, or its schedule).
 */
export interface ThermostatChange {
  at: string;
  actor: 'app' | 'home_assistant' | 'ecobee';
  by: string;
  byUserId: number | null;
  fields: Array<'setpoint' | 'mode' | 'preset'>;
  hvacMode: string | null;
  presetMode: string | null;
  targetTemperature: number | null;
  heatSetpoint: number | null;
  coolSetpoint: number | null;
}

/** GET /api/home/thermostats/{id}/history — one stored reading. */
export interface ThermostatReading {
  recordedAt: string;
  temperature: number | null;
  humidity: number | null;
  targetTemperature: number | null;
  heatSetpoint: number | null;
  coolSetpoint: number | null;
  hvacMode: string | null;
  hvacAction: string | null;
  presetMode: string | null;
  source: string | null;
}

/**
 * GET /api/home/cameras (members only). `id` is the app's device ID. Battery
 * fields are null for wired cameras (`powerSource` "wired") and until a battery
 * camera first reports. `charging` is null when the camera doesn't report it —
 * the UI infers it from the level's trend instead.
 */
export interface Camera {
  id: string;
  name: string;
  available: boolean;
  powerSource: 'battery' | 'wired' | null;
  batteryPercent: number | null;
  charging: boolean | null;
  /** The camera's own label when it has one, e.g. "Solar charging". */
  chargingStatus: string | null;
  batteryUpdatedAt: string | null;
  lastMotionAt: string | null;
  lastPersonAt: string | null;
  /** The camera streams through the eufy bridge (live view possible). */
  liveAvailable: boolean;
  lastSeenAt: string | null;
  /** Stored positions saved in the eufy app ("Home", "Position 1"…); empty if none. */
  presets: CameraPreset[];
  /** Pan/tilt nudges available. */
  canPanTilt: boolean;
}

export interface CameraPreset {
  index: number;
  name: string;
}

/** One battery history point (oldest first in a history response). */
export interface CameraBatteryReading {
  at: string;
  percent: number;
  charging: boolean | null;
  chargingStatus: string | null;
}

/** GET /api/home/cameras/{id}/battery — readings plus sunrise→sunset windows. */
/** A recording the camera's HomeBase stored (full quality). Times are ISO-8601. */
export interface CameraRecording {
  id: string;
  cameraId: string;
  cameraName: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  sizeBytes: number;
  hasThumbnail: boolean;
}

export interface CameraBatteryHistory {
  readings: CameraBatteryReading[];
  daylight: Array<{ from: string; to: string }>;
}

/** Visits and active minutes on one tab ("home", "cameras", "admin/debug"). */
export interface TabTotal {
  tab: string;
  visits: number;
  activeMinutes: number;
}

export interface MemberTabUsage {
  userId: number;
  username: string;
  displayName: string | null;
  role: string;
  lastActiveAt: string | null;
  visits: number;
  activeMinutes: number;
  /** Most used first. */
  tabs: TabTotal[];
}

/** Admin view of which tabs house members use, over the last `days`. */
export interface TabUsage {
  days: number;
  household: TabTotal[];
  members: MemberTabUsage[];
}
