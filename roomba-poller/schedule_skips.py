"""
Skipping one scheduled clean: the decisions, without any I/O (poller.py reads and writes
the database and the iRobot cloud; tests/test_schedule_skips.py covers every rule).

WHY A SKIP SWITCHES THE SCHEDULE OFF. The schedules are the robot's own, held in iRobot's
cloud. There is no "skip once" there: a Prime schedule is paused through its own `enabled`
flag (roombapy-prime 0.8.3, docs/internal/APK_3_0_0_FINDINGS.md: "Prime pauses schedules
through `enabled` per schedule"), and app 3.0.0 dropped the old `exclude` field from the
schedule. So a skip switches the one schedule off across the start it skips, and back on
afterwards. Toggling `enabled` on the container just read is the schedule write that has
been confirmed in the field (roombapy-prime's verify_schedule_write.py stage 2, and Home
Assistant Roomba+'s schedule switches and presence pausing).

THE RULES
* Off only across the skipped start. A schedule that runs on several days is switched off
  once its run before the skipped one has started (APPLY_GRACE after it), never sooner, and
  back on after restore_after (the backend sets it, 30 min after the skipped start).
* The cloud's current copy, with only `enabled` changed. It is read just before each write,
  so an edit made in the iRobot app meanwhile is kept. Before switching off, the skipped
  start must still be in it (same day and time); if the owner changed or deleted it, the
  skip is dropped and nothing is written.
* Only what we switched off is switched back on. A schedule the owner had already switched
  off is left alone, and one they switch back on in the app ends the skip.
* Never left off by us. A skip is a database row, so a restart, an outage or a failed write
  only delays the switch back on: the poller keeps retrying (RETRY_SECONDS) until the cloud
  shows the schedule on. APPLYING is stored before the switch-off is sent, so a restart in
  the middle of the send still knows the schedule may be off because of us.
* Two skips of one schedule (today's and tomorrow's) share the time it is off: the second
  joins the first instead of the schedule going on and off between them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Schedule times are the robot's wall clock, which is the home's (the backend's AlertEngine
# and the frontend use the same zone).
HOME_TZ = "America/Chicago"

# States (roomba_schedule_skips.state, VARCHAR).
PENDING = "PENDING"      # asked for; the schedule hasn't been switched off yet
APPLYING = "APPLYING"    # the switch-off is being sent (stored first: see the module notes)
APPLIED = "APPLIED"      # switched off by us; switched back on after restore_after
RESTORED = "RESTORED"    # back on, or nothing left to switch back on
CANCELLED = "CANCELLED"  # nothing was switched off: undone, or nothing to skip any more
FAILED = "FAILED"        # couldn't be switched off before the clean was due
ACTIVE = frozenset({PENDING, APPLYING, APPLIED})

# Switch a schedule off this long after its previous run started, never sooner: that run
# must not be the one skipped.
APPLY_GRACE = timedelta(minutes=15)
# While a schedule is off for a skip, look at it this often, so one switched back on in the
# iRobot app is noticed (and the page says so) before the skip ends.
CHECK_EVERY = timedelta(minutes=30)
# After a failed read or write, the next try waits this long (by failures in a row), then
# every 15 minutes for as long as it takes.
RETRY_SECONDS = (60, 120, 300, 600, 900)
# A switch-off still failing near the start gets one last try this long before it.
LAST_TRY_BEFORE_START = timedelta(seconds=30)

# What the page and the command row say about a skip (roomba_schedule_skips.detail).
UNDONE_EARLY = "Undone before the schedule was switched off."
UNDONE = "Undone. The schedule is back on."
UNDONE_KEPT_OFF = "Undone. The schedule stays off for another skipped clean."
TOO_LATE = "The schedule couldn't be switched off before the clean was due, so it may have run."
CHANGED = "The schedule's days or time were changed in the iRobot app, so this clean wasn't skipped."
GONE = "The schedule was deleted in the iRobot app, so there was nothing to skip."
GONE_WHILE_OFF = "The schedule was deleted in the iRobot app, so there was nothing to switch back on."
ALREADY_OFF = "The schedule was already off in the iRobot app, so there was nothing to skip."
WAITING = "The schedule is switched off after its earlier clean has started."
OFF = "The schedule is switched off in the iRobot app until the skipped clean has passed."
JOINED = "The schedule is already off for another skipped clean, and stays off for this one too."
ON_IN_APP = "The schedule was switched back on in the iRobot app, so this clean wasn't skipped."
ON_IN_APP_LATE = "The schedule was switched back on in the iRobot app."
KEPT_OFF = "Done. The schedule stays off for the next skipped clean."
ALREADY_ON = "Done. The schedule was already back on."
BACK_ON = "Done. The schedule is back on."


@dataclass
class Skip:
    """One roomba_schedule_skips row the poller is still working on. Times are aware UTC."""
    id: int
    container_id: str                 # household_schedule_id: what update_schedules() addresses
    schedule_id: str | None           # the schedule inside it (None: the container's only one)
    skip_date: date                   # the skipped clean's day, at home
    hour: int
    minute: int
    scheduled_for: datetime           # the skipped start
    restore_after: datetime           # switch it back on from here
    state: str
    undo: bool = False
    next_check_at: datetime | None = None
    attempts: int = 0
    last_error: str | None = None

    @property
    def key(self):
        return (self.container_id, self.schedule_id)

    def due(self, now):
        """Something to do now: a step, a look, a retry, or settling it."""
        if self.state not in ACTIVE:
            return False
        if self.undo or (self.state == PENDING and now >= self.scheduled_for):
            return True
        return self.next_check_at is None or now >= self.next_check_at


@dataclass
class Change:
    """What to write onto one row. None leaves a column as it is."""
    skip_id: int
    state: str | None = None
    detail: str | None = None
    next_check_at: datetime | None = None
    original_enabled: bool | None = None
    applied_at: datetime | None = None
    finished_at: datetime | None = None
    attempts: int | None = None
    last_error: str | None = None
    clear_error: bool = False         # attempts = 0, last_error = NULL


def _clip(text, n=480):
    text = str(text)
    return text if len(text) <= n else text[: n - 1] + "…"


def retry_delay(attempts):
    """Seconds before the next try after `attempts` failures in a row (1 = the first)."""
    return RETRY_SECONDS[min(max(1, attempts), len(RETRY_SECONDS)) - 1]


def retry(skip, now, error):
    """A read or write that failed: count it, keep the error, and try again later. A
    switch-off that is still in time gets a last try shortly before the start; nothing ever
    tries sooner than its backoff otherwise (each try is a cloud call)."""
    attempts = skip.attempts + 1
    at = now + timedelta(seconds=retry_delay(attempts))
    last_try = skip.scheduled_for - LAST_TRY_BEFORE_START
    if skip.state in (PENDING, APPLYING) and not skip.undo and now < last_try:
        at = min(at, last_try)
    return Change(skip.id, attempts=attempts, last_error=_clip(error), next_check_at=at)


def _finish(skip, state, detail, now, keep_error=False):
    return Change(skip.id, state=state, detail=detail, finished_at=now, clear_error=not keep_error)


def settle_offline(skip, now):
    """What can be decided without the cloud: a skip undone before anything was switched off,
    and one whose start came before it could be (the poller was down, or the cloud was)."""
    if skip.state != PENDING:
        return None
    if skip.undo:
        return _finish(skip, CANCELLED, UNDONE_EARLY, now)
    if now >= skip.scheduled_for:
        why = f" ({skip.last_error})" if skip.last_error else ""
        return _finish(skip, FAILED, TOO_LATE + why, now, keep_error=True)
    return None


def groups_due(skips, now):
    """Active skips by schedule, only for schedules where one of them is due. Every skip of a
    due schedule comes along, because whether it stays off depends on all of them."""
    by_key = {}
    for s in skips:
        by_key.setdefault(s.key, []).append(s)
    return {k: g for k, g in by_key.items() if any(s.due(now) for s in g)}


# ---------------------------------------------------------------------------
# The cloud's schedules (get_schedules_raw())
# ---------------------------------------------------------------------------
def containers(raw):
    """[(household_schedule_id, [schedule entries])] from the raw schedule response. Raises
    ValueError on anything but the documented shape: an answer that can't be read must never
    pass for "the schedule was deleted" (that would drop a skip and leave its schedule off)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("household_schedules"), list):
        raise ValueError("unexpected schedule response from the iRobot cloud")
    out = []
    for c in raw["household_schedules"]:
        if not isinstance(c, dict) or not c.get("household_schedule_id"):
            continue
        entries = c.get("schedules")
        if not isinstance(entries, list):
            raise ValueError("unexpected schedule list from the iRobot cloud")
        out.append((c["household_schedule_id"], [e for e in entries if isinstance(e, dict)]))
    return out


