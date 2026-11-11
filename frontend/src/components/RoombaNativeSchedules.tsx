import { useRoombaNativeSchedules } from '../hooks/useRoombaNativeSchedules';
import { scheduleLine } from '../utils/roombaStatus';
import { Badge, Button, EmptyState, List, Notice, Panel, QueryState, Row, SkelRows } from './ui';

/**
 * REAL (robot/cloud-side) schedules: what the iRobot app itself has, not an app-side
 * approximation. Replaces the old RoombaSchedules component, which fired a plain "start" at the
 * right time but never wrote the robot's own schedule, so nothing it made showed in the iRobot app.
 *
 * Read-only by design for now: creating/editing a native schedule is the highest-risk write this
 * integration has (see roomba-v4-integration's control.md). A malformed one is a delayed-effect
 * failure that can start the robot when nobody's home, and the API has sharp edges probing
 * already found (a batched create keeps only the last schedule; two similarly-named ids where
 * only one works for delete). Until that's hardened enough to trust in a UI, use
 * roomba-v4-integration/probes/probe6..8_schedule_*.py to add or remove one; this view shows
 * what's really there and lets an admin pull a fresh read.
 */
export default function RoombaNativeSchedules({ isAdmin }: { isAdmin: boolean }) {
  const { query, refresh } = useRoombaNativeSchedules(true);

  return (
    <Panel
      title="Schedules"
      subtitle="Mirrored from the iRobot app, where they're set"
      action={
        isAdmin ? (
          <Button size="sm" variant="quiet" icon="refresh" busy={refresh.isPending} busyLabel="Asking…" onClick={() => refresh.mutate()}>
            Refresh
          </Button>
        ) : undefined
      }
      footer={<span className="fp-small fp-muted">Read only. To add or change one, use the iRobot app (or ask an admin).</span>}
    >
      {/* A failed admin refresh says so (B-127); the list below keeps what was read before. */}
      {refresh.isError && (
        <Notice tone="headsup" live="polite" className="mb-3">Couldn't reach the robot. Try again in a moment.</Notice>
      )}
      <QueryState
        query={query}
        what="the schedules"
        compact
        loading={<SkelRows count={2} />}
        empty={
          // Only an admin has the Refresh key, so only an admin is told to use it (B-127).
          <EmptyState compact icon="calendar" title="No schedules yet">
            {isAdmin ? 'Refresh to read what the iRobot app has set.' : 'Schedules set up in the iRobot app show here.'}
          </EmptyState>
        }
      >
        {(schedules) => (
          <List>
            {schedules.map((s) => (
              <Row
                key={s.householdScheduleId}
                icon="calendar"
                title={s.name ?? 'Unnamed schedule'}
                meta={scheduleLine(s)}
                trail={<Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'On' : 'Off'}</Badge>}
              />
            ))}
          </List>
        )}
      </QueryState>
    </Panel>
  );
}
