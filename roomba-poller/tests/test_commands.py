"""
The command path in poller.py (CommandRunner, CloudLink, the NOTIFY listener), driven
against a fake robot behind a fake cloud and a fake command queue. Each connection the
poller opens is a new FakeRobot, so a test can make one connection a "zombie" (the broker
confirms, the robot never hears it), refuse to confirm, or stop answering reads, and then
check the poller's next move. Time is a fake clock; nothing touches a network or database.
"""
import asyncio
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import _stubs  # noqa: E402

_stubs.install()

import command_flow as cf  # noqa: E402
import poller  # noqa: E402


def rep(phase, cycle="none", mission="M1"):
    return {"cleanMissionStatus": {"phase": phase, "cycle": cycle, "missionId": mission}, "batPct": 80}


# What each command does to a robot that receives it: (phase, cycle, mission) -> new.
EFFECT = {
    "pause": lambda s: ("stop", s[1], s[2]),
    "resume": lambda s: ("run", s[1], s[2]),
    "stop": lambda s: ("stop", "none", s[2]),
    "dock": lambda s: ("hmUsrDock", s[1], s[2]),
    "start": lambda s: ("run", "clean", "M2"),
    "evac": lambda s: ("evac", "evac", s[2]),
}


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


class Reply:
    def __init__(self, reported):
        self.payload = {"state": {"reported": reported}}


class FakeMqtt:
    """The bits of roombapy_prime's PrimeMqttClient the poller reads."""

    def __init__(self):
        self.connected = True
        self.generation = 1
        self.refresh_due = 1800.0

    def seconds_until_token_refresh_due(self):
        return self.refresh_due


class World:
    """The robot behind the cloud, and how each connection to it (1, 2, ...) behaves."""

    def __init__(self, clock, state):
        self.clock = clock
        self.state = state
        self.react_after = 0.0   # how long a received command takes to show in the shadow
        self.pending = None
        self.robots = []
        self.sends = []          # (connection, command)
        self.reads = 0
        self.zombie = set()      # the broker confirms; the robot never hears it
        self.no_puback = set()   # the broker doesn't confirm
        self.dead_reads = set()  # shadow reads time out

    def current(self):
        if self.pending and self.clock() >= self.pending[0]:
            self.state, self.pending = self.pending[1], None
        return rep(*self.state)

    def deliver(self, command):
        effect = EFFECT.get(command)
        if effect:
            self.pending = (self.clock() + self.react_after, effect(self.state))


class FakeRobot:
    def __init__(self, world):
        world.robots.append(self)
        self.index = len(world.robots)
        self.world = world
        self.blid = "BLID"
        self._mqtt = FakeMqtt()
        self.disconnected = False

    async def get_named_shadow(self, name, timeout=8.0):
        self.world.reads += 1
        if self.index in self.world.dead_reads:
            raise TimeoutError("No response to GET")
        if name == "ro-currentstate":
            return Reply(self.world.current())
        return Reply({"bbmssn": {"nMssn": 50}})

    async def send_simple_command(self, command):
        self.world.sends.append((self.index, command))
        if self.index in self.world.no_puback:
            return False
        if self.index not in self.world.zombie:
            self.world.deliver(command)
        return True

    async def get_active_map_versions(self):
        return [{"p2map_id": "MAP1"}]

    async def disconnect(self):
        self.disconnected = True


class Queue:
    """roomba_commands, in memory."""

    def __init__(self):
        self.rows = {}
        self.status_writes = 0

    def add(self, command, arg=None):
        cmd_id = len(self.rows) + 1
        self.rows[cmd_id] = {"command": command, "arg": arg, "status": "PENDING", "detail": None, "sent": False}
        return cmd_id

    def fetch_pending(self, conninfo, limit=5):
        return [(i, r["command"], r["arg"], 25.0)
                for i, r in sorted(self.rows.items()) if r["status"] == "PENDING"][:limit]

    def mark(self, conninfo, cmd_id, status, detail=None, terminal=True):
        self.rows[cmd_id]["status"] = status
        if terminal:
            self.rows[cmd_id]["detail"] = detail

    def mark_sent(self, conninfo, cmd_id, detail):
        self.rows[cmd_id].update(detail=detail, sent=True)

    def finish(self, conninfo, cmd_id, status, detail):
        self.rows[cmd_id].update(status=status, detail=detail)

    def upsert_status(self, *args, **kwargs):
        self.status_writes += 1