def entry_id(entry):
    """A schedule's id: beside its options (app 2.2.4) or inside them (3.0.0)."""
    sid = entry.get("schedule_id")
    options = entry.get("options")
    if not sid and isinstance(options, dict):
        sid = options.get("schedule_id")
    return sid or None


def find_entry(conts, container_id, schedule_id):
    """The schedule a skip is about, or None when the cloud no longer has it."""
    for cid, entries in conts:
        if cid != container_id:
            continue
        if schedule_id:
            return next((e for e in entries if entry_id(e) == schedule_id), None)
        return entries[0] if len(entries) == 1 else None
    return None


def mirror_rows(conts):
    """(household_schedule_id, options) per schedule, for roomba_native_schedule."""
    return [(cid, e["options"]) for cid, entries in conts for e in entries if isinstance(e.get("options"), dict)]


def _days(raw):
    out = set()
    for d in raw if isinstance(raw, list) else []:
        if isinstance(d, bool):
            continue
        try:
            out.add(int(d))
        except (TypeError, ValueError):
            pass
    return out


def runs_on(days, day):
    """Whether a schedule with these `start.day` numbers runs on `day`. iRobot counts
    0 = Sunday ... 6 = Saturday; Sunday is also taken as 7, the numbering this app's backend
    was written for, since nothing here has seen a Sunday schedule yet."""
    wd = (day.weekday() + 1) % 7
    return wd in days or (wd == 0 and 7 in days)


