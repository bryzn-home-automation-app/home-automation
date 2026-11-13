import { errorMessage } from '../api/climate';
import type { useRoombaScheduleSkips } from '../hooks/useRoombaScheduleSkips';
import type { RoombaNativeSchedule, RoombaScheduleSkip } from '../types';
import { cleanName, cleanWhen, skipPicture, skippableClean, skipStatusLine, type SkippableClean } from '../utils/roombaSkips';
import { scheduleDays, type NextClean } from '../utils/roombaStatus';
import { Button, ButtonRow, Notice, Stack } from './ui';

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "Today's 9:00 AM clean and tomorrow's 9:00 AM clean". */
function namesOf(skips: readonly RoombaScheduleSkip[], now: Date): string {
  const names = skips.map((s, i) => (i === 0 ? cleanName(s.date, s.hour, s.minute, now) : lowerFirst(cleanName(s.date, s.hour, s.minute, now))));
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Under the "Next clean" readout: skip today's or tomorrow's scheduled clean, and what is skipped.
 * The schedules are the robot's own, in the iRobot app, which has no "skip once"; the poller
 * switches the schedule off there across the skipped start and back on after it. An admin skips
 * and undoes, like the robot's other keys; everyone sees what is skipped.
 */
export default function RoombaSkipClean({ skips: { query, skip, undo }, schedules, next, isAdmin, now }: {
  /** The page's useRoombaScheduleSkips() (the "Next clean" readout reads the same list). */
  skips: ReturnType<typeof useRoombaScheduleSkips>;
  schedules: readonly RoombaNativeSchedule[] | undefined;
  /** The next clean that will run (skipped ones already passed over). */
  next: NextClean | null;
  isAdmin: boolean;
  now: Date;
}) {
  const skips = query.data;
  // Nothing until both are in, so the row doesn't flash a key for a clean that's already skipped.
  if (!schedules || skips === undefined) return null;

  const { skipped, failed, dropped } = skipPicture(skips, now);
  const offers = isAdmin
    ? [skippableClean(schedules, skips, 0, now), skippableClean(schedules, skips, 1, now)].filter((c): c is SkippableClean => c != null)
    : [];
  if (skipped.length === 0 && !failed && !dropped && offers.length === 0) return null;

  const retrying = skipped.find((s) => s.lastError);
  const pendingSkip = skip.isPending ? skip.variables : undefined;
  const statusLine = (s: RoombaScheduleSkip) => {
    const days = schedules.find((x) => x.householdScheduleId === s.householdScheduleId)?.days;
    return skipStatusLine(s, now, days?.length ? scheduleDays(days) : undefined);
  };

  return (
    <Stack gap="s">
      {skipped.length > 0 && (
        <Notice
          tone={retrying ? 'headsup' : 'neutral'}
          icon="calendar"
          live="polite"
          title={`${namesOf(skipped, now)} ${skipped.length === 1 ? 'is' : 'are'} skipped.`}
          action={isAdmin ? skipped.map((s) => (
            <Button
              key={s.id}
              size="sm"
              busy={undo.isPending && undo.variables === s.id}
              busyLabel="Undoing…"
              disabled={undo.isPending && undo.variables !== s.id}
              onClick={() => undo.mutate(s.id)}
            >
              {skipped.length === 1 ? 'Undo' : `Undo ${lowerFirst(cleanName(s.date, s.hour, s.minute, now)).replace(/ clean$/, '')}`}
            </Button>
          )) : undefined}
        >
          {next ? `Next clean ${cleanWhen(next.at, now)}. ` : 'No other clean is scheduled. '}
          {statusLine(retrying ?? skipped[0])}
        </Notice>
      )}
      {failed && (
        <Notice tone="problem" title={`Couldn't skip ${lowerFirst(cleanName(failed.date, failed.hour, failed.minute, now))}.`}>
          {failed.detail ?? "Its schedule couldn't be switched off in time, so it may have run."}
        </Notice>
      )}
      {dropped && skipped.length === 0 && (
        <Notice tone="headsup" title={`${cleanName(dropped.date, dropped.hour, dropped.minute, now)} wasn't skipped.`}>
          {dropped.detail}
        </Notice>
      )}
      {offers.length > 0 && (
        <ButtonRow className="justify-center">
          {offers.map((c) => (
            <Button
              key={c.date}
              size="sm"
              variant="quiet"
              icon="calendar"
              busy={pendingSkip?.date === c.date && pendingSkip.householdScheduleId === c.householdScheduleId}
              busyLabel="Skipping…"
              disabled={skip.isPending && pendingSkip?.date !== c.date}
              onClick={() => skip.mutate({ householdScheduleId: c.householdScheduleId, date: c.date })}
            >
              {`Skip ${lowerFirst(cleanName(c.date, c.hour, c.minute, now))}`}
            </Button>
          ))}
        </ButtonRow>
      )}
      {(skip.isError || undo.isError) && (
        <p className="fp-small fp-t-problem text-center" role="status">
          {skip.isError
            ? `Couldn't skip it: ${errorMessage(skip.error, "the home server didn't answer")}`
            : `Couldn't undo it: ${errorMessage(undo.error, "the home server didn't answer")}`}
        </p>
      )}
    </Stack>
  );
}
