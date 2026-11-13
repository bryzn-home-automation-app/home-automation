"""
Skipping a scheduled clean (schedule_skips.py, and the pass in poller.py that reads and
writes the iRobot cloud). The cloud is a fake that keeps its own copy of each schedule and
records every write; the skips table is a dict. Nothing reaches a network, a database or the
robot. Dates are real: Mon Nov 16 2026 ... Fri Nov 20; 9:00 AM at home is 15:00 UTC (CST).
"""
import asyncio
import copy
import os
import sys
import types
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import _stubs  # noqa: E402

_stubs.install()

import poller  # noqa: E402
import schedule_skips as ss  # noqa: E402

HOME = ZoneInfo("America/Chicago")
MON_FRI = "hh_irbt.hh.home_MONFRI_s"   # days [1, 5] at 9:00, vacuum and mop
TUE_THU = "hh_irbt.hh.home_TUETHU_s"   # days [2, 3, 4] at 9:00, vacuum


def at(day, hour, minute=0):
    """A home wall-clock time on Nov `day` 2026, as aware UTC."""
    return datetime(2026, 11, day, hour, minute, tzinfo=HOME).astimezone(timezone.utc)


def skip(sid, schedule, day, state=ss.PENDING, **kw):
    start = at(day, 9)
    fields = dict(id=sid, container_id=schedule, schedule_id=schedule, skip_date=date(2026, 11, day),
                  hour=9, minute=0, scheduled_for=start, restore_after=start + timedelta(minutes=30), state=state)
    fields.update(kw)
    return ss.Skip(**fields)


def options(schedule, days, hour=9, minute=0, enabled=True, **extra):
    body = {
        "name": "Regular Schedule", "start": {"day": days, "hour": hour, "min": minute}, "enabled": enabled,
        "commands": [{"command": {"command": "start", "params": {}, "regions": [
            {"type": "rid", "region_id": "10", "params": {"operatingMode": 2, "twoPass": True}}]}}],
        "robot_id": "BLID", "frequency": "WEEKLY", "schedule_id": schedule,
        "created_time": "2026-10-08T14:26:41.888449+00:00", "is_smart_clean_fav": False,
    }
    body.update(extra)
    return body


def entry(schedule, days, **kw):
    return {"options": options(schedule, days, **kw)}


