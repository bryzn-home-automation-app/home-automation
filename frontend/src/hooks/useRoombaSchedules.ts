import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRoombaSchedule,
  deleteRoombaSchedule,
  fetchRoombaSchedules,
  setRoombaScheduleEnabled,
  updateRoombaSchedule,
} from '../api/roomba';
import type { RoombaScheduleInput } from '../types';

const SCHEDULES_KEY = ['roomba', 'schedules'] as const;

/**
 * Recurring cleaning schedules for the Roomba tab's Automation section, plus
 * create / update / enable-toggle / delete mutations. Every mutation invalidates
 * the schedules query so the list re-fetches after a change. Only enabled for
 * admins (the endpoints are admin-gated).
 */
export function useRoombaSchedules(enabled: boolean) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY });

  const query = useQuery({
    queryKey: SCHEDULES_KEY,
    queryFn: fetchRoombaSchedules,
    enabled,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (input: RoombaScheduleInput) => createRoombaSchedule(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: RoombaScheduleInput }) =>
      updateRoombaSchedule(id, input),
    onSuccess: invalidate,
  });

  const toggle = useMutation({
    mutationFn: ({ id, nextEnabled }: { id: number; nextEnabled: boolean }) =>
      setRoombaScheduleEnabled(id, nextEnabled),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteRoombaSchedule(id),
    onSuccess: invalidate,
  });

  return { query, create, update, toggle, remove };
}
