"""
The dock's complaint (dock_issues.py) and how upsert_status stores it. Nov 13 2026 is the case
that started it: a scheduled vacuum-and-mop clean didn't start, the dock's light was red, and the
app said "Ready" because only dock.state (301) was decoded. Nothing here touches a network or a
database: psycopg.connect is replaced by a recorder.
"""
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import _stubs  # noqa: E402

_stubs.install()

import dock_issues  # noqa: E402
import poller  # noqa: E402

# raw->'dock' on the NUC, 2026-11-13 15:56 UTC, after the missed 9:00 AM start.
NOV13 = {"cap": {"fr": 0, "pd": 3, "pw": 1, "pwo": 1, "evac": 1}, "error": 0, "fwVer": "56",
         "known": True, "state": 301, "pdState": 701, "pwState": 671}
HEALTHY = {**NOV13, "pwState": 601}


class DockIssueTest(unittest.TestCase):
    def test_nov_13_is_the_clean_water_tank(self):
        self.assertEqual(dock_issues.dock_issue(NOV13), ("clean_water_empty", 671))

    def test_a_dock_that_is_fine_says_nothing(self):
        self.assertEqual(dock_issues.dock_issue(HEALTHY), (None, None))
        # Working and idle states: emptying the bin, washing and drying the pad, no reading yet.
        for busy in ({"state": 302}, {"state": 303}, {"pwState": 602}, {"pdState": 702},
                     {"state": 300, "pwState": 600, "pdState": 700}, {"frState": 403}, {"error": 0}):
            self.assertEqual(dock_issues.dock_issue({**HEALTHY, **busy}), (None, None), busy)

    def test_clean_and_dirty_water_are_told_apart(self):
        for code, kind in ((671, "clean_water_empty"), (651, "clean_water_empty"), (650, "clean_water_out"),
                           (672, "dirty_water_full"), (654, "dirty_water_full"), (653, "dirty_water_out"),
                           (668, "mop")):
            self.assertEqual(dock_issues.dock_issue({**HEALTHY, "pwState": code}), (kind, code))

    def test_the_bag_mop_and_refill_codes(self):
        self.assertEqual(dock_issues.dock_issue({**HEALTHY, "state": 353}), ("bag", 353))
        self.assertEqual(dock_issues.dock_issue({**HEALTHY, "state": 350}), ("bag", 350))
        self.assertEqual(dock_issues.dock_issue({**HEALTHY, "pdState": 756}), ("mop", 756))
        self.assertEqual(dock_issues.dock_issue({**HEALTHY, "frState": 451}), ("clean_water_empty", 451))

    def test_a_code_nobody_decoded_is_other_never_fine(self):
        for field, code in (("pwState", 609), ("pwState", 649), ("pdState", 717), ("state", 351),
                            ("state", 1), ("frState", 455), ("error", 46)):
            self.assertEqual(dock_issues.dock_issue({**HEALTHY, field: code}), ("other", code), (field, code))

    def test_the_dock_error_field_is_read_the_same_way(self):
        self.assertEqual(dock_issues.dock_issue({**HEALTHY, "error": 672}), ("dirty_water_full", 672))

    def test_a_decoded_complaint_wins_over_an_undecoded_one(self):
        both = {**NOV13, "pdState": 749, "error": 46}
        self.assertEqual(dock_issues.dock_issue(both), ("clean_water_empty", 671))

    def test_odd_shapes(self):
        self.assertEqual(dock_issues.dock_issue(None), (None, None))
        self.assertEqual(dock_issues.dock_issue({}), (None, None))
        self.assertEqual(dock_issues.dock_issue({"pwState": "671"}), ("clean_water_empty", 671))
        self.assertEqual(dock_issues.dock_issue({"pwState": "n/a", "pdState": True}), (None, None))


class Connection:
    """Records what upsert_status sends."""

    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))


class UpsertStatusTest(unittest.TestCase):
    def upsert(self, dock):
        conn = Connection()
        rep = {"dock": dock, "cleanMissionStatus": {"phase": "charge", "cycle": "none", "error": 0}}
        with mock.patch.object(poller.psycopg, "connect", lambda *a, **k: conn):
            poller.upsert_status("conninfo", "robot", "iRummy", rep, {}, None)
        self.assertEqual(len(conn.calls), 1)
        return conn.calls[0]

    def test_it_stores_the_complaint_and_keeps_when_it_began(self):
        sql, params = self.upsert(NOV13)
        self.assertEqual((params["dock_issue"], params["dock_issue_code"]), ("clean_water_empty", 671))
        self.assertEqual(params["dock_text"], "Ready")  # dock.state alone still reads Ready
        # The start is kept while the same complaint stands and restarted when it changes.
        self.assertIn("THEN roomba_status.dock_issue_since", sql)
        self.assertIn("ELSE EXCLUDED.dock_issue_since", sql)

    def test_a_healthy_dock_stores_none(self):
        _sql, params = self.upsert(HEALTHY)
        self.assertEqual((params["dock_issue"], params["dock_issue_code"]), (None, None))


if __name__ == "__main__":
    unittest.main()
