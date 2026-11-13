"""
The live-position stream's writes (poller.py LivePositionWriter, run_live_map) and when the
stream runs. The row it keeps is where the map says the robot was last seen, so the last
sample before the robot stops must be the one stored, never one from a second earlier.
Nothing touches a network or database: upsert_position is replaced by a list.
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import _stubs  # noqa: E402

_stubs.install()

import poller  # noqa: E402


def cms(phase, mission="M1", cycle="clean"):
    return {"phase": phase, "missionId": mission, "cycle": cycle}


class WhenTheStreamRunsTest(unittest.TestCase):
    def test_it_runs_through_a_mission_and_the_trip_home_after_it(self):
        for phase in ("run", "stuck", "evac", "hmMidMsn", "hmUsrDock", "hmPostMsn", "pause"):
            self.assertTrue(poller._wants_live_position(cms(phase)), phase)

    def test_it_stops_on_the_dock_when_stopped_and_without_a_mission(self):
        for phase in ("charge", "stop"):
            self.assertFalse(poller._wants_live_position(cms(phase)), phase)
        self.assertFalse(poller._wants_live_position(cms("hmPostMsn", mission=None)))
        self.assertFalse(poller._wants_live_position({}))

    def test_the_run_still_ends_as_it_heads_home(self):
        # Only the stream follows the robot home; the mission's end is unchanged.
        self.assertIn("hmPostMsn", poller.TERMINAL_PHASES)


class Writes:
    """Stands in for upsert_position: keeps (x, y, theta, seen_at) in order."""

    def __init__(self, fail=0):
        self.rows = []
        self.fail = fail

    def __call__(self, conninfo, robot_id, x, y, theta, seen_at=None):
        if self.fail:
            self.fail -= 1
            raise RuntimeError("database restarting")
        self.rows.append((x, y, theta, seen_at))

    @property
    def points(self):
        return [(x, y) for x, y, _theta, _at in self.rows]


class LivePositionWriterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.writes = Writes()
        patcher = mock.patch.object(poller, "upsert_position", self.writes)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def settle(self):
        for _ in range(5):
            await asyncio.sleep(0.01)

    async def test_the_first_sample_is_written_at_once_and_the_newest_one_when_the_second_is_up(self):
        w = poller.LivePositionWriter("conninfo", "BLID", interval=0.2)
        w.offer(1.0, 1.0, 0.1)
        await self.settle()
        self.assertEqual(self.writes.points, [(1.0, 1.0)])
        w.offer(1.1, 1.0, 0.1)
        w.offer(1.2, 1.0, 0.1)   # the robot stops here
        await self.settle()
        self.assertEqual(self.writes.points, [(1.0, 1.0)])  # still inside the interval
        await asyncio.sleep(0.25)
        # Held, not dropped: the stop point is stored without another sample arriving.
        self.assertEqual(self.writes.points, [(1.0, 1.0), (1.2, 1.0)])

    async def test_each_row_carries_when_its_sample_arrived(self):
        w = poller.LivePositionWriter("conninfo", "BLID", interval=0.2)
        before = datetime.now(timezone.utc)
        w.offer(1.0, 1.0, 0.1)
        w.offer(2.0, 2.0, 0.2)
        after = datetime.now(timezone.utc)
        await w.close()
        (_x, _y, _t, seen_at), = self.writes.rows
        self.assertTrue(before <= seen_at <= after)

    async def test_closing_writes_what_is_held_without_waiting_out_the_interval(self):
        w = poller.LivePositionWriter("conninfo", "BLID", interval=60.0)
        w.offer(1.0, 1.0, 0.1)
        await self.settle()
        w.offer(3.0, 4.0, 0.5)
        await asyncio.wait_for(w.close(), 1.0)
        self.assertEqual(self.writes.points, [(1.0, 1.0), (3.0, 4.0)])

    async def test_a_failed_write_is_tried_again_at_the_close(self):
        self.writes.fail = 1
        w = poller.LivePositionWriter("conninfo", "BLID", interval=60.0)
        with self.assertLogs("roomba-poller", "WARNING"):
            w.offer(5.0, 6.0, 0.0)
            await self.settle()
        self.assertEqual(self.writes.points, [])
        await w.close()
        self.assertEqual(self.writes.points, [(5.0, 6.0)])

    async def test_nothing_held_means_nothing_written_at_the_close(self):
        w = poller.LivePositionWriter("conninfo", "BLID", interval=60.0)
        await w.close()
        self.assertEqual(self.writes.rows, [])


class Sample:
    def __init__(self, x, y, theta=0.0, modes=2):
        self.point = (x, y)
        self.orientation = theta
        self.operating_modes = modes


def position(*points):
    msg = poller.PositionUpdateMessage.__new__(poller.PositionUpdateMessage)
    msg.updates = [Sample(x, y) for x, y in points]
    return msg


class Robot:
    """watch_live_map(): the given messages a few milliseconds apart (well inside one
    throttle interval), then silence until the stream is cancelled (a robot that has
    stopped sends nothing more)."""

    def __init__(self, *messages):
        self.messages = messages
        self.sent_all = asyncio.Event()

    async def messages_apart(self):
        for m in self.messages:
            yield m
            await asyncio.sleep(0.01)

    async def watch_live_map(self):
        async for m in self.messages_apart():
            yield m
        self.sent_all.set()
        await asyncio.Event().wait()


class RunLiveMapTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.writes = Writes()
        for name, value in (("upsert_position", self.writes), ("LIVE_WRITE_MIN_INTERVAL", 60.0)):
            patcher = mock.patch.object(poller, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def test_the_last_sample_before_the_stream_stops_is_the_one_stored(self):
        # Three messages inside one throttle interval, then the robot stops (stuck, paused,
        # battery flat) and the poller stops the stream: the stop point is what's left.
        robot = Robot(position((0.0, 0.0)), position((0.5, 0.0), (0.6, 0.1)), position((0.7, 0.2)))
        task = asyncio.ensure_future(poller.run_live_map(robot, "conninfo", "BLID"))
        await asyncio.wait_for(robot.sent_all.wait(), 1.0)
        await poller._cancel_live_task(task)
        self.assertEqual(self.writes.points, [(0.0, 0.0), (0.7, 0.2)])

    async def test_a_stream_that_ends_on_its_own_stores_its_last_sample_too(self):
        class Ends(Robot):
            async def watch_live_map(self):
                async for m in self.messages_apart():
                    yield m

        robot = Ends(position((1.0, 1.0)), position((2.0, 2.0)))
        await asyncio.wait_for(poller.run_live_map(robot, "conninfo", "BLID"), 1.0)
        self.assertEqual(self.writes.points, [(1.0, 1.0), (2.0, 2.0)])


if __name__ == "__main__":
    unittest.main()
