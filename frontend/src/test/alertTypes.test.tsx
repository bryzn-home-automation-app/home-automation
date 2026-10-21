import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AlertTypePreference } from '../api/notifications';

const state = vi.hoisted(() => ({
  isGuest: false,
  prefs: [] as AlertTypePreference[],
  saves: [] as Array<[string, boolean, boolean]>,
  failNext: false,
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isGuest: state.isGuest }) }));

vi.mock('../api/notifications', () => ({
  fetchAlertPreferences: async () => state.prefs.map((p) => ({ ...p })),
  setAlertPreference: async (type: string, inApp: boolean, push: boolean) => {
    state.saves.push([type, inApp, push]);
    if (state.failNext) {
      state.failNext = false;
      throw new Error('server said no');
    }
    const p = state.prefs.find((x) => x.type === type)!;
    Object.assign(p, { inApp, push: inApp && push });
    return { ...p };
  },
  resetAlertPreferences: async () => {
    state.prefs.forEach((p) => Object.assign(p, { inApp: p.defaultInApp, push: p.defaultInApp && p.defaultPush }));
    return state.prefs.map((p) => ({ ...p }));
  },
}));

import AlertTypeSettings from '../components/AlertTypeSettings';

function pref(type: string, category: AlertTypePreference['category'], label: string, push: boolean): AlertTypePreference {
  return { type, category, label, description: `${label} details`, inApp: true, push, defaultInApp: true, defaultPush: push };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlertTypeSettings />
    </QueryClientProvider>,
  );
}

describe('<AlertTypeSettings>', () => {
  afterEach(() => {
    state.isGuest = false;
    state.saves = [];
    state.failNext = false;
  });

  it('groups types and saves a change; turning a type off also turns its phone alert off', async () => {
    state.prefs = [
      pref('PERSON_DETECTED', 'CAMERA', 'Person outside', true),
      pref('ENERGY_DAILY', 'ELECTRICAL', 'Daily usage report', false),
    ];
    renderCard();

    const cameras = await screen.findByRole('region', { name: 'Cameras' });
    expect(within(cameras).getByText('Person outside')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Electricity' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull();

    const phone = screen.getByRole('switch', { name: 'Daily usage report on phone' });
    expect(phone).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(phone);
    await waitFor(() => expect(state.saves).toEqual([['ENERGY_DAILY', true, true]]));
    expect(phone).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('switch', { name: 'Person outside alerts' }));
    await waitFor(() => expect(state.saves[1]).toEqual(['PERSON_DETECTED', false, false]));
    expect(screen.getByRole('switch', { name: 'Person outside on phone' })).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Person outside alerts' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('puts the switch back if saving fails', async () => {
    state.prefs = [pref('CAMERA_OFFLINE', 'CAMERA', 'Camera offline', true)];
    state.failNext = true;
    renderCard();
    const sw = await screen.findByRole('switch', { name: 'Camera offline alerts' });
    fireEvent.click(sw);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn.t save/);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('shows nothing to guests', () => {
    state.isGuest = true;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