# ---------------------------------------------------------------------------
# The rules
# ---------------------------------------------------------------------------
class Rules(unittest.TestCase):
    def plan(self, skips, cloud_entry, now):
        return ss.plan_group(skips, cloud_entry, now, HOME)

    def test_skipping_the_schedules_next_run_switches_it_off_at_once(self):
        now = at(16, 20)  # Mon evening; Tue 9:00 is the Tue-Thu schedule's next run
        s = skip(1, TUE_THU, 17)
        p = self.plan([s], entry(TUE_THU, [2, 3, 4]), now)
        self.assertIs(p.write, False)
        self.assertEqual([(m.skip_id, m.state) for m in p.marks], [(1, ss.APPLYING)])
        c = p.changes[1]
        self.assertEqual((c.state, c.original_enabled, c.detail), (ss.APPLIED, True, ss.OFF))
        self.assertEqual(c.next_check_at, now + ss.CHECK_EVERY)

    def test_skipping_tomorrow_waits_until_todays_run_of_the_same_schedule_has_started(self):
        s = skip(1, TUE_THU, 18)  # Wed's clean, asked for Tue at 8:00
        p = self.plan([s], entry(TUE_THU, [2, 3, 4]), at(17, 8))
        self.assertIsNone(p.write, "switching it off now would skip Tuesday's clean too")
        self.assertEqual(p.changes[1].next_check_at, at(17, 9, 15))
        self.assertIsNone(p.changes[1].state)
        p = self.plan([s], entry(TUE_THU, [2, 3, 4]), at(17, 9, 15))
        self.assertIs(p.write, False)

    def test_a_run_that_only_just_started_still_counts_as_ahead(self):
        p = self.plan([skip(1, TUE_THU, 18)], entry(TUE_THU, [2, 3, 4]), at(17, 9, 5))
        self.assertIsNone(p.write)
        self.assertEqual(p.changes[1].next_check_at, at(17, 9, 15))

    def test_a_day_added_in_the_app_is_waited_for_too(self):
        # The skip was asked for Thursday when the schedule ran Tue + Thu; Wed was added since.
        p = self.plan([skip(1, TUE_THU, 19)], entry(TUE_THU, [2, 3, 4]), at(17, 12))
        self.assertIsNone(p.write)
        self.assertEqual(p.changes[1].next_check_at, at(18, 9, 15))

    def test_it_is_switched_back_on_after_the_skipped_start(self):
        s = skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30))
        p = self.plan([s], entry(TUE_THU, [2, 3, 4], enabled=False), at(17, 9, 30))
        self.assertIs(p.write, True)
        self.assertEqual([w.id for w in p.writers], [1])
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.RESTORED, ss.BACK_ON))

    def test_one_already_back_on_is_left_as_it_is(self):
        s = skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30))
        p = self.plan([s], entry(TUE_THU, [2, 3, 4], enabled=True), at(17, 9, 30))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.RESTORED, ss.ALREADY_ON))

    def test_switched_back_on_in_the_app_ends_the_skip_without_a_write(self):
        s = skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(16, 21))
        p = self.plan([s], entry(TUE_THU, [2, 3, 4], enabled=True), at(16, 21))
        self.assertIsNone(p.write, "the owner's choice stands")
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.RESTORED, ss.ON_IN_APP))

    def test_a_routine_look_while_it_is_off_changes_nothing_but_the_next_look(self):
        s = skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(16, 21))
        p = self.plan([s], entry(TUE_THU, [2, 3, 4], enabled=False), at(16, 21))
        self.assertIsNone(p.write)
        self.assertIsNone(p.changes[1].state)
        self.assertEqual(p.changes[1].next_check_at, at(16, 21, 30))

    def test_a_time_changed_in_the_app_drops_the_skip_without_writing(self):
        p = self.plan([skip(1, TUE_THU, 17)], entry(TUE_THU, [2, 3, 4], hour=10), at(16, 20))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.CANCELLED, ss.CHANGED))

    def test_a_day_removed_in_the_app_drops_the_skip_without_writing(self):
        p = self.plan([skip(1, TUE_THU, 17)], entry(TUE_THU, [3, 4]), at(16, 20))
        self.assertIsNone(p.write)
        self.assertEqual(p.changes[1].state, ss.CANCELLED)

    def test_a_deleted_schedule_ends_a_skip_that_switched_nothing_off_at_once(self):
        p = self.plan([skip(1, TUE_THU, 18)], None, at(17, 9, 30))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.CANCELLED, ss.GONE))

    def test_a_schedule_we_switched_off_must_be_missing_from_three_reads_in_a_row(self):
        # One odd answer (an empty list, a container missing) must never end the skip with the
        # schedule left off: it is looked for again, and only the third miss in a row ends it.
        for state in (ss.APPLIED, ss.APPLYING):
            s = skip(2, TUE_THU, 17, state=state)
            now = at(17, 9, 30)
            for n in (1, 2):
                c = self.plan([s], None, now).changes[2]
                self.assertIsNone(c.state, f"{state}: miss {n}")
                self.assertEqual((c.attempts, c.last_error), (n, ss.MISSING))
                self.assertEqual(c.next_check_at, now + timedelta(seconds=ss.retry_delay(n)))
                s.attempts, s.last_error, now = c.attempts, c.last_error, c.next_check_at
            p = self.plan([s], None, now)
            self.assertIsNone(p.write)
            self.assertEqual((p.changes[2].state, p.changes[2].detail), (ss.RESTORED, ss.GONE_WHILE_OFF))
        # Misses only count in a row: a failed read in between starts the count again.
        s = skip(2, TUE_THU, 17, state=ss.APPLIED, attempts=2, last_error="couldn't read the schedules (OSError)")
        self.assertEqual(self.plan([s], None, at(17, 9, 30)).changes[2].attempts, 1)
        # Found again: the skip carries on, back on after its time as usual.
        s = skip(2, TUE_THU, 17, state=ss.APPLIED, attempts=2, last_error=ss.MISSING)
        p = self.plan([s], entry(TUE_THU, [2, 3, 4], enabled=False), at(17, 9, 30))
        self.assertIs(p.write, True)

    def test_the_backend_alerts_on_the_same_words(self):
        java = os.path.join(os.path.dirname(os.path.dirname(HERE)), "backend", "src", "main", "java", "com",
                            "homeplatform", "service", "RoombaScheduleSkipService.java")
        if not os.path.exists(java):
            self.skipTest("the backend isn't beside the poller here")
        with open(java, encoding="utf-8") as f:
            self.assertIn(f'GONE_WHILE_OFF = "{ss.GONE_WHILE_OFF}"', f.read())

    def test_a_schedule_the_owner_had_switched_off_is_not_ours_to_switch_back_on(self):
        p = self.plan([skip(1, TUE_THU, 17)], entry(TUE_THU, [2, 3, 4], enabled=False), at(16, 20))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.CANCELLED, ss.ALREADY_OFF))

    def test_undo_before_the_switch_off_needs_no_cloud(self):
        c = ss.settle_offline(skip(1, TUE_THU, 17, undo=True), at(16, 20))
        self.assertEqual((c.state, c.detail), (ss.CANCELLED, ss.UNDONE_EARLY))

    def test_undo_after_the_switch_off_switches_it_back_on_now(self):
        s = skip(1, TUE_THU, 17, state=ss.APPLIED, undo=True, next_check_at=at(16, 20))
        p = self.plan([s], entry(TUE_THU, [2, 3, 4], enabled=False), at(16, 20))
        self.assertIs(p.write, True)
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.RESTORED, ss.UNDONE))

    def test_a_start_that_passed_before_the_switch_off_is_a_failure_with_its_reason(self):
        s = skip(1, TUE_THU, 17, attempts=3, last_error="couldn't read the schedules (OSError: down)")
        c = ss.settle_offline(s, at(17, 9))
        self.assertEqual(c.state, ss.FAILED)
        self.assertIn("may have run", c.detail)
        self.assertIn("OSError: down", c.detail)
        self.assertFalse(c.clear_error, "the error stays for the alert")

    def test_two_skips_of_one_schedule_share_the_time_it_is_off(self):
        tue = skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30))
        wed = skip(2, TUE_THU, 18, next_check_at=at(17, 9, 15))
        off = entry(TUE_THU, [2, 3, 4], enabled=False)
        # 9:15: Wednesday's joins Tuesday's; the schedule just stays off.
        p = self.plan([tue, wed], off, at(17, 9, 15))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[2].state, p.changes[2].detail), (ss.APPLIED, ss.JOINED))
        # 9:30: Tuesday's is over, but Wednesday's still needs it off: no write.
        wed = skip(2, TUE_THU, 18, state=ss.APPLIED, next_check_at=at(17, 9, 45))
        p = self.plan([tue, wed], off, at(17, 9, 30))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[1].state, p.changes[1].detail), (ss.RESTORED, ss.KEPT_OFF))
        self.assertNotIn(2, p.changes)
        # Wednesday 9:30: the last one switches it back on.
        p = self.plan([wed], off, at(18, 9, 30))
        self.assertIs(p.write, True)
        self.assertEqual(p.changes[2].state, ss.RESTORED)

    def test_two_schedules_are_handled_apart(self):
        groups = ss.groups_due([skip(1, TUE_THU, 17), skip(2, MON_FRI, 20, next_check_at=at(19, 9, 15))], at(16, 20))
        self.assertEqual(list(groups), [(TUE_THU, TUE_THU)])

    def test_a_send_cut_off_by_a_restart_is_settled_from_the_cloud(self):
        applying = skip(1, TUE_THU, 17, state=ss.APPLYING)
        # It took: the schedule is off, and it is ours. No second write.
        p = self.plan([applying], entry(TUE_THU, [2, 3, 4], enabled=False), at(16, 20, 5))
        self.assertIsNone(p.write)
        self.assertEqual((p.changes[1].state, p.changes[1].original_enabled), (ss.APPLIED, True))
        # It didn't take, still in time: sent again.
        p = self.plan([applying], entry(TUE_THU, [2, 3, 4], enabled=True), at(16, 20, 5))
        self.assertIs(p.write, False)
        # It didn't take, and the clean was due: a failure, nothing left off.
        p = self.plan([applying], entry(TUE_THU, [2, 3, 4], enabled=True), at(17, 9, 1))
        self.assertIsNone(p.write)
        self.assertEqual(p.changes[1].state, ss.FAILED)

    def test_retries_back_off_and_a_switch_off_gets_a_last_try_before_the_start(self):
        s = skip(1, TUE_THU, 17, state=ss.APPLIED)
        waits = []
        for n in range(6):
            s.attempts = n
            waits.append((ss.retry(s, at(16, 20), "x").next_check_at - at(16, 20)).total_seconds())
        self.assertEqual(waits, [60, 120, 300, 600, 900, 900])
        pending = skip(1, TUE_THU, 17, attempts=4)
        c = ss.retry(pending, at(17, 8, 55), "x")
        self.assertEqual(c.next_check_at, at(17, 8, 59, ) + timedelta(seconds=30))
        self.assertEqual(c.attempts, 5)
        # Past the last try: the plain backoff, never a tight loop.
        c = ss.retry(pending, at(17, 8, 59, ) + timedelta(seconds=40), "x")
        self.assertEqual(c.next_check_at - (at(17, 8, 59) + timedelta(seconds=40)), timedelta(seconds=900))

    def test_an_unreadable_answer_is_never_taken_for_a_deleted_schedule(self):
        for raw in (None, [], {"error": "InternalError"}, {"household_schedules": None},
                    {"household_schedules": [{"household_schedule_id": TUE_THU, "schedules": None}]},
                    {"household_schedules": [{"schedules": [entry(TUE_THU, [2])]}]},
                    {"household_schedules": [{"household_schedule_id": "", "schedules": []}]},
                    {"household_schedules": ["?"]}):
            with self.assertRaises(ValueError):
                ss.containers(raw)
        conts = ss.containers({"household_schedules": [{"household_schedule_id": TUE_THU, "schedules": [entry(TUE_THU, [2])]}]})
        self.assertIsNotNone(ss.find_entry(conts, TUE_THU, TUE_THU))
        self.assertIsNone(ss.find_entry(conts, TUE_THU, "another"))

    def test_sunday_is_either_0_or_7(self):
        sunday = date(2026, 11, 15)
        self.assertTrue(ss.runs_on({0}, sunday))
        self.assertTrue(ss.runs_on({7}, sunday))
        self.assertFalse(ss.runs_on({1, 6}, sunday))
        self.assertTrue(ss.runs_on({1}, date(2026, 11, 16)))

    def test_start_times_follow_the_home_clock_across_daylight_saving(self):
        # Sat Oct 31 9:00 CDT is 14:00 UTC; Mon Nov 2 9:00 CST is 15:00 UTC.
        found = ss.last_start_between(options(MON_FRI, [1, 6]), datetime(2026, 10, 30, tzinfo=timezone.utc),
                                      datetime(2026, 11, 3, tzinfo=timezone.utc), HOME)
        self.assertEqual(found, datetime(2026, 11, 2, 15, 0, tzinfo=timezone.utc))
        found = ss.last_start_between(options(MON_FRI, [6]), datetime(2026, 10, 30, tzinfo=timezone.utc),
                                      datetime(2026, 11, 3, tzinfo=timezone.utc), HOME)
        self.assertEqual(found, datetime(2026, 10, 31, 14, 0, tzinfo=timezone.utc))


