import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { COMMAND_CEILING_MS, ROOMBA_STATUS_KEY, useQueuedCommand } from '../components/roomba/useQueuedCommand';
import * as roombaApi from '../api/roomba';
import type { RoombaCommand } from '../types';

// The dialogs' command watch: close while the row is on its way, a ceiling after which it says
// there's no word and frees the keys, and the status refreshed the moment the row lands.

const rows: RoombaCommand[] = [];

vi.mock('../api/roomba', () => ({ fetchRoombaCommands: vi.fn(async () => rows.map((r) => ({ ...r }))) }));

const row = (status: string): RoombaCommand => ({
  id: 5, command: 'start', arg: null, status, detail: null, requestedBy: 'bryan',
  createdAt: new Date().toISOString(), processedAt: null,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useQueuedCommand(async () => row('PENDING')), { wrapper });
  return { qc, ...hook };
}

describe('useQueuedCommand', () => {
  beforeEach(() => {
    rows.splice(0, rows.length);
    vi.mocked(roombaApi.fetchRoombaCommands).mockClear();
  });

  it('says there is no word after the ceiling, frees the keys and slows down, and a late outcome still lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      rows.push(row('SENT'));
      const { result } = setup();
      act(() => result.current.send());
      await waitFor(() => expect(result.current.status).toBe('SENT'));
      expect(result.current.submitting).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(COMMAND_CEILING_MS - 5_000); });
      expect(result.current.noWord).toBe(false);
      expect(result.current.submitting).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      expect(result.current.noWord).toBe(true);
      expect(result.current.submitting).toBe(false);
      const fetches = vi.mocked(roombaApi.fetchRoombaCommands).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(vi.mocked(roombaApi.fetchRoombaCommands).mock.calls.length - fetches).toBeLessThanOrEqual(1);
      rows[0] = row('OK');
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      expect(result.current.done).toBe(true);
      expect(result.current.noWord).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the robot status the moment the row lands', async () => {
    rows.push(row('OK'));
    const { qc, result } = setup();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    act(() => result.current.send());
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ROOMBA_STATUS_KEY });
  });
});