def _start(options):
    start = options.get("start")
    return start if isinstance(start, dict) else {}


def still_scheduled(options, skip):
    """The skipped start is still in the cloud's copy: same time, and still on that day."""
    start = _start(options)
    return (start.get("hour") == skip.hour and start.get("min") == skip.minute
            and runs_on(_days(start.get("day")), skip.skip_date))


def last_start_between(options, after, before, tz):
    """The schedule's latest start strictly between two aware instants, or None."""
    start = _start(options)
    hour, minute = start.get("hour"), start.get("min")
    days = _days(start.get("day"))
    if not isinstance(hour, int) or not isinstance(minute, int) or not days:
        return None
    best = None
    day = after.astimezone(tz).date()
    last = before.astimezone(tz).date()
    while day <= last:
        if runs_on(days, day):
            at = datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz).astimezone(timezone.utc)
            if after < at < before:
                best = at
        day += timedelta(days=1)
    return best


# ---------------------------------------------------------------------------
# One schedule's skips against the cloud's copy
# ---------------------------------------------------------------------------
@dataclass
class GroupPlan:
    """What to do to one schedule. `write` is the `enabled` value to send (None: no send);
    `marks` are stored before it goes; `changes` hold once it is confirmed (or straight away
    when nothing is sent); `writers` are the skips whose change rides on the send."""
    container_id: str
    schedule_id: str | None
    write: bool | None = None
    marks: list = field(default_factory=list)
    changes: dict = field(default_factory=dict)
    writers: list = field(default_factory=list)

    def fail(self, now, error):
        """The send failed or didn't show: the writers try again; the rest stand."""
        for s in self.writers:
            self.changes[s.id] = retry(s, now, error)


def _look_again(skip, now):
    return min(skip.restore_after, now + CHECK_EVERY)