# ---------------------------------------------------------------------------
# The pass in poller.py, against a fake cloud and a fake table
# ---------------------------------------------------------------------------
class FakeCloud:
    """The iRobot cloud's schedules: its own copy, changed only by update_schedules()."""

    blid = "BLID"

    def __init__(self):
        self.containers = {}
        self.writes = []
        self.reads = 0
        self.fail_reads = False
        self.fail_writes = False
        self.write_error = TimeoutError("PUT timed out")
        self.ignore_writes = False

    def add(self, schedule, days, **kw):
        self.containers[schedule] = [entry(schedule, days, **kw)]

    def options(self, schedule):
        return self.containers[schedule][0]["options"]

    async def get_household_id(self):
        return "HOUSEHOLD"

    async def get_schedules_raw(self, household_id):
        self.reads += 1
        if self.fail_reads:
            raise OSError("Cannot connect to host")
        return {"household_schedules": [{"household_schedule_id": cid, "schedules": copy.deepcopy(e)}
                                        for cid, e in self.containers.items()]}

    async def update_schedules(self, household_id, container_id, schedules):
        body = [s.to_json() for s in schedules]
        self.writes.append((household_id, container_id, body))
        if self.fail_writes:
            raise self.write_error
        if not self.ignore_writes:
            self.containers[container_id] = [{"options": copy.deepcopy(b["options"])} for b in body]
        return {}


