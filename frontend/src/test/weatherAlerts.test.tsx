import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WeatherAlert, WeatherAlertChange } from '../api/weatherAlerts';

const state = vi.hoisted(() => ({
  isGuest: false,
  alerts: [] as WeatherAlert[],
  saves: [] as Array<[string, WeatherAlertChange]>,
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isGuest: state.isGuest }) }));

vi.mock('../api/weatherAlerts', () => ({
  fetchWeatherAlerts: async () => state.alerts.map((a) => ({ ...a })),
  updateWeatherAlert: async (type: string, change: WeatherAlertChange) => {
    state.saves.push([type, change]);
    const a = state.alerts.find((x) => x.type === type)!;
    Object.assign(a, change);
    a.push = a.inApp && a.push;
    return { ...a };
  },
  previewWeatherAlert: async () => ({
    when: 'Tonight at 8 PM',
    hours: '8 PM – 8 AM',
    severity: 'INFO',
    title: 'Rain likely overnight',
    message: 'Up to 80% chance from about 2 AM to 6 AM.',
    summary: 'Rain likely overnight.',
  }),
}));

import WeatherAlertSettings, { clockLabel, hoursCovered, spanLabel } from '../components/WeatherAlertSettings';

function rain(): WeatherAlert {
  return {
    type: 'WEATHER_RAIN',
    label: 'Rain',
    description: 'Rain likely in the hours you pick',
    inApp: false,
    push: false,
    scheduled: true,
    checkAt: '20:00',
    until: '08:00',
    threshold: 50,
    thresholdLabel: 'Chance of rain',
    thresholdOptions: [
      { value: 50, label: '50%' },
      { value: 70, label: '70%' },
    ],
  };
}

function warnings(): WeatherAlert {
  return {
    type: 'WEATHER_NWS',
    label: 'Weather warnings',
    description: 'Official warnings',
    inApp: true,
    push: true,
    scheduled: false,
    checkAt: null,
    until: null,
    threshold: 1,
    thresholdLabel: 'Send',
    thresholdOptions: [
      { value: 1, label: 'Warnings' },
      { value: 2, label: 'Warnings and watches' },
    ],
  };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WeatherAlertSettings />
    </QueryClientProvider>,
  );
}

describe('<WeatherAlertSettings>', () => {
  afterEach(() => {
    state.isGuest = false;
    state.saves = [];
  });

  it('turning an alert on sends it to the phone too, then shows its time and limit', async () => {
    state.alerts = [rain(), warnings()];
    renderCard();

    const on = await screen.findByRole('switch', { name: 'Rain alerts' });
    expect(screen.queryByLabelText('Check at')).toBeNull();
    fireEvent.click(on);
    await waitFor(() => expect(state.saves).toEqual([['WEATHER_RAIN', { inApp: true, push: true }]]));
    expect(screen.getByRole('switch', { name: 'Rain on phone' })).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByLabelText('Check at')).toHaveValue('20:00');
    expect(screen.getByLabelText('Look ahead to')).toHaveValue('08:00');
    expect(screen.getByText('Checked every day at 8 PM, looking ahead to 8 AM (12 hr).')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Look ahead to'), { target: { value: '06:00' } });
    await waitFor(() => expect(state.saves[1]).toEqual(['WEATHER_RAIN', { until: '06:00' }]));
    expect(await screen.findByText('Checked every day at 8 PM, looking ahead to 6 AM (10 hr).')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Chance of rain'), { target: { value: '70' } });
    await waitFor(() => expect(state.saves[2]).toEqual(['WEATHER_RAIN', { threshold: 70 }]));
  });

  it('warnings have no times, just which kinds to send', async () => {
    state.alerts = [warnings()];
    renderCard();
    expect(await screen.findByLabelText('Send')).toHaveValue('1');
    expect(screen.queryByLabelText('Check at')).toBeNull();
    expect(screen.getByText('Sent as soon as the National Weather Service issues one for home.')).toBeInTheDocument();
  });

  it('"Check the forecast now" shows what the alert would say', async () => {
    state.alerts = [{ ...rain(), inApp: true, push: true }];
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Check the forecast now' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Tonight at 8 PM · 8 PM – 8 AM');
    expect(status).toHaveTextContent("You'd get: Rain likely overnight");
  });

  it('is hidden from guests', () => {
    state.isGuest = true;
    state.alerts = [rain()];
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('formats times and the hours covered', () => {
    expect(clockLabel('20:00')).toBe('8 PM');
    expect(clockLabel('06:30')).toBe('6:30 AM');
    expect(clockLabel('00:00')).toBe('midnight');
    expect(clockLabel('12:00')).toBe('noon');
    expect(hoursCovered('20:00', '08:00')).toBe(12);
    expect(hoursCovered('07:00', '21:00')).toBe(14);
    expect(hoursCovered('07:00', '07:00')).toBe(24);
  });

  it('writes the window in the app duration style, never "1 hours" or "0.3 hours" (B-163)', () => {
    expect(spanLabel('20:00', '21:00')).toBe('1 hr');
    expect(spanLabel('20:00', '20:15')).toBe('15 min');
    expect(spanLabel('20:00', '20:45')).toBe('45 min');
    expect(spanLabel('20:00', '21:30')).toBe('1 hr 30 min');
    expect(spanLabel('20:00', '08:00')).toBe('12 hr');
  });
});
