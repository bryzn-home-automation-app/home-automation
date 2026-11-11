"""The pure command rules (command_flow.py): when the link may be trusted, what counts as
the robot reacting, when a command may be sent twice, how long the loop sleeps."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import command_flow as cf  # noqa: E402


def rep(phase, cycle="none", mission="M1", **extra):
    cms = {"phase": phase, "cycle": cycle, "missionId": mission}
    cms.update(extra)
    return {"cleanMissionStatus": cms, "batPct": 80}


LINK = (1, 3)


def decide(now=100.0, **over):
    facts = {
        "connected": True, "link_id": LINK, "last_ok_at": 95.0, "last_ok_link": LINK,
        "refresh_due_in": 1800.0, "have_state": True,
    }
    facts.update(over)
    return cf.link_decision(now, **facts)


class LinkDecision(unittest.TestCase):
    def test_a_recent_round_trip_on_this_link_is_proof(self):
        decision, why = decide()
        self.assertEqual(decision, cf.FRESH)
        self.assertIn("5.0s ago", why)

    def test_no_round_trip_yet_means_probe(self):
        self.assertEqual(decide(last_ok_at=None, last_ok_link=None)[0], cf.PROBE)

    def test_a_round_trip_on_an_older_connection_does_not_count(self):
        self.assertEqual(decide(last_ok_link=(1, 2))[0], cf.PROBE)
        self.assertEqual(decide(last_ok_link=(9, 3))[0], cf.PROBE)

    def test_a_stale_round_trip_means_probe(self):
        self.assertEqual(decide(now=95.0 + cf.LINK_FRESH_SECONDS + 0.1)[0], cf.PROBE)
        self.assertEqual(decide(now=95.0 + cf.LINK_FRESH_SECONDS)[0], cf.FRESH)

    def test_down_or_unknown_connection_means_probe(self):
        self.assertEqual(decide(connected=False)[0], cf.PROBE)
        self.assertEqual(decide(connected=None)[0], cf.PROBE)
        self.assertEqual(decide(link_id=None)[0], cf.PROBE)

    def test_a_token_due_for_refresh_means_probe(self):
        self.assertEqual(decide(refresh_due_in=0.0)[0], cf.PROBE)
        # Unknown expiry is not a reason by itself: the round trip still proves the link.
        self.assertEqual(decide(refresh_due_in=None)[0], cf.FRESH)

    def test_no_robot_state_at_hand_means_probe(self):
        # The baseline a reaction is judged against comes from that read.
        self.assertEqual(decide(have_state=False)[0], cf.PROBE)


class Reaction(unittest.TestCase):
    def test_signature_is_phase_cycle_mission(self):
        self.assertEqual(cf.mission_signature(rep("run", "clean", "M2")), ("run", "clean", "M2"))
        self.assertIsNone(cf.mission_signature(None))
        self.assertIsNone(cf.mission_signature({"batPct": 3}))

    def test_any_move_counts_as_a_reaction(self):
        base = cf.mission_signature(rep("run", "clean"))
        self.assertFalse(cf.robot_reacted(base, rep("run", "clean")))
        self.assertTrue(cf.robot_reacted(base, rep("stop", "clean")))
        self.assertTrue(cf.robot_reacted(base, rep("run", "clean", "M9")))
        # Battery alone is not a reaction; nothing to compare is never one.
        self.assertFalse(cf.robot_reacted(base, {"cleanMissionStatus": {"phase": "run", "cycle": "clean", "missionId": "M1"}, "batPct": 10}))
        self.assertFalse(cf.robot_reacted(None, rep("stop")))
        self.assertFalse(cf.robot_reacted(base, None))

    def test_expected_only_where_the_state_must_move(self):
        cases = [
            ("pause", rep("run", "clean"), True),
            ("pause", rep("stop", "clean"), False),        # already paused
            ("pause", rep("charge", "clean"), False),      # recharging mid-clean: not certain
            ("stop", rep("run", "clean"), True),
            ("stop", rep("stop", "clean"), False),         # paused: not certain what moves
            ("resume", rep("stop", "clean"), True),
            ("resume", rep("pause", "clean"), True),
            ("resume", rep("stop", "none"), False),        # nothing to resume
            ("resume", rep("run", "clean"), False),
            ("dock", rep("run", "clean"), True),
            ("dock", rep("stop", "clean"), True),          # paused mid-clean
            ("dock", rep("charge", "none"), False),        # already home
            ("dock", rep("hmUsrDock", "clean"), False),    # already heading home
            ("dock", rep("stop", "none"), False),          # idle off the dock: not certain
            ("start", rep("charge", "none"), True),
            ("start", rep("stop", "none"), True),
            ("start", rep("run", "clean"), False),         # a clean is under way
            ("start", rep("charge", "clean"), False),      # recharging mid-clean
            ("clean_room", rep("charge", "none"), True),
            ("clean_rooms", rep("charge", "none"), True),
            ("find", rep("charge", "none"), False),
            ("evac", rep("charge", "none"), False),
            ("favorite", rep("charge", "none"), False),
            ("pause", None, False),                        # no baseline: trust the PUBACK
        ]
        for command, before, expected in cases:
            with self.subTest(command=command, before=before):
                self.assertEqual(cf.reaction_expected(command, before), expected)

    def test_phase_case_does_not_matter(self):
        self.assertTrue(cf.reaction_expected("pause", rep("RUN", "clean")))

    def test_hint_names_what_the_robot_reports(self):
        self.assertEqual(cf.no_reaction_hint(rep("charge", error=1010), "Couldn't reach its dock"),
                         "the robot reports error 1010: Couldn't reach its dock")
        self.assertEqual(cf.no_reaction_hint(rep("charge", notReady=7)), "the robot reports it isn't ready (code 7)")
        self.assertEqual(cf.no_reaction_hint(rep("charge")), "")
        self.assertEqual(cf.no_reaction_hint(None), "")

    def test_failure_reasons_read_on_after_the_ui_prefix(self):
        self.assertIn("even after reconnecting and sending it again", cf.no_reaction_detail("pause", 2))
        start = cf.no_reaction_detail("start", 1, "the robot reports it isn't ready (code 7)")
        self.assertIn("within 30 s", start)
        self.assertIn("wasn't sent again automatically", start)
        self.assertTrue(start.endswith("(the robot reports it isn't ready (code 7))"))
        self.assertIn("within 16 s", cf.no_reaction_detail("dock", 1))


class Resending(unittest.TestCase):
    def test_only_state_asking_commands_are_resent(self):
        for c in ("pause", "resume", "stop", "dock", "find"):
            self.assertIn(c, cf.RESEND_SAFE)
        # A second start could begin another clean if the first arrived late.
        for c in ("start", "clean_room", "clean_rooms", "favorite", "evac"):
            self.assertNotIn(c, cf.RESEND_SAFE)


def follow(command="pause", verify=True, base=rep("run", "clean"), sent_at=10.0):
    timing = cf.CommandTiming(seen_at=9.9)
    return cf.FollowUp(cmd_id=1, command=command, arg=None, baseline=cf.mission_signature(base),
                       verify=verify, sent_at=sent_at, timing=timing)


class FollowUps(unittest.TestCase):
    def test_checks_follow_the_schedule(self):
        fu = follow()
        times = []
        while fu.next_check_at() is not None:
            times.append(round(fu.next_check_at() - fu.sent_at, 3))
            fu.checks_done += 1
        self.assertEqual(tuple(times), cf.VERIFY_CHECKS)
        self.assertEqual(follow(verify=False).schedule, cf.FOLLOW_CHECKS)

    def test_a_move_confirms_at_once(self):
        fu = follow()
        self.assertEqual(fu.after_check(rep("run", "clean")), cf.WAIT)
        self.assertEqual(fu.after_check(rep("stop", "clean")), cf.CONFIRMED)

    def test_failed_reads_count_as_checks_with_nothing_seen(self):
        fu = follow()
        self.assertEqual(fu.after_check(None), cf.WAIT)
        self.assertEqual(fu.checks_done, 1)

    def test_silence_then_resend_for_a_safe_command(self):
        fu = follow("pause")
        actions = [fu.after_check(rep("run", "clean")) for _ in cf.VERIFY_CHECKS]
        self.assertEqual(actions[:-1], [cf.WAIT] * (len(cf.VERIFY_CHECKS) - 1))
        self.assertEqual(actions[-1], cf.RESEND)

    def test_silence_after_the_resend_is_a_failure(self):
        fu = follow("dock")
        for _ in cf.VERIFY_CHECKS:
            fu.after_check(rep("run", "clean"))
        fu.resent(40.0, cf.mission_signature(rep("run", "clean")))
        self.assertEqual((fu.attempt, fu.checks_done, fu.sent_at), (2, 0, 40.0))
        actions = [fu.after_check(rep("run", "clean")) for _ in cf.VERIFY_CHECKS]
        self.assertEqual(actions[-1], cf.NO_REACTION)

    def test_a_start_is_never_resent_and_gets_longer_to_show(self):
        fu = follow("start", base=rep("charge", "none"))
        self.assertEqual(fu.schedule, cf.START_VERIFY_CHECKS)
        self.assertEqual(cf.START_VERIFY_CHECKS[-1], 30.0)
        actions = [fu.after_check(rep("charge", "none")) for _ in cf.START_VERIFY_CHECKS]
        self.assertEqual(actions[:-1], [cf.WAIT] * (len(cf.START_VERIFY_CHECKS) - 1))
        self.assertEqual(actions[-1], cf.NO_REACTION)

    def test_resent_keeps_the_old_baseline_when_none_was_read(self):
        fu = follow()
        before = fu.baseline
        fu.resent(50.0, None)
        self.assertEqual(fu.baseline, before)

    def test_unverified_follow_up_just_ends(self):
        fu = follow("evac", verify=False, base=rep("charge", "none"))
        actions = [fu.after_check(rep("charge", "none")) for _ in cf.FOLLOW_CHECKS]
        self.assertEqual(actions[-1], cf.DONE)
        fu = follow("evac", verify=False, base=rep("charge", "none"))
        self.assertEqual(fu.after_check(rep("evac", "evac")), cf.CONFIRMED)

    def test_no_baseline_never_confirms_and_never_resends(self):
        fu = cf.FollowUp(cmd_id=1, command="pause", arg=None, baseline=None, verify=False,
                         sent_at=0.0, timing=cf.CommandTiming(seen_at=0.0))
        actions = [fu.after_check(rep("stop", "clean")) for _ in cf.FOLLOW_CHECKS]
        self.assertEqual(actions[-1], cf.DONE)
        self.assertNotIn(cf.CONFIRMED, actions)


class Loop(unittest.TestCase):
    def test_sleeps_until_the_tick(self):
        self.assertEqual(cf.loop_sleep(100.0), cf.CMD_TICK_SECONDS)

    def test_wakes_for_an_earlier_check(self):
        self.assertAlmostEqual(cf.loop_sleep(100.0, next_check=101.5), 1.5)
        self.assertEqual(cf.loop_sleep(100.0, next_check=200.0), cf.CMD_TICK_SECONDS)

    def test_an_overdue_check_means_no_sleep(self):
        self.assertEqual(cf.loop_sleep(100.0, next_check=99.0), 0.0)


class Timings(unittest.TestCase):
    def test_line_has_every_stage(self):
        t = cf.CommandTiming(seen_at=10.0, queued_ms=420.0, woke="notify", link="fresh, round trip 3.1s ago")
        t.sent_at = 10.16
        t.done_at = 12.46
        line = cf.timing_line(47, "dock", t, "confirmed")
        self.assertIn("command #47 (dock) confirmed", line)
        self.assertIn("queued->seen 420 ms [notify]", line)
        self.assertIn("seen->sent 160 ms [link fresh, round trip 3.1s ago]", line)
        self.assertIn("sent->confirmed 2300 ms", line)
        self.assertIn("total 2880 ms", line)

    def test_a_failure_is_not_called_a_confirmation(self):
        t = cf.CommandTiming(seen_at=10.0, queued_ms=100.0)
        t.sent_at = 10.1
        t.done_at = 42.1
        line = cf.timing_line(5, "dock", t, "failed (the robot didn't react)")
        self.assertIn("sent->failed 32000 ms", line)
        self.assertNotIn("confirmed", line)

    def test_line_before_anything_was_sent(self):
        t = cf.CommandTiming(seen_at=10.0, queued_ms=None, link="reconnected in 1650 ms")
        line = cf.timing_line(3, "start", t, "failed (x)")
        self.assertIn("queued->seen ?", line)
        self.assertIn("link reconnected in 1650 ms", line)
        self.assertNotIn("total", line)


if __name__ == "__main__":
    unittest.main()