class CommandPath(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = Clock()
        self.queue = Queue()
        self.state = poller.PollerState()
        self.world = World(self.clock, ("run", "clean", "M1"))

        async def connect_robot(session, email, password, country, blid, state):
            return FakeRobot(self.world)

        patcher = mock.patch.multiple(
            poller,
            connect_robot=connect_robot,
            _fetch_pending=self.queue.fetch_pending,
            _mark_command=self.queue.mark,
            _mark_sent=self.queue.mark_sent,
            _finish_command=self.queue.finish,
            upsert_status=self.queue.upsert_status,
            detect_completion=lambda state, rep, conninfo: None,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.link = poller.CloudLink(None, ("e", "p", "US", None), self.state, clock=self.clock)
        self.runner = poller.CommandRunner(self.link, "conninfo", self.state, clock=self.clock)
        await self.link.ensure()

    async def poll(self):
        """What poll_once does to the link: read the live state and the stats."""
        await self.link.robot.get_named_shadow("ro-currentstate")
        await self.link.robot.get_named_shadow("ro-stats")

    async def run_for(self, seconds, step=0.25):
        """The main loop's follow-up checks, with the fake clock running."""
        end = self.clock.t + seconds
        while self.clock.t < end:
            await self.runner.run_followup_if_due()
            self.clock.advance(step)

    async def send(self, command):
        cmd_id = self.queue.add(command)
        await self.runner.run_pending("notify")
        return self.queue.rows[cmd_id]

    # --- the link -----------------------------------------------------------
    async def test_a_freshly_proven_link_sends_at_once_and_confirms_on_the_reaction(self):
        await self.poll()
        self.clock.advance(3)
        reads = self.world.reads
        row = await self.send("pause")
        self.assertEqual(self.world.reads, reads, "no extra round trip before the send")
        self.assertEqual(self.world.sends, [(1, "pause")], "sent on the first connection: no reconnect")
        self.assertEqual(row["status"], "SENT", "waits for the robot to react")
        self.assertTrue(row["sent"])
        writes = self.queue.status_writes
        await self.run_for(1.5)
        self.assertEqual(row["status"], "OK")
        self.assertIn("the robot reacted 1.0 s after it was sent", row["detail"])
        self.assertIsNone(self.runner.followup)
        self.assertGreater(self.queue.status_writes, writes, "the read-back updates the status row")
        self.assertEqual(len(self.world.robots), 1)

    async def test_a_stale_link_proves_itself_with_one_read(self):
        await self.poll()
        self.clock.advance(cf.LINK_FRESH_SECONDS + 5)
        reads = self.world.reads
        await self.send("pause")
        self.assertEqual(self.world.reads, reads + 1)
        self.assertEqual(self.world.sends, [(1, "pause")])
        self.assertEqual(len(self.world.robots), 1)

    async def test_a_token_due_for_refresh_means_a_read_first(self):
        await self.poll()
        self.world.robots[0]._mqtt.refresh_due = 0.0
        reads = self.world.reads
        await self.send("pause")
        self.assertEqual(self.world.reads, reads + 1)

    async def test_a_link_that_does_not_answer_is_rebuilt_before_sending(self):
        self.world.dead_reads = {1}
        row = await self.send("pause")
        self.assertEqual(len(self.world.robots), 2)
        self.assertTrue(self.world.robots[0].disconnected)
        self.assertEqual(self.world.sends, [(2, "pause")])
        self.assertEqual(row["status"], "SENT")
        await self.run_for(1.5)
        self.assertEqual(row["status"], "OK")

    async def test_without_any_readable_state_it_still_sends_on_the_brokers_word(self):
        self.world.dead_reads = {1, 2}
        row = await self.send("pause")
        self.assertEqual(self.world.sends, [(2, "pause")])
        self.assertEqual((row["status"], row["detail"]), ("OK", "accepted by broker"))

    async def test_an_unknown_library_shape_means_a_read_never_a_blind_send(self):
        await self.poll()
        del self.world.robots[0]._mqtt
        decision, _why = cf.link_decision(self.clock(), **self.link.facts())
        self.assertEqual(decision, cf.PROBE)

    # --- the safety net -----------------------------------------------------
    async def test_a_reaction_within_the_window_is_not_resent(self):
        await self.poll()
        self.world.react_after = 7.0
        row = await self.send("pause")
        await self.run_for(9)
        self.assertEqual(row["status"], "OK")
        self.assertEqual(self.world.sends, [(1, "pause")])
        self.assertEqual(len(self.world.robots), 1)

    async def test_a_zombie_link_gets_the_pause_through_on_a_rebuilt_link(self):
        self.world.zombie = {1}
        await self.poll()
        row = await self.send("pause")
        await self.run_for(cf.VERIFY_CHECKS[-1] + 0.5)
        self.assertEqual(self.world.sends, [(1, "pause"), (2, "pause")])
        self.assertTrue(self.world.robots[0].disconnected)
        await self.run_for(2)
        self.assertEqual(row["status"], "OK")
        self.assertIn("after it was sent again", row["detail"])

    async def test_a_zombie_link_never_gets_a_second_start_and_says_why(self):
        self.world.state = ("charge", "none", "M1")
        self.world.zombie = {1}
        await self.poll()
        row = await self.send("start")
        self.assertEqual(row["status"], "SENT")
        await self.run_for(cf.VERIFY_CHECKS[-1] + 2)
        self.assertEqual(row["status"], "SENT", "a start gets longer to show before it's called failed")
        await self.run_for(cf.START_VERIFY_CHECKS[-1] - cf.VERIFY_CHECKS[-1])
        self.assertEqual(self.world.sends, [(1, "start")])
        self.assertEqual(len(self.world.robots), 2, "rebuilt, so a retry goes out on a fresh link")
        self.assertEqual(row["status"], "FAILED")
        self.assertIn("wasn't sent again automatically", row["detail"])

    async def test_a_robot_that_ignores_the_second_send_too_fails_the_command(self):
        self.world.zombie = {1, 2}
        await self.poll()
        row = await self.send("dock")
        await self.run_for(2 * cf.VERIFY_CHECKS[-1] + 3)
        self.assertEqual(self.world.sends, [(1, "dock"), (2, "dock")])
        self.assertEqual(row["status"], "FAILED")
        self.assertIn("even after reconnecting and sending it again", row["detail"])
        self.assertEqual(len(self.world.robots), 2, "no reconnect loop")

    async def test_an_unconfirmed_dock_is_sent_again_on_a_new_link(self):
        self.world.no_puback = {1}
        await self.poll()
        row = await self.send("dock")
        self.assertEqual(self.world.sends, [(1, "dock"), (2, "dock")])
        self.assertEqual(row["status"], "SENT")
        await self.run_for(1.5)
        self.assertEqual(row["status"], "OK")

    async def test_an_unconfirmed_start_fails_without_a_second_send(self):
        self.world.state = ("charge", "none", "M1")
        self.world.no_puback = {1}
        await self.poll()
        row = await self.send("start")
        self.assertEqual(self.world.sends, [(1, "start")])
        self.assertEqual(len(self.world.robots), 2)
        self.assertEqual(row["status"], "FAILED")
        self.assertIn("didn't confirm", row["detail"])

    async def test_a_newer_command_supersedes_the_check_and_the_older_one_is_never_resent(self):
        self.world.react_after = 100.0
        await self.poll()
        pause = await self.send("pause")
        self.clock.advance(1)
        dock = await self.send("dock")
        self.assertEqual(pause["status"], "OK")
        self.assertIn("#2 followed", pause["detail"])
        self.assertEqual(self.runner.followup.cmd_id, 2)
        self.assertEqual(dock["status"], "SENT")
        await self.run_for(cf.VERIFY_CHECKS[-1] + 2)
        self.assertNotIn((2, "pause"), self.world.sends)

    # --- commands with nothing to verify ------------------------------------
    async def test_find_is_ok_at_once_and_not_followed(self):
        self.world.state = ("charge", "none", "M1")
        await self.poll()
        row = await self.send("find")
        self.assertEqual((row["status"], row["detail"]), ("OK", "accepted by broker"))
        self.assertIsNone(self.runner.followup)

    async def test_a_paused_robots_stop_is_ok_at_once_and_only_read_back(self):
        self.world.state = ("stop", "clean", "M1")
        await self.poll()
        row = await self.send("stop")
        self.assertEqual(row["status"], "OK")
        self.assertFalse(self.runner.followup.verify)
        reads = self.world.reads
        await self.run_for(cf.FOLLOW_CHECKS[-1] + 1)
        self.assertIsNone(self.runner.followup)
        self.assertGreater(self.world.reads, reads)
        self.assertEqual(row["status"], "OK")

    async def test_map_edits_and_schedule_reads_skip_the_link_check(self):
        self.world.dead_reads = {1}

        async def rename(robot, conninfo, arg, state):
            return True, "applied"

        with mock.patch.object(poller, "_rename_room", rename):
            row = await self.send("rename_room")
        self.assertEqual((row["status"], row["detail"]), ("OK", "applied"))
        self.assertEqual(self.world.reads, 0)
        self.assertEqual(len(self.world.robots), 1)

    async def test_a_mission_start_turns_on_fast_polling(self):
        self.world.state = ("charge", "none", "M1")
        await self.poll()
        await self.send("start")
        self.assertGreater(self.state.fast_poll_until, 0)

    # --- the link wrapper ---------------------------------------------------
    async def test_tracked_robot_passes_everything_through_and_notes_each_answer(self):
        robot = self.link.robot
        self.assertEqual(robot.blid, "BLID")
        self.assertEqual(await robot.get_active_map_versions(), [{"p2map_id": "MAP1"}])
        self.assertIsNone(getattr(robot, "name", None))
        self.assertIsNone(self.link.monitor.ok_at)
        await robot.get_named_shadow("ro-currentstate")
        raw = self.world.robots[0]
        self.assertEqual(self.link.monitor.ok_at, self.clock())
        self.assertEqual(self.link.monitor.ok_link, (id(raw._mqtt), 1))
        self.assertEqual(self.link.monitor.last_rep, rep("run", "clean", "M1"))
        await robot.get_named_shadow("ro-stats")
        self.assertEqual(self.link.monitor.last_stats, {"bbmssn": {"nMssn": 50}})

    async def test_a_reconnect_forgets_the_old_links_proof_but_keeps_the_stats(self):
        await self.poll()
        await self.link.reconnect("test")
        self.assertIsNone(self.link.monitor.ok_at)
        self.assertIsNone(self.link.monitor.last_rep)
        self.assertIsNotNone(self.link.monitor.last_stats)
        self.assertTrue(self.link.poll_now)


class FakeConn:
    """A psycopg AsyncConnection, as far as the listener uses one."""

    def __init__(self, fail=False):
        self.handlers = []
        self.executed = []
        self.fail = fail
        self.go = asyncio.Event()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def add_notify_handler(self, callback):
        self.handlers.append(callback)

    async def execute(self, sql):
        self.executed.append(sql)

    async def notifies(self, timeout=None):
        if self.fail:
            raise OSError("server closed the connection unexpectedly")
        try:
            await asyncio.wait_for(self.go.wait(), timeout)
        except (asyncio.TimeoutError, TimeoutError):
            return
        self.go.clear()
        yield "notification"


class Listener(unittest.IsolatedAsyncioTestCase):
    async def test_it_survives_failures_and_wakes_the_loop_on_a_notification(self):
        wake = asyncio.Event()
        good = FakeConn()
        script = [OSError("connection refused"), FakeConn(fail=True), good]
        calls = []

        async def connect():
            calls.append(1)
            item = script.pop(0) if script else FakeConn()
            if isinstance(item, Exception):
                raise item
            return item

        task = asyncio.ensure_future(poller.listen_for_commands(
            "conninfo", wake, idle_check=0.05, first_backoff=0.01, max_backoff=0.02, connect=connect))
        try:
            for _ in range(200):
                if "LISTEN roomba_commands" in good.executed:
                    break
                await asyncio.sleep(0.01)
            self.assertIn("LISTEN roomba_commands", good.executed)
            self.assertEqual(len(calls), 3)
            self.assertTrue(wake.is_set(), "a (re)connect wakes the loop for anything queued meanwhile")
            wake.clear()
            good.go.set()
            await asyncio.wait_for(wake.wait(), 1.0)
            # Quiet periods are checked with a cheap query, and the listener keeps going.
            for _ in range(100):
                if "SELECT 1" in good.executed:
                    break
                await asyncio.sleep(0.01)
            self.assertIn("SELECT 1", good.executed)
            self.assertFalse(task.done())
        finally:
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_a_notification_seen_by_the_handler_also_wakes_the_loop(self):
        wake = asyncio.Event()
        conn = FakeConn()

        async def connect():
            return conn

        task = asyncio.ensure_future(poller.listen_for_commands("conninfo", wake, idle_check=0.05, connect=connect))
        try:
            for _ in range(100):
                if conn.handlers:
                    break
                await asyncio.sleep(0.01)
            wake.clear()
            conn.handlers[0]("notification")
            self.assertTrue(wake.is_set())
        finally:
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task


class Sleep(unittest.IsolatedAsyncioTestCase):
    async def test_says_what_ended_the_sleep(self):
        wake = asyncio.Event()
        self.assertEqual(await poller._sleep_until_woken(wake, 0.01), "tick")
        wake.set()
        self.assertEqual(await poller._sleep_until_woken(wake, 5), "busy")
        wake.clear()
        asyncio.get_running_loop().call_later(0.01, wake.set)
        self.assertEqual(await poller._sleep_until_woken(wake, 5), "notify")


class FakeDb:
    def __init__(self):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        return mock.Mock(rowcount=1)


class Settle(unittest.TestCase):
    def test_rows_left_sent_by_a_previous_run_are_settled(self):
        db = FakeDb()
        with mock.patch.object(poller.psycopg, "connect", lambda *a, **k: db):
            poller._settle_interrupted_commands("conninfo")
        (checked, _), (lost, _) = db.statements
        self.assertIn("SET status = 'OK'", checked)
        self.assertIn("processed_at IS NOT NULL", checked)
        self.assertIn("SET status = 'FAILED'", lost)
        self.assertIn("processed_at IS NULL", lost)

    def test_a_database_problem_does_not_stop_start_up(self):
        def broken(*a, **k):
            raise RuntimeError("relation roomba_commands does not exist")

        with mock.patch.object(poller.psycopg, "connect", broken):
            poller._settle_interrupted_commands("conninfo")


if __name__ == "__main__":
    unittest.main()
