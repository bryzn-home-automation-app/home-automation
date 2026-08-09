import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as weatherApi from '../api/weather';

vi.mock('../api/weather', () => ({
  fetchWeatherForRange: vi.fn(),
  fetchCurrentWeather: vi.fn(),
}));

async function renderCard(props: {
  startDate?: string;
  endDate?: string;
  showHDD?: boolean;
  showPrecipitation?: boolean;
}) {
  const { default: WeatherContextCard } = await import(
    '../components/WeatherContextCard'
  );
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WeatherContextCard
        startDate={props.startDate ?? '2026-08-01'}
        endDate={props.endDate ?? '2026-08-08'}
        showHDD={props.showHDD}
        showPrecipitation={props.showPrecipitation}
      />
    </QueryClientProvider>,
  );
}

function makeWeatherResponse(overrides?: Record<string, unknown>) {
  return {
    latitude: 33.215,
    longitude: -97.133,
    current: null,
    daily: [
      {
        date: '2026-08-05',
        minTemperature: 74,
        maxTemperature: 96,
        meanTemperature: 85,
        precipitation: 0.1,
        weatherCode: 1,
      },
      {
        date: '2026-08-06',
        minTemperature: 72,
        maxTemperature: 94,
        meanTemperature: 83,
        precipitation: 0.0,
        weatherCode: 0,
      },
      {
        date: '2026-08-07',
        minTemperature: 75,
        maxTemperature: 97,
        meanTemperature: 86,
        precipitation: 0.5,
        weatherCode: 61,
      },
    ],
    aggregation: {
      averageTemperature: 84.67,
      minTemperature: 72.0,
      maxTemperature: 97.0,
      totalPrecipitation: 0.6,
      heatingDegreeDays: 0.0,
    },
    ...overrides,
  };
}

describe('WeatherContextCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading skeleton initially', async () => {
    (weatherApi.fetchWeatherForRange as any).mockReturnValue(
      new Promise(() => {}), // never resolves
    );
    await renderCard({});

    // Should show a skeleton (animate-pulse class)
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('should render weather data when loaded', async () => {
    (weatherApi.fetchWeatherForRange as any).mockResolvedValue(
      makeWeatherResponse(),
    );
    await renderCard({});

    await waitFor(() => {
      expect(screen.getByText(/Weather Context/)).toBeInTheDocument();
    });

    expect(screen.getByText(/85°F avg/)).toBeInTheDocument();
    expect(screen.getByText(/72°F – 97°F/)).toBeInTheDocument();
  });

  it('should render nothing on error', async () => {
    (weatherApi.fetchWeatherForRange as any).mockRejectedValue(
      new Error('Network error'),
    );
    const { container } = await renderCard({});

    // Wait for the loading skeleton to disappear (component returns null on error)
    await waitFor(() => {
      expect(document.querySelector('.animate-pulse')).toBeNull();
    });
    // After error, component should render nothing
    expect(container.innerHTML).toBe('');
  });

  it('should render nothing when disabled (empty dates)', async () => {
    (weatherApi.fetchWeatherForRange as any).mockResolvedValue(
      makeWeatherResponse(),
    );
    const { container } = await renderCard({ startDate: '', endDate: '' });

    // Should not attempt to fetch and should render nothing
    expect(weatherApi.fetchWeatherForRange).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('should show HDD when showHDD is true', async () => {
    const resp = makeWeatherResponse({
      aggregation: {
        averageTemperature: 45.0,
        minTemperature: 31.0,
        maxTemperature: 55.0,
        totalPrecipitation: 0.2,
        heatingDegreeDays: 512.0,
      },
    });
    (weatherApi.fetchWeatherForRange as any).mockResolvedValue(resp);
    await renderCard({ showHDD: true });

    await waitFor(() => {
      expect(screen.getByText(/512 HDD/)).toBeInTheDocument();
    });
  });

  it('should show precipitation when showPrecipitation is true', async () => {
    (weatherApi.fetchWeatherForRange as any).mockResolvedValue(
      makeWeatherResponse(),
    );
    await renderCard({ showPrecipitation: true });

    await waitFor(() => {
      expect(screen.getByText(/💧/)).toBeInTheDocument();
    });
  });

  it('should not show HDD when showHDD is false', async () => {
    (weatherApi.fetchWeatherForRange as any).mockResolvedValue(
      makeWeatherResponse(),
    );
    await renderCard({ showHDD: false });

    await waitFor(() => {
      expect(screen.getByText(/Weather Context/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/HDD/)).toBeNull();
  });
});