class Table:
    """roomba_schedule_skips in memory: one dict per row, keyed like the columns."""

    def __init__(self):
        self.rows = {}
        self.mirror = None

    def add(self, s, **extra):
        self.rows[s.id] = {"skip": s, "detail": None, "applied_at": None, "finished_at": None,
                           "original_enabled": None, **extra}

    def load(self, conninfo):
        return [copy.copy(r["skip"]) for r in self.rows.values() if r["skip"].state in ss.ACTIVE]

    def save(self, conninfo, changes, now):
        for c in changes:
            if c is None:
                continue
            row = self.rows[c.skip_id]
            s = row["skip"]
            for name in ("state", "next_check_at", "attempts", "last_error"):
                value = getattr(c, name)
                if value is not None:
                    setattr(s, name, value)
            if c.clear_error:
                s.attempts, s.last_error = 0, None
            for name in ("detail", "applied_at", "finished_at", "original_enabled"):
                value = getattr(c, name)
                if value is not None:
                    row[name] = value

    def outcome(self, conninfo, skip_id):
        row = self.rows.get(skip_id)
        return None if row is None else (row["skip"].state, row["detail"], row["skip"].last_error)

    def replace_mirror(self, conninfo, robot_id, rows):
        self.mirror = rows

    def state(self, sid):
        return self.rows[sid]["skip"].state


class Pass(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cloud = FakeCloud()
        self.cloud.add(MON_FRI, [1, 5])
        self.cloud.add(TUE_THU, [2, 3, 4])
        self.table = Table()
        patcher = mock.patch.multiple(
            poller,
            _load_active_skips=self.table.load,
            _save_skip_changes=self.table.save,
            _load_skip_outcome=self.table.outcome,
            _replace_native_schedules=self.table.replace_mirror,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    async def run_at(self, now):
        return await poller._run_schedule_skips(self.cloud, "conninfo", now=now, tz=HOME)

    async def test_switch_off_sends_the_clouds_copy_with_only_enabled_changed(self):
        self.table.add(skip(1, TUE_THU, 17))
        before = copy.deepcopy(self.cloud.options(TUE_THU))
        await self.run_at(at(16, 20))
        self.assertEqual(len(self.cloud.writes), 1)
        household, container, body = self.cloud.writes[0]
        self.assertEqual((household, container), ("HOUSEHOLD", TUE_THU))
        self.assertEqual(body, [{"schedule_id": TUE_THU, "options": {**before, "enabled": False}}])
        self.assertEqual(self.table.state(1), ss.APPLIED)
        self.assertIs(self.table.rows[1]["original_enabled"], True)
        self.assertEqual(self.cloud.options(MON_FRI)["enabled"], True, "the other schedule is untouched")
        self.assertEqual({cid for cid, _ in self.table.mirror}, {MON_FRI, TUE_THU}, "the page's copy is refreshed")

    async def test_restore_after_a_restart_turns_it_back_on(self):
        # The poller (or the whole NUC) was down at 9:30; it comes back at 11:40.
        self.cloud.add(TUE_THU, [2, 3, 4], enabled=False)
        self.table.add(skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30)))
        await self.run_at(at(17, 11, 40))
        self.assertTrue(self.cloud.options(TUE_THU)["enabled"])
        self.assertEqual(self.table.state(1), ss.RESTORED)
        self.assertEqual(self.table.rows[1]["detail"], ss.BACK_ON)

    async def test_restore_keeps_an_edit_made_in_the_app_meanwhile(self):
        self.table.add(skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30)))
        # While it was off, the owner changed the rooms and the suction in the iRobot app.
        edited = entry(TUE_THU, [2, 3, 4], enabled=False)
        edited["options"]["commands"][0]["command"]["regions"] = [
            {"type": "rid", "region_id": "12", "params": {"operatingMode": 6, "suctionLevel": 4}}]
        self.cloud.containers[TUE_THU] = [edited]
        await self.run_at(at(17, 9, 31))
        sent = self.cloud.writes[0][2][0]["options"]
        self.assertEqual(sent["commands"], edited["options"]["commands"], "their edit, not a stale copy")
        self.assertIs(sent["enabled"], True)
        self.assertEqual({k: v for k, v in sent.items() if k != "enabled"},
                         {k: v for k, v in edited["options"].items() if k != "enabled"})

    async def test_a_failed_switch_back_on_is_retried_until_it_works(self):
        self.cloud.add(TUE_THU, [2, 3, 4], enabled=False)
        self.table.add(skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30)))
        self.cloud.fail_writes = True
        await self.run_at(at(17, 9, 30))
        s = self.table.rows[1]["skip"]
        self.assertEqual((s.state, s.attempts), (ss.APPLIED, 1))
        self.assertIn("PUT timed out", s.last_error)
        self.assertEqual(s.next_check_at, at(17, 9, 31))
        # Not before its time: no cloud call at all.
        reads = self.cloud.reads
        await self.run_at(at(17, 9, 30, ) + timedelta(seconds=30))
        self.assertEqual(self.cloud.reads, reads)
        self.cloud.fail_writes = False
        await self.run_at(at(17, 9, 31))
        self.assertEqual(self.table.state(1), ss.RESTORED)
        self.assertTrue(self.cloud.options(TUE_THU)["enabled"])
        self.assertIsNone(self.table.rows[1]["skip"].last_error)

    async def test_a_write_the_cloud_accepts_but_does_not_keep_counts_as_failed(self):
        self.table.add(skip(1, TUE_THU, 17))
        self.cloud.ignore_writes = True
        await self.run_at(at(16, 20))
        s = self.table.rows[1]["skip"]
        self.assertEqual(s.state, ss.APPLYING, "may be off, so it stays ours to check")
        self.assertIn("still shows the schedule on", s.last_error)
        # Next try: the cloud shows it on, the start is still ahead, so it is sent again.
        self.cloud.ignore_writes = False
        await self.run_at(s.next_check_at)
        self.assertEqual(self.table.state(1), ss.APPLIED)
        self.assertEqual(len(self.cloud.writes), 2)

    async def test_a_restart_mid_send_never_strands_the_schedule_off(self):
        # The switch-off reached the cloud, then the poller died before storing APPLIED.
        self.cloud.add(TUE_THU, [2, 3, 4], enabled=False)
        self.table.add(skip(1, TUE_THU, 17, state=ss.APPLYING, next_check_at=at(16, 20)))
        await self.run_at(at(16, 20, 2))
        self.assertEqual(self.table.state(1), ss.APPLIED)
        self.assertEqual(self.cloud.writes, [])
        await self.run_at(at(17, 9, 30))
        self.assertEqual(self.table.state(1), ss.RESTORED)
        self.assertTrue(self.cloud.options(TUE_THU)["enabled"])

    async def test_a_switch_off_the_cloud_turned_down_goes_back_to_pending(self):
        class Refused(Exception):
            status = 400

        self.table.add(skip(1, TUE_THU, 17))
        self.cloud.fail_writes = True
        self.cloud.write_error = Refused("HTTP 400 from the schedule endpoint")
        await self.run_at(at(16, 20))
        s = self.table.rows[1]["skip"]
        self.assertEqual((s.state, s.attempts), (ss.PENDING, 1))
        # The owner then switches it off in the iRobot app: theirs, not ours to switch back on.
        self.cloud.fail_writes = False
        self.cloud.options(TUE_THU)["enabled"] = False
        await self.run_at(s.next_check_at)
        self.assertEqual((self.table.state(1), self.table.rows[1]["detail"]), (ss.CANCELLED, ss.ALREADY_OFF))
        self.assertEqual(len(self.cloud.writes), 1)

    async def test_a_switch_off_that_may_have_taken_stays_applying(self):
        for error in (TimeoutError("PUT timed out"), type("ServerError", (Exception,), {"status": 502})("HTTP 502")):
            table = Table()
            table.add(skip(1, TUE_THU, 17))
            self.cloud.fail_writes, self.cloud.write_error = True, error
            with mock.patch.multiple(poller, _load_active_skips=table.load, _save_skip_changes=table.save):
                await self.run_at(at(16, 20))
            self.assertEqual(table.state(1), ss.APPLYING, repr(error))

    def test_what_counts_as_a_refused_write(self):
        self.assertTrue(poller._write_refused(poller.ScheduleNotSent("the schedule isn't in the cloud's copy")))
        self.assertFalse(poller._write_refused(TimeoutError()))
        self.assertFalse(poller._write_refused(OSError("Cannot connect to host")))
        if _stubs.real_roombapy_prime():
            from roombapy_prime.rest_client import RestClientError, RestRateLimitedError, RestServerError
            self.assertTrue(poller._write_refused(RestClientError("HTTP 400", 400)))
            self.assertTrue(poller._write_refused(RestRateLimitedError("HTTP 429", 429, None, retry_after=60)))
            self.assertFalse(poller._write_refused(RestServerError("HTTP 503", 503)))

    async def test_an_empty_answer_while_a_schedule_is_off_for_us_is_a_miss_not_a_deletion(self):
        self.cloud.add(TUE_THU, [2, 3, 4], enabled=False)
        self.table.add(skip(1, TUE_THU, 17, state=ss.APPLIED, next_check_at=at(17, 9, 30)))
        self.cloud.containers = {}
        await self.run_at(at(17, 9, 30))
        s = self.table.rows[1]["skip"]
        self.assertEqual((s.state, s.attempts, s.last_error), (ss.APPLIED, 1, ss.MISSING))
        self.assertEqual(self.cloud.writes, [])
        self.assertIsNone(self.table.mirror, "an empty answer doesn't wipe the page's copy")

    async def test_an_unreadable_cloud_writes_nothing_and_tries_again(self):
        self.table.add(skip(1, TUE_THU, 17))
        self.cloud.fail_reads = True
        await self.run_at(at(16, 20))
        s = self.table.rows[1]["skip"]
        self.assertEqual((s.state, s.attempts), (ss.PENDING, 1))
        self.assertEqual(self.cloud.writes, [])
        self.assertIsNone(self.table.mirror, "a failed read never replaces the page's copy")

    async def test_the_skip_command_reports_on_its_skip(self):
        self.table.add(skip(1, TUE_THU, 17))
        with mock.patch.object(poller, "datetime", wraps=datetime) as dt:
            dt.now.return_value = at(16, 20)
            ok, detail = await poller._rest_command(self.cloud, "conninfo", None, poller.SKIP_CLEAN, "1")
        self.assertTrue(ok)
        self.assertEqual(detail, f"skip #1 applied: {ss.OFF}")
        self.cloud.fail_reads = True
        self.table.add(skip(2, MON_FRI, 20))
        with mock.patch.object(poller, "datetime", wraps=datetime) as dt:
            dt.now.return_value = at(16, 20)
            ok, detail = await poller._rest_command(self.cloud, "conninfo", None, poller.SKIP_CLEAN, "2")
        self.assertFalse(ok)
        self.assertIn("trying again shortly", detail)

    async def test_the_periodic_check_never_raises(self):
        def broken(conninfo):
            raise RuntimeError("relation roomba_schedule_skips does not exist")

        with mock.patch.object(poller, "_load_active_skips", broken):
            await poller._check_schedule_skips(self.cloud, "conninfo")


