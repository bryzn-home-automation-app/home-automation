import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRoombaNativeSchedules, refreshRoombaNativeSchedules } from '../api/roomba';

const NATIVE_SCHEDULES_KEY = ['roomba', 'native-schedules'] as const;

/**
 * Real (robot/cloud-side) schedules for the Roomba tab, read-only — see
 * RoombaNativeSchedules.tsx's own docstring for why creating/editing isn't
 * built into the app yet. `refresh` re-runs the poller's "list_schedules"
 * command and invalidates the query once it's queued; the actual DB update
 * happens a few seconds later on the poller's next command tick, so a second
 * manual refetch shortly after is normal.
 */
export function useRoombaNativeSchedules(enabled: boolean) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: NATIVE_SCHEDULES_KEY,
    queryFn: fetchRoombaNativeSchedules,
    enabled,
    staleTime: 30_000,
  });

  const refresh = useMutation({
    mutationFn: refreshRoombaNativeSchedules,
    onSuccess: () => {
      // The poller processes commands on a ~5s tick, then this table updates —
      // invalidate now and again shortly after so the UI catches the real result
      // without the user needing to click twice.
      qc.invalidateQueries({ queryKey: NATIVE_SCHEDULES_KEY });
      setTimeout(() => qc.invalidateQueries({ queryKey: NATIVE_SCHEDULES_KEY }), 6000);
    },
  });

  return { query, refresh };
}
