import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRoombaScheduleSkips, skipRoombaClean, undoRoombaSkip } from '../api/roomba';
import type { RoombaScheduleSkip } from '../types';
import { isActiveSkip } from '../utils/roombaSkips';

const SKIPS_KEY = ['roomba', 'schedule-skips'] as const;
const SCHEDULES_KEY = ['roomba', 'native-schedules'] as const;

/** While the poller is between steps (just asked, being switched off, an undo), read every 5 s. */
function busy(skips: readonly RoombaScheduleSkip[] | undefined): boolean {
  return (skips ?? []).some((s) => {
    if (!isActiveSkip(s)) return false;
    const justAsked = !s.appliedAt && Date.now() - Date.parse(s.createdAt) < 60_000;
    return s.state === 'APPLYING' || s.undoRequested || justAsked;
  });
}

/**
 * Skipped scheduled cleans, and the admin's skip / undo. The poller does the work a few seconds
 * after each (it switches the schedule off or back on in the iRobot app), so the list is read
 * quickly while that is under way, and the mirrored schedules are re-read whenever a skip moves
 * on (the poller refreshes them from the cloud as it goes).
 */
export function useRoombaScheduleSkips() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: SKIPS_KEY,
    queryFn: fetchRoombaScheduleSkips,
    staleTime: 10_000,
    refetchInterval: (q) => (busy(q.state.data) ? 5_000 : 60_000),
    refetchIntervalInBackground: false,
  });

  // A skip that moved on (switched off, back on, dropped) has refreshed the schedules too.
  const progress = (query.data ?? []).map((s) => `${s.id}:${s.state}`).join(',');
  useEffect(() => {
    if (progress) qc.invalidateQueries({ queryKey: SCHEDULES_KEY });
  }, [progress, qc]);

  const settle = () => {
    qc.invalidateQueries({ queryKey: SKIPS_KEY });
    qc.invalidateQueries({ queryKey: ['roomba', 'commands'] });
  };

  const skip = useMutation({
    mutationFn: ({ householdScheduleId, date }: { householdScheduleId: string; date: string }) =>
      skipRoombaClean(householdScheduleId, date),
    onSuccess: (row) => {
      qc.setQueryData<RoombaScheduleSkip[]>(SKIPS_KEY, (old) => [row, ...(old ?? []).filter((s) => s.id !== row.id)]);
      settle();
    },
  });

  const undo = useMutation({
    mutationFn: (id: number) => undoRoombaSkip(id),
    onSuccess: (row) => {
      qc.setQueryData<RoombaScheduleSkip[]>(SKIPS_KEY, (old) => (old ?? []).map((s) => (s.id === row.id ? row : s)));
      settle();
    },
  });

  return { query, skip, undo };
}
