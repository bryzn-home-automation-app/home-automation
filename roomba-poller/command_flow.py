"""
Pure decisions for getting a dashboard command to the Roomba quickly (no I/O).

poller.py does the talking (Postgres, the iRobot cloud). What it should DO is decided
here, so every rule can be tested without a robot (tests/test_command_flow.py):

* link_decision(): send on the cloud link as it is, or make it prove itself first. A
  shadow read answered on the same MQTT session is the proof: the request and its answer
  travel the very connection a command does (roombapy_prime 0.8.3, mqtt_client.py
  `_request()` / `get_shadow()`). Only a failed proof costs a full reconnect, which until
  now was paid before every command (about 1.6 s on the NUC, plus a cut in the live dot).
* FollowUp: once a command is out, read the robot's state on a short schedule, so the
  page sees the change within a second or two. Where the state SHOULD move, silence means
  the robot never got it: reconnect and send once more when a second copy is harmless,
  otherwise fail the command with a reason. Slower, never silently lost.
* loop_sleep(): how long the main loop may sleep before its next tick or check.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------
# Fallback wake-up. Postgres NOTIFY wakes the loop the moment a command is queued; this
# tick only matters while the listener is down (or a notification was missed).
CMD_TICK_SECONDS = 5.0
# A shadow round trip on the current connection at most this old proves the link. Mid-clean
# the status is read every 10 s, so a command then goes out with no extra round trip.
LINK_FRESH_SECONDS = 20.0
# The proof itself: one ro-currentstate read. A healthy round trip takes well under a
# second, so a read this slow means the link is in trouble and gets rebuilt.
PROBE_TIMEOUT = 3.0
# Each follow-up status read.
STATUS_READ_TIMEOUT = 3.0
# When to read the robot's state after a command it should visibly react to, in seconds
# after the broker confirmed the send. On the NUC (Nov 2026) the shadow had not moved
# 0.5 s after a pause / resume / stop and had moved by 11 s; past the last check, silence
# counts as "not received".
VERIFY_CHECKS = (1.0, 2.0, 3.0, 4.5, 6.0, 8.0, 10.5, 13.0, 16.0)
# A start is never sent twice, so its only cost of waiting longer is a later failure
# message -- and that message says "try again", which must not come while a slow start
# is still on its way.
START_VERIFY_CHECKS = VERIFY_CHECKS + (20.0, 25.0, 30.0)
# The same for a command with no reaction to verify: only so the page catches up fast.
FOLLOW_CHECKS = (1.0, 2.0, 3.5, 6.0, 10.0)

# ---------------------------------------------------------------------------
# Command kinds
# ---------------------------------------------------------------------------
# Commands that travel to the robot over the cloud MQTT link (the rest are REST calls:
# map edits, schedule reads).
ROBOT_COMMANDS = frozenset({
    "start", "stop", "pause", "resume", "dock", "find", "evac", "favorite",
    "clean_room", "clean_rooms",
})
# Commands that start a clean.
START_COMMANDS = frozenset({"start", "clean_room", "clean_rooms"})
# Safe to send a second time when the first may not have arrived: each one asks for a
# state, and asking twice lands in the same state (a second "find" is one more chime). A
# start is never re-sent: if the first copy did arrive late, a second could begin another
# clean.
RESEND_SAFE = frozenset({"pause", "resume", "stop", "dock", "find"})
# Nothing visible changes, so there is no state to read back.
NO_FOLLOW_UP = frozenset({"find"})

# Phases a robot can start a clean from (docked, or stopped with no mission).
_IDLE_PHASES = frozenset({"charge", "stop", "idle", ""})

# Send results (poller.py's _robot_command).
SENT = "sent"                # the broker confirmed it (PUBACK)
UNCONFIRMED = "unconfirmed"  # no PUBACK, or the publish raised: it may not have left
REFUSED = "refused"          # the request itself was bad; nothing was sent

# link_decision() results.
FRESH = "fresh"
PROBE = "probe"

# FollowUp.after_check() results.
CONFIRMED = "confirmed"      # the robot's state moved
WAIT = "wait"                # nothing yet; read again at the next check
RESEND = "resend"            # nothing at all: reconnect and send once more
NO_REACTION = "no_reaction"  # nothing at all, and no second send: reconnect, look once more, fail
DONE = "done"                # an unverified follow-up ran its course


# ---------------------------------------------------------------------------
# The link
# ---------------------------------------------------------------------------
def link_decision(now, *, connected, link_id, last_ok_at, last_ok_link,
                  refresh_due_in=None, have_state=True, max_age=LINK_FRESH_SECONDS):
    """Can a command go out on the cloud link as it is (FRESH), or must the link first
    answer a shadow read (PROBE)? Returns (decision, why).

    connected       the MQTT client's own flag (None when the library doesn't say)
    link_id         which connection is up now (client + generation)
    last_ok_at      when a shadow read last came back, and on which connection
    refresh_due_in  seconds until the library swaps the MQTT token (None: unknown)
    have_state      the robot's state from that read is at hand (the baseline a
                    reaction is judged against)
    """
    if connected is not True:
        return PROBE, "link not known to be up"
    if link_id is None or last_ok_at is None or last_ok_link is None:
        return PROBE, "no round trip on this link yet"
    if last_ok_link != link_id:
        return PROBE, "link replaced since the last round trip"
    age = now - last_ok_at
    if age > max_age:
        return PROBE, f"last round trip {age:.0f}s ago"
    if refresh_due_in is not None and refresh_due_in <= 0:
        return PROBE, "token refresh due"
    if not have_state:
        return PROBE, "no recent robot state"
    return FRESH, f"round trip {age:.1f}s ago"


# ---------------------------------------------------------------------------
# The robot's reaction
# ---------------------------------------------------------------------------
def _cms(rep):
    if not isinstance(rep, dict):
        return {}
    cms = rep.get("cleanMissionStatus")
    return cms if isinstance(cms, dict) else {}


def _phase(cms):
    return str(cms.get("phase") or "").lower()


def _cycle_on(cms):
    return cms.get("cycle") not in (None, "", "none")


def mission_signature(rep):
    """What a command visibly moves: phase, cycle and mission id (None without a state)."""
    cms = _cms(rep)
    if not cms:
        return None
    return (cms.get("phase"), cms.get("cycle"), cms.get("missionId"))


def robot_reacted(baseline, rep):
    """The robot's state moved away from `baseline` (a mission_signature).

    Any move counts, not only the one the command asked for: the safety net is about
    whether commands reach the robot at all. A move that came from something else (the
    bin emptying just then) only means one check is skipped -- today's behaviour."""
    if baseline is None:
        return False
    now = mission_signature(rep)
    return now is not None and now != baseline