def plan_group(skips, entry, now, tz=None):
    """Decide one schedule's skips from the cloud's current copy of it (`entry`, None when it
    has gone). Pure: the caller stores the marks, sends `write`, checks it took, and stores
    the changes (or plan.fail()s the writers)."""
    tz = tz or ZoneInfo(HOME_TZ)
    plan = GroupPlan(skips[0].container_id, skips[0].schedule_id)
    out = plan.changes

    def put(s, change):
        out[s.id] = change

    def update(s, **fields):
        c = out.setdefault(s.id, Change(s.id))
        for k, v in fields.items():
            setattr(c, k, v)

    options = entry.get("options") if isinstance(entry, dict) else None
    if not isinstance(options, dict):
        # Deleted in the app: nothing to skip, nothing to switch back on.
        for s in skips:
            put(s, _finish(s, RESTORED if s.state == APPLIED else CANCELLED,
                           GONE_WHILE_OFF if s.state == APPLIED else GONE, now))
        return plan

    enabled = options.get("enabled")
    if not isinstance(enabled, bool):
        for s in skips:
            if s.due(now):
                put(s, retry(s, now, "the iRobot cloud didn't say whether the schedule is on"))
        return plan

    # A switch-off sent but never confirmed: off now means it took (it is ours), on means
    # it didn't (it is tried again below while still in time).
    state = {}
    for s in skips:
        st = s.state
        if st == APPLYING:
            if enabled:
                st = PENDING
                update(s, state=PENDING)
            else:
                st = APPLIED
                update(s, state=APPLIED, applied_at=now, original_enabled=True, detail=OFF,
                       next_check_at=_look_again(s, now), clear_error=True)
        state[s.id] = st

    releasing = [s for s in skips if state[s.id] == APPLIED and (s.undo or now >= s.restore_after)]
    staying = [s for s in skips if state[s.id] == APPLIED and s not in releasing]

    to_apply = []
    for s in skips:
        if state[s.id] != PENDING or not (s.due(now) or s.state == APPLYING):
            continue
        if s.undo:
            put(s, _finish(s, CANCELLED, UNDONE_EARLY, now))
        elif now >= s.scheduled_for:
            put(s, _finish(s, FAILED, TOO_LATE, now))
        elif not still_scheduled(options, s):
            put(s, _finish(s, CANCELLED, CHANGED, now))
        elif (earlier := last_start_between(options, now - APPLY_GRACE, s.scheduled_for, tz)) is not None:
            # Its run before the skipped one hasn't started (or only just has): wait for it.
            update(s, next_check_at=earlier + APPLY_GRACE, detail=WAITING, clear_error=True)
        else:
            to_apply.append(s)

    ours = bool(staying or releasing)
    holding = []
    if to_apply:
        if enabled:
            plan.write = False
            for s in to_apply:
                plan.marks.append(Change(s.id, state=APPLYING))
                plan.writers.append(s)
                update(s, state=APPLIED, applied_at=now, original_enabled=True, detail=OFF,
                       next_check_at=_look_again(s, now), clear_error=True)
            holding += to_apply
        elif ours:
            for s in to_apply:
                update(s, state=APPLIED, applied_at=now, original_enabled=True, detail=JOINED,
                       next_check_at=_look_again(s, now), clear_error=True)
            holding += to_apply
        else:
            for s in to_apply:
                put(s, _finish(s, CANCELLED, ALREADY_OFF, now))

    for s in staying:
        if enabled and plan.write is None:
            # Switched back on in the iRobot app while it was off for the skip.
            put(s, _finish(s, RESTORED, ON_IN_APP if now < s.scheduled_for else ON_IN_APP_LATE, now))
        else:
            holding.append(s)
            if s.due(now):
                update(s, next_check_at=_look_again(s, now), clear_error=True)

    if releasing:
        if holding:
            for s in releasing:
                put(s, _finish(s, RESTORED, UNDONE_KEPT_OFF if s.undo else KEPT_OFF, now))
        elif enabled:
            for s in releasing:
                put(s, _finish(s, RESTORED, UNDONE if s.undo else ALREADY_ON, now))
        else:
            plan.write = True
            for s in releasing:
                plan.writers.append(s)
                put(s, _finish(s, RESTORED, UNDONE if s.undo else BACK_ON, now))
    return plan