class Assignments(unittest.TestCase):
    def test_only_the_poller_s_columns_are_written(self):
        now = at(16, 20)
        c = ss.Change(5, state=ss.APPLIED, detail=ss.OFF, original_enabled=True, applied_at=now,
                      next_check_at=now + ss.CHECK_EVERY, clear_error=True)
        sets, params = poller._skip_assignments(c, now)
        self.assertEqual(sets, ["state = %s", "detail = %s", "original_enabled = %s", "next_check_at = %s",
                                "applied_at = %s", "attempts = 0", "last_error = NULL", "updated_at = %s"])
        self.assertEqual(params[3], datetime(2026, 11, 17, 2, 30))  # Mon 8:30 PM at home, as naive UTC
        self.assertFalse(any("undo_requested" in s or "alerted" in s for s in sets))


def odd_entry(schedule):
    """A schedule entry with what roombapy-prime's own dataclasses don't model: unknown keys inside
    start/end and beside options and on a command wrapper, nulls, empty lists, a frequency it
    doesn't know. The write must send all of it back."""
    body = entry(schedule, [2, 3, 4])
    o = body["options"]
    o["start"]["tz_hint"] = {"x": None}
    o["end"] = {"hour": None, "min": 30, "mystery": []}
    o["after"] = None
    o["until"] = {"date": None}
    o["exclude"] = []
    o["frequency"] = "EVERY_OTHER_FULL_MOON"
    o["commands"][0]["wrapper_extra"] = {"keep": [1, None]}
    body["beside_options"] = {"n": None}
    return body