def reaction_expected(command, rep):
    """Should the robot's state visibly move after `command`, given its state `rep` just
    before? Only where that's certain: a wrong "yes" would re-send or fail a command that
    worked, a wrong "no" only skips the check (and the row is OK on the broker's word, as
    before)."""
    cms = _cms(rep)
    if not cms:
        return False
    phase = _phase(cms)
    on = _cycle_on(cms)
    if command in ("pause", "stop"):
        return phase == "run"
    if command == "resume":
        return phase in ("stop", "pause") and on
    if command == "dock":
        # Mid-clean (cleaning or paused): it heads home. Already home, homing or idle off
        # the dock is not certain enough.
        return phase in ("run", "pause") or (phase == "stop" and on)
    if command in START_COMMANDS:
        return not on and phase in _IDLE_PHASES
    return False  # find, evac, favorite, anything new


def no_reaction_hint(rep, error_text=None):
    """What the robot itself says might stop it (appended to a failure's reason)."""
    cms = _cms(rep)
    try:
        error = int(cms.get("error") or 0)
    except (TypeError, ValueError):
        error = 0
    try:
        not_ready = int(cms.get("notReady") or 0)
    except (TypeError, ValueError):
        not_ready = 0
    if error:
        return f"the robot reports error {error}" + (f": {error_text}" if error_text else "")
    if not_ready:
        return f"the robot reports it isn't ready (code {not_ready})"
    return ""


def verify_schedule(command):
    """When to read the robot back after `command`, if a reaction is expected."""
    return START_VERIFY_CHECKS if command in START_COMMANDS else VERIFY_CHECKS


