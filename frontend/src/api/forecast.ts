import api from './client';
import type { ForecastResponse, ForecastAccuracy, ForecastHourlyResponse } from '../types';

export async function fetchForecast(days = 7): Promise<ForecastResponse> {
  const { data } = await api.get('/forecast/electric', { params: { days } });
  return data;
}

export async function fetchForecastAccuracy(days = 30): Promise<ForecastAccuracy> {
  const { data } = await api.get('/forecast/accuracy', { params: { days } });
  return data;
}

export async function fetchHourlyForecast(date?: string): Promise<ForecastHourlyResponse> {
  const { data } = await api.get('/forecast/electric/hourly', { params: date ? { date } : {} });
  return data;
}