class RawWrite(unittest.IsolatedAsyncioTestCase):
    """The schedule write sends the cloud's copy back as it was read, but for `enabled`."""

    async def write(self, robot, conts, container, schedule, enabled):
        await poller._set_schedule_enabled(robot, "HOUSEHOLD", conts, container, schedule, enabled)

    async def test_everything_read_goes_back_but_enabled(self):
        sent = []

        class Robot:
            async def update_schedules(self, household_id, container_id, schedules):
                sent.append({"schedules": [s.to_json() for s in schedules]})  # what 0.8.3 sends

        target, other = odd_entry("A"), odd_entry("B")
        conts = [("HH", [copy.deepcopy(target), copy.deepcopy(other)])]
        await self.write(Robot(), conts, "HH", "A", False)
        expected = [copy.deepcopy(target), copy.deepcopy(other)]
        expected[0]["options"]["enabled"] = False
        for e, sid in zip(expected, ("A", "B")):
            e["schedule_id"] = sid
        self.assertEqual(sent, [{"schedules": expected}])

    @unittest.skipUnless(_stubs.real_roombapy_prime(), "needs the real roombapy_prime (the poller image)")
    async def test_through_the_real_library_nothing_is_lost(self):
        # The pinned library's own update_schedules() builds the body; only the HTTP call is faked.
        from roombapy_prime.rest_client import PrimeRestClient

        requests = []

        class Rest:
            _http_base_auth = "https://example.invalid"

            async def _request_object(self, method, url, **kwargs):
                requests.append((method, url, kwargs.get("body")))
                return {}

        class Robot:
            async def update_schedules(self, household_id, container_id, schedules):
                return await PrimeRestClient.update_schedules(Rest(), household_id, container_id, schedules)

        target = odd_entry("A")
        conts = [("HH", [copy.deepcopy(target)])]
        await self.write(Robot(), conts, "HH", "A", False)
        (method, url, body), = requests
        self.assertEqual(method, "PUT")
        self.assertTrue(url.endswith("/v1/households/HOUSEHOLD/settings/schedule/HH"))
        expected = copy.deepcopy(target)
        expected["options"]["enabled"] = False
        expected["schedule_id"] = "A"
        self.assertEqual(body, {"schedules": [expected]})

    async def test_two_schedules_of_one_container_in_one_pass_both_stay_switched(self):
        cloud = FakeCloud()
        cloud.containers["HH"] = [entry("A", [2, 3, 4]), entry("B", [1, 5])]
        table = Table()
        table.add(skip(1, "A", 17, container_id="HH"))
        table.add(skip(2, "B", 20, container_id="HH"))
        with mock.patch.multiple(poller, _load_active_skips=table.load, _save_skip_changes=table.save,
                                 _replace_native_schedules=table.replace_mirror):
            await poller._run_schedule_skips(cloud, "conninfo", now=at(16, 20), tz=HOME)
        self.assertEqual(len(cloud.writes), 2)
        self.assertEqual([e["options"]["enabled"] for e in cloud.containers["HH"]], [False, False],
                         "the second write kept the first one's switch-off")
        self.assertEqual((table.state(1), table.state(2)), (ss.APPLIED, ss.APPLIED))


class FakePg:
    """psycopg.connect() for _save_skip_changes: keeps each UPDATE, and refuses one that binds a
    string over 500 characters (roomba_schedule_skips.detail / last_error are VARCHAR(500)), or
    any for the ids in `refuse`, as Postgres would."""

    def __init__(self, refuse=()):
        self.updates = []
        self.refuse = set(refuse)

    def __call__(self, conninfo, autocommit=False):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        skip_id = params[-1]
        if skip_id in self.refuse or any(isinstance(p, str) and len(p) > 500 for p in params):
            raise RuntimeError("value too long for type character varying(500)")
        self.updates.append((skip_id, sql, params))


