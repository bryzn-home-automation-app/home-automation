import api from './client';
import type {
  ForecastResponse,
  ForecastSnapshot,
  ForecastAccuracy,
  ForecastHourlyResponse,
  ForecastHourlyAccuracy,
} from '../types';

export async function fetchForecast(days = 7): Promise<ForecastResponse> {
  const { data } = await api.get('/forecast/electric', { params: { days } });
  return data;
}

/** Stored predictions (freshest per day) for the trailing `days`; independent of the live forecast. */
export async function fetchForecastSnapshots(days = 30): Promise<ForecastSnapshot[]> {
  const { data } = await api.get('/forecast/electric/snapshots', { params: { days } });
  return data.snapshots ?? [];
}

export async function fetchForecastAccuracy(days = 30): Promise<ForecastAccuracy> {
  const { data } = await api.get('/forecast/accuracy', { params: { days } });
  return data;
}

export async function fetchHourlyForecast(date?: string): Promise<ForecastHourlyResponse> {
  const { data } = await api.get('/forecast/electric/hourly', { params: date ? { date } : {} });
  return data;
}

export async function fetchHourlyForecastAccuracy(days = 7): Promise<ForecastHourlyAccuracy> {
  const { data } = await api.get('/forecast/accuracy/hourly', { params: { days } });
  return data;
}
