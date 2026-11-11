import api from './client';
import type { WeatherOutlook, WeatherResponse } from '../types';

/** The week ahead at the property: today and the next six days, one row per day. */
export async function fetchWeatherOutlook(): Promise<WeatherOutlook> {
  const { data } = await api.get('/weather/outlook');
  return data;
}

/** Fetch weather for a specific date range (historical or recent). */
export async function fetchWeatherForRange(
  start: string,
  end: string,
): Promise<WeatherResponse> {
  const { data } = await api.get('/weather/range', {
    params: { start, end },
  });
  return data;
}

/** Fetch current weather at the property coordinates. */
export async function fetchCurrentWeather(): Promise<WeatherResponse> {
  const { data } = await api.get('/weather/current');
  return data;
}