class UnwritableRows(unittest.IsolatedAsyncioTestCase):
    """A row that can't be written must cost neither the other rows nor a cloud read every pass
    (a 566-character FAILED detail once failed its UPDATE every time and took the batch with it)."""

    def setUp(self):
        self.cloud = FakeCloud()
        self.cloud.add(TUE_THU, [2, 3, 4])
        self.long_error = "OSError: " + "Cannot connect to host https://unauthorized.irobotapi.com/v1/households/" * 9
        self.assertGreater(len(self.long_error), 600)

    def test_a_failed_skip_with_a_long_error_fits_its_columns(self):
        s = skip(1, TUE_THU, 17, last_error=self.long_error[:480])
        c = ss.settle_offline(s, at(17, 9, 0))
        self.assertEqual(c.state, ss.FAILED)
        self.assertTrue(c.detail.startswith(ss.TOO_LATE))
        self.assertLessEqual(len(c.detail), 500)
        # And whatever reaches the database is cut to the column, whoever made it.
        sets, params = poller._skip_assignments(ss.Change(1, detail=self.long_error, last_error=self.long_error), at(17, 9))
        self.assertEqual([len(p) for p in params[:2]], [500, 500])

    def test_one_row_that_fails_does_not_stop_the_others(self):
        pg = FakePg(refuse={2})
        with mock.patch.object(poller.psycopg, "connect", pg), self.assertLogs("roomba-poller", "WARNING"):
            failed = poller._save_skip_changes("conninfo", [ss.Change(i, attempts=1) for i in (1, 2, 3)], at(16, 20))
        self.assertEqual(failed, {2})
        self.assertEqual([u[0] for u in pg.updates], [1, 3])

    async def test_a_long_error_end_to_end_is_stored(self):
        # The cloud read fails with a 600-character error, the clean comes, the skip FAILs.
        s = skip(1, TUE_THU, 17, attempts=3, last_error=self.long_error)
        pg = FakePg()
        with mock.patch.multiple(poller, _load_active_skips=lambda conninfo: [copy.copy(s)]), \
                mock.patch.object(poller.psycopg, "connect", pg):
            await poller._run_schedule_skips(self.cloud, "conninfo", now=at(17, 9, 1), tz=HOME, state=poller.PollerState())
        (skip_id, sql, params), = pg.updates
        self.assertIn("state = %s", sql)
        self.assertEqual(params[0], ss.FAILED)
        self.assertEqual(self.cloud.reads, 0, "settled without the cloud")

    async def test_a_row_the_database_refuses_is_held_back_from_the_cloud(self):
        state = poller.PollerState()
        s = skip(1, TUE_THU, 17)
        pg = FakePg(refuse={1})
        self.cloud.fail_reads = True
        with mock.patch.multiple(poller, _load_active_skips=lambda conninfo: [copy.copy(s)]), \
                mock.patch.object(poller.psycopg, "connect", pg), self.assertLogs("roomba-poller", "WARNING"):
            await poller._run_schedule_skips(self.cloud, "conninfo", now=at(16, 20), tz=HOME, state=state)
            self.assertEqual(self.cloud.reads, 1)
            # The retry time never reached the row: the pass 30 s on, and the one after, leave the cloud alone.
            for seconds in (30, 59):
                await poller._run_schedule_skips(self.cloud, "conninfo", now=at(16, 20) + timedelta(seconds=seconds),
                                                 tz=HOME, state=state)
            self.assertEqual(self.cloud.reads, 1)
            # After the first backoff it is tried again, and held longer when the row still fails.
            await poller._run_schedule_skips(self.cloud, "conninfo", now=at(16, 20, 1), tz=HOME, state=state)
            self.assertEqual(self.cloud.reads, 2)
        self.assertEqual(state.skip_holds[1], (at(16, 20, 3), 2))
        # The database takes it again: the hold goes with the next write.
        pg.refuse.clear()
        with mock.patch.multiple(poller, _load_active_skips=lambda conninfo: [copy.copy(s)]), \
                mock.patch.object(poller.psycopg, "connect", pg):
            await poller._run_schedule_skips(self.cloud, "conninfo", now=at(16, 20, 3), tz=HOME, state=state)
        self.assertEqual(self.cloud.reads, 3)
        self.assertNotIn(1, state.skip_holds)

    async def test_no_send_for_a_skip_whose_applying_mark_was_not_stored(self):
        state = poller.PollerState()
        pg = FakePg(refuse={1})
        with mock.patch.multiple(poller, _load_active_skips=lambda conninfo: [skip(1, TUE_THU, 17)]), \
                mock.patch.object(poller.psycopg, "connect", pg), mock.patch.object(poller, "_replace_native_schedules", lambda *a: None), \
                self.assertLogs("roomba-poller", "WARNING"):
            await poller._run_schedule_skips(self.cloud, "conninfo", now=at(16, 20), tz=HOME, state=state)
        self.assertEqual(self.cloud.writes, [])
        self.assertIn(1, state.skip_holds)


class MirrorRefresh(unittest.IsolatedAsyncioTestCase):
    """The periodic read of the robot's schedules into roomba_native_schedule (poller.py
    refresh_schedules): on start-up and every few hours, read-only, and never at the cost of
    the copy the backend already has."""

    def setUp(self):
        self.cloud = FakeCloud()
        self.cloud.add(MON_FRI, [1, 5])
        self.cloud.add(TUE_THU, [2, 3, 4], enabled=False)   # off for a skip, say
        self.table = Table()
        self.table.mirror = "last copy"
        patcher = mock.patch.object(poller, "_replace_native_schedules", self.table.replace_mirror)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.state = poller.PollerState()
        self.t = 1000.0

    async def refresh(self):
        await poller.refresh_schedules(self.cloud, "conninfo", "BLID", self.state, clock=lambda: self.t)

    async def test_it_reads_on_start_up_and_then_every_few_hours_writing_nothing_to_the_cloud(self):
        await self.refresh()
        self.assertEqual(self.cloud.reads, 1)
        self.assertEqual([(cid, o["enabled"]) for cid, o in self.table.mirror], [(MON_FRI, True), (TUE_THU, False)])
        self.t += 2 * 3600
        await self.refresh()
        self.assertEqual(self.cloud.reads, 1, "not due yet")
        self.t += 3600
        await self.refresh()
        self.assertEqual(self.cloud.reads, 2)
        self.assertEqual(self.cloud.writes, [])

    async def test_a_failed_read_keeps_the_copy_and_waits_before_the_next_try(self):
        self.cloud.fail_reads = True
        with self.assertLogs("roomba-poller", "WARNING"):
            await self.refresh()
        self.assertEqual(self.table.mirror, "last copy")
        await self.refresh()
        self.assertEqual(self.cloud.reads, 1, "never straight back to the cloud")
        self.cloud.fail_reads = False
        self.t += poller.SCHEDULES_RETRY_SECONDS
        await self.refresh()
        self.assertEqual(self.cloud.reads, 2)
        self.assertEqual(len(self.table.mirror), 2)

    async def test_an_unreadable_or_empty_answer_never_wipes_the_copy(self):
        answers = [
            {"error": "something else"},
            {"household_schedules": None},
            {"household_schedules": [{"household_schedule_id": MON_FRI, "schedules": "?"}]},
            {"household_schedules": []},
            {"household_schedules": [{"household_schedule_id": MON_FRI, "schedules": [{"schedule_id": MON_FRI}]}]},
        ]
        for answer in answers:
            async def reply(household_id, answer=answer):
                return answer

            with mock.patch.object(self.cloud, "get_schedules_raw", reply), self.assertLogs("roomba-poller", "WARNING"):
                await self.refresh()
            self.assertEqual(self.table.mirror, "last copy", answer)
            self.t += poller.SCHEDULES_REFRESH_SECONDS

    async def test_no_household_or_a_read_that_hangs_is_given_up(self):
        async def no_household():
            return None

        with mock.patch.object(self.cloud, "get_household_id", no_household), self.assertLogs("roomba-poller", "WARNING"):
            await self.refresh()
        self.assertEqual(self.table.mirror, "last copy")

        async def hangs(household_id):
            await asyncio.Event().wait()

        self.t += poller.SCHEDULES_RETRY_SECONDS
        with mock.patch.object(self.cloud, "get_schedules_raw", hangs), mock.patch.object(poller, "SCHEDULES_READ_TIMEOUT", 0.05), \
                self.assertLogs("roomba-poller", "WARNING"):
            await asyncio.wait_for(self.refresh(), 1.0)
        self.assertEqual(self.table.mirror, "last copy")

    async def test_a_skip_pass_that_reads_no_schedules_leaves_the_copy_too(self):
        table = Table()
        table.mirror = "last copy"
        table.add(skip(1, TUE_THU, 17))
        self.cloud.containers = {}
        with mock.patch.multiple(poller, _load_active_skips=table.load, _save_skip_changes=table.save,
                                 _replace_native_schedules=table.replace_mirror):
            await poller._run_schedule_skips(self.cloud, "conninfo", now=at(16, 20), tz=HOME)
        self.assertEqual(table.state(1), ss.CANCELLED)
        self.assertEqual(table.mirror, "last copy")