def no_reaction_detail(command, attempts, hint=""):
    """The reason stored on a command the robot never reacted to. Reads on after the UI's
    "Pause failed: " / "The robot didn't start: "."""
    wait = f"{verify_schedule(command)[-1]:.0f} s"
    if attempts > 1:
        text = "the robot didn't react, even after reconnecting and sending it again"
    elif command in START_COMMANDS:
        text = (f"the robot didn't react within {wait}. It wasn't sent again automatically, "
                "so a second clean can't start by accident; try again")
    else:
        text = f"the robot didn't react within {wait}"
    return f"{text} ({hint})" if hint else text


# ---------------------------------------------------------------------------
# Timings (logged per command so the latency can be measured on the NUC)
# ---------------------------------------------------------------------------
@dataclass
class CommandTiming:
    seen_at: float                      # monotonic: the poller picked the row up
    queued_ms: float | None = None      # created_at -> seen, on the database's clock
    woke: str = ""                      # what woke the loop: notify / tick / busy
    link: str = ""                      # fresh / probed / reconnected, and why
    sent_at: float | None = None        # monotonic: the broker confirmed the first send
    done_at: float | None = None        # monotonic: the robot was seen to react
    notes: list = field(default_factory=list)


def _ms(value):
    return "?" if value is None else f"{value:.0f} ms"


def timing_line(cmd_id, command, t, outcome):
    """One greppable line: queued -> seen -> sent -> confirmed (or -> failed), in ms."""
    parts = [f"command #{cmd_id} ({command}) {outcome}"]
    parts.append(f"queued->seen {_ms(t.queued_ms)}" + (f" [{t.woke}]" if t.woke else ""))
    if t.sent_at is not None:
        parts.append(f"seen->sent {_ms((t.sent_at - t.seen_at) * 1000)}"
                     + (f" [link {t.link}]" if t.link else ""))
        if t.done_at is not None:
            last = "failed" if str(outcome).startswith("failed") else "confirmed"
            parts.append(f"sent->{last} {_ms((t.done_at - t.sent_at) * 1000)}")
    elif t.link:
        parts.append(f"link {t.link}")
    end = t.done_at if t.done_at is not None else t.sent_at
    if end is not None and t.queued_ms is not None:
        parts.append(f"total {_ms(t.queued_ms + (end - t.seen_at) * 1000)}")
    if t.notes:
        parts.append("; ".join(str(n) for n in t.notes))
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# Following a command up
# ---------------------------------------------------------------------------
@dataclass
class FollowUp:
    """A sent robot command being watched. `verify` means a reaction is expected, so the
    row stays SENT until the robot moves (then OK) or the checks run out (then a resend
    or FAILED). Otherwise the row is already OK and the reads only refresh the page."""
    cmd_id: int
    command: str
    arg: str | None
    baseline: tuple | None              # mission_signature when sent
    verify: bool
    sent_at: float                      # monotonic: this attempt's send
    timing: CommandTiming
    attempt: int = 1
    checks_done: int = 0

    @property
    def schedule(self):
        return verify_schedule(self.command) if self.verify else FOLLOW_CHECKS

    def next_check_at(self):
        """When the next status read is due (monotonic), or None once they're all done."""
        if self.checks_done >= len(self.schedule):
            return None
        return self.sent_at + self.schedule[self.checks_done]

    def after_check(self, rep):
        """One status read came back (`rep` None when it failed): what next."""
        self.checks_done += 1
        if robot_reacted(self.baseline, rep):
            return CONFIRMED
        if self.checks_done < len(self.schedule):
            return WAIT
        if not self.verify:
            return DONE
        if self.attempt == 1 and self.command in RESEND_SAFE:
            return RESEND
        return NO_REACTION

    def resent(self, now, baseline=None):
        """Start over after a second send, against the state read just before it."""
        self.attempt += 1
        self.sent_at = now
        self.checks_done = 0
        if baseline is not None:
            self.baseline = baseline


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------
def loop_sleep(now, *, tick=CMD_TICK_SECONDS, next_check=None):
    """Seconds the main loop may sleep: until the fallback tick or the next follow-up
    read, whichever comes first (a NOTIFY ends the sleep sooner)."""
    wait = tick
    if next_check is not None:
        wait = min(wait, next_check - now)
    return max(0.0, wait)
