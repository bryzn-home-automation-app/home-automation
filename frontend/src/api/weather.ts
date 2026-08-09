import api from './client';
import type { WeatherResponse } from '../types';

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
