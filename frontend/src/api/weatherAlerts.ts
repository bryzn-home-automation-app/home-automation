import api from './client';

export interface WeatherAlertOption {
  value: number;
  label: string;
}

/**
 * One weather alert with this member's settings. `inApp`/`push` work like every other alert
 * type. A `scheduled` alert is checked once a day at `checkAt` for the hours until `until`
 * ("HH:mm", Central time); the NWS warnings one is sent as soon as a warning is issued.
 */
export interface WeatherAlert {
  type: string;
  label: string;
  description: string;
  inApp: boolean;
  push: boolean;
  scheduled: boolean;
  checkAt: string | null;
  until: string | null;
  /** One of `thresholdOptions`, or null for alerts without a limit. */
  threshold: number | null;
  thresholdLabel: string | null;
  thresholdOptions: WeatherAlertOption[];
}

/** Fields left out stay as they are. */
export interface WeatherAlertChange {
  inApp?: boolean;
  push?: boolean;
  checkAt?: string;
  until?: string;
  threshold?: number;
}

/** What the alert would say from the forecast right now; title/message only when it would alert. */
export interface WeatherAlertPreview {
  when: string;
  hours: string | null;
  severity: string | null;
  title: string | null;
  message: string | null;
  summary: string;
}

export async function fetchWeatherAlerts(): Promise<WeatherAlert[]> {
  const res = await api.get<WeatherAlert[]>('/weather-alerts');
  return Array.isArray(res.data) ? res.data : [];
}

export async function updateWeatherAlert(type: string, change: WeatherAlertChange): Promise<WeatherAlert> {
  const res = await api.put<WeatherAlert>(`/weather-alerts/${encodeURIComponent(type)}`, change);
  return res.data;
}

export async function previewWeatherAlert(type: string): Promise<WeatherAlertPreview> {
  const res = await api.get<WeatherAlertPreview>(`/weather-alerts/${encodeURIComponent(type)}/preview`);
  return res.data;
}
