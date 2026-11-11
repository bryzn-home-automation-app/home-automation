import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoombaMap from '../components/RoombaMap';
import type { RoombaMap as RoombaMapData } from '../types';

// The floor map drawn on its own: rooms stay named keys in every mode, the key lists only the
// marks the plan has, and a room too small for its name gets a number the key spells out.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock('../api/roomba', () => ({
  fetchRoombaPosition: async () => null,
  fetchRoombaCoverage: async () => null,
}));

const poly = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

const map = {
  robotId: 'r1',
  mapId: 'm1',
  mapVersion: 'v1',
  name: 'Main Floor',
  geojson: {
    rooms: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 1, properties: { name: 'Kitchen' }, geometry: poly(0, 0, 5, 4) },
        { type: 'Feature', id: 2, properties: { name: 'Living Room' }, geometry: poly(5, 0, 10, 4) },
        // Half a metre square: far too small for its name.
        { type: 'Feature', id: 3, properties: { name: 'Closet' }, geometry: poly(9.5, 4, 10, 4.5) },
      ],
    },
    floorPlan: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: poly(0, 0, 10, 4.5) }] },
    borders: { type: 'FeatureCollection', features: [] },
    dockPose: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0.4, 2] } }] },
    policyZones: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { category: 'KEEP_OUT_ZONE' }, geometry: poly(1, 1, 2, 2) }],
    },
  },
} as unknown as RoombaMapData;

function renderMap(props: Partial<Parameters<typeof RoombaMap>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoombaMap map={map} robotName="Rosie" {...props} />
    </QueryClientProvider>,
  );
}

describe('RoombaMap', () => {
  it('draws the plan as a picture with names, and keys only the marks it has', () => {
    renderMap({ lastClean: { rooms: ['Kitchen'], label: 'Cleaned yesterday' } });
    const plan = screen.getByRole('img', { name: 'Floor plan: Main Floor' });
    expect(within(plan).getByText('Kitchen')).toBeInTheDocument();
    expect(within(plan).getByText('Living Room')).toBeInTheDocument();
    const key = screen.getByRole('list', { name: 'Map key' });
    expect(within(key).getByText('Off-limits')).toBeInTheDocument();
    expect(within(key).getByText('Dock')).toBeInTheDocument();
    expect(within(key).getByText('Cleaned yesterday')).toBeInTheDocument();
    expect(within(key).queryByText('No mopping')).toBeNull();
    expect(within(key).queryByText('Virtual wall')).toBeNull();
    // The closet is numbered on the plan and named in the key.
    expect(within(plan).queryByText('Closet')).toBeNull();
    expect(within(plan).getByText('1')).toBeInTheDocument();
    expect(within(key).getByText('Closet')).toBeInTheDocument();
  });

  it('keeps every room a named key while editing, even one shown by number', () => {
    const onSelectRoom = vi.fn();
    renderMap({ editable: true, onSelectRoom });
    const plan = screen.getByRole('group', { name: 'Floor plan: Main Floor' });
    fireEvent.click(within(plan).getByRole('button', { name: 'Rename Closet' }));
    expect(onSelectRoom).toHaveBeenCalledWith({ id: '3', name: 'Closet' });
    expect(within(plan).getByRole('button', { name: 'Rename Kitchen' })).toBeInTheDocument();
  });

  it('selects rooms to merge and to clean by their names', () => {
    const onToggleMergeRoom = vi.fn();
    const { unmount } = renderMap({ mergeMode: true, mergeSelection: ['1'], onToggleMergeRoom });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Select Living Room to merge' }), { key: 'Enter' });
    expect(onToggleMergeRoom).toHaveBeenCalledWith({ id: '2', name: 'Living Room' });
    expect(screen.getByRole('button', { name: 'Deselect Kitchen to merge' })).toBeInTheDocument();
    unmount();

    const onSelectCleanRoom = vi.fn();
    renderMap({ cleanMode: true, onSelectCleanRoom });
    fireEvent.click(screen.getByRole('button', { name: 'Clean Kitchen' }));
    expect(onSelectCleanRoom).toHaveBeenCalledWith({ id: '1', name: 'Kitchen' });
  });
});