class MainLoopSkips(unittest.IsolatedAsyncioTestCase):
    """The main loop runs the skip check on its first good cycle, and a skip check or a schedule
    read that fails never fails the cycle: no reconnect, so no extra cloud login."""

    async def run_main(self, robot, seconds, **patches):
        logins = []

        async def connect_robot(session, email, password, country, blid, state):
            logins.append(1)
            return robot

        class Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

        async def never(*a, **k):
            await asyncio.Event().wait()

        async def nothing(*a, **k):
            return None

        fakes = dict(
            connect_robot=connect_robot, listen_for_commands=never,
            _settle_interrupted_commands=lambda conninfo: None, _settle_stale_sent=lambda conninfo, keep=None: (0, 0),
            _fetch_pending=lambda conninfo, limit=5: [], upsert_status=lambda *a, **k: None,
            detect_completion=lambda *a, **k: None, sync_device=nothing, refresh_map=nothing, refresh_parts=nothing,
            sync_history=nothing, run_live_map=nothing,
        )
        fakes.update(patches)
        env = {"IROBOT_EMAIL": "e", "IROBOT_PASSWORD": "p", "POSTGRES_PASSWORD": "x"}
        with mock.patch.multiple(poller, **fakes), mock.patch.dict(os.environ, env), \
                mock.patch.object(poller.aiohttp, "ClientSession", Session):
            task = asyncio.ensure_future(poller.main())
            await asyncio.sleep(seconds)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        return logins

    async def test_a_failing_skip_check_costs_no_login(self):
        checks = []

        async def failing_pass(robot, conninfo, now=None, tz=None, state=None):
            checks.append(1)
            raise OSError("iRobot cloud unreachable")

        logins = await self.run_main(LoopRobot(), 1.0, _run_schedule_skips=failing_pass)
        self.assertEqual(checks, [1], "checked once on the first cycle, then every SKIP_CHECK_SECONDS")
        self.assertEqual(logins, [1])

    async def test_the_first_poll_is_at_once_even_just_after_the_host_boots(self):
        # time.monotonic() counts from the host's boot: 5 s after a NUC reboot it reads ~5.
        import time as real_time
        started = real_time.monotonic()
        robot = LoopRobot()
        just_booted = types.SimpleNamespace(monotonic=lambda: 5.0 + real_time.monotonic() - started)
        with mock.patch.object(poller, "time", just_booted):
            await self.run_main(robot, 0.5, _run_schedule_skips=lambda *a, **k: asyncio.sleep(0, "nothing due"))
        self.assertGreater(robot.shadow_reads, 0, "polled on the first cycle, not POLL_INTERVAL_SECONDS after boot")

    async def test_a_schedule_read_that_fails_or_hangs_costs_no_cycle_and_no_login(self):
        for broken in ("fails", "hangs"):
            robot = LoopRobot(schedules=broken)
            checks = []

            async def skip_pass(robot, conninfo, now=None, tz=None, state=None):
                checks.append(1)
                return "nothing due"

            with mock.patch.object(poller, "SCHEDULES_READ_TIMEOUT", 0.2):
                logins = await self.run_main(robot, 1.0, _run_schedule_skips=skip_pass)
            self.assertEqual(robot.schedule_reads, 1, f"{broken}: read once at start-up, then not before the retry time")
            self.assertEqual(logins, [1], broken)
            self.assertEqual(robot.disconnects, 0, f"{broken}: the cycle carried on, the link was kept")
            self.assertEqual(checks, [1], f"{broken}: the rest of the cycle still ran")


class LoopRobot:
    """Enough of a PrimeRobot for poller.main(): the shadow answers; the schedule read works,
    fails or never answers."""

    blid = "BLID"

    class _Mqtt:
        connected = True
        generation = 1

        def seconds_until_token_refresh_due(self):
            return 1800.0

    def __init__(self, schedules="works"):
        self._mqtt = self._Mqtt()
        self.schedules = schedules
        self.schedule_reads = 0
        self.shadow_reads = 0
        self.disconnects = 0

    async def get_named_shadow(self, name, timeout=8.0):
        self.shadow_reads += 1
        return type("R", (), {"payload": {"state": {"reported": {}}}})()

    async def get_household_id(self):
        self.schedule_reads += 1
        if self.schedules == "fails":
            raise OSError("Cannot connect to host")
        if self.schedules == "hangs":
            await asyncio.Event().wait()
        return "HOUSEHOLD"

    async def get_schedules_raw(self, household_id):
        return {"household_schedules": []}

    async def disconnect(self):
        self.disconnects += 1


if __name__ == "__main__":
    unittest.main()
