"""
What the dock is complaining about, from the `dock` object in the robot's ro-currentstate.

Nov 13 2026: the 9:00 AM vacuum-and-mop clean never started and the dock showed a red light,
while the app said "docked and ready". The dock's main `state` read 301 (DOCK_READY: that field
is the bin-emptying side only) and `error` read 0; the complaint was in `pwState`, the pad-wash
state, which nothing decoded: 671, "Clean Water Tank empty or not installed".

The dock reports five codes, all in one numeric namespace (iRobot's dock-state and error tables
share it): `state` (bin emptying, 3xx), `frState` (fluid refill, 4xx; not on every dock),
`pwState` (pad wash, 6xx), `pdState` (pad dry, 7xx) and `error`. Each field has a set of codes
that mean all is well; anything else is a complaint. Complaints with a known meaning get a kind
the app words; anything else is OTHER, which the app shows as "the dock needs attention" with
the code, never as "Ready".

Sources (roombapy-prime 0.8.3, the version this image pins):
  [E] `DockState` in roombapy_prime/models/robot_info.py: all 86 values extracted from the iRobot
      app's own enum. Names the OK states and the 650-669 / 750-757 / 350-365 errors.
  [V] roombapy_prime/vendor_errors.py: iRobot's own error texts from the Prime app 3.2.0
      (com.irobot.home.prime build 3020012). Has 670-672, which [E] does not.
  [F] A field test recorded in [E]'s docstring and release notes v0.2.0b8: a Combo dock read
      pwState 671 with its clean-water tank removed and 601 the moment it went back in, with
      state, error and pdState unchanged.
  [S] iRobot support, homesupport.irobot.com/articles/en_US/Knowledge/10013 (AutoWash dock):
      650 "Clear Water Dock Tank Missing", 651 "Clear Water Tank Level Too Low",
      653 "Dirty Water Dock Tank Missing", 654 "Dirty Water Dock Tank Level Too Full".

  code  kind                meaning                                        source     status
  650   CLEAN_WATER_OUT     clean-water tank missing                       E, S       confirmed
  651   CLEAN_WATER_EMPTY   clean-water tank level too low                 E, S       confirmed
  671   CLEAN_WATER_EMPTY   clean-water tank empty OR not installed        V, F       confirmed
  653   DIRTY_WATER_OUT     dirty-water tank missing                       E, V, S    confirmed
  654   DIRTY_WATER_FULL    dirty-water tank too full                      E, V, S    confirmed
  672   DIRTY_WATER_FULL    dirty-water tank full OR not installed         V          text confirmed; that
                                                                                      the dock sends it in
                                                                                      pwState is inferred
                                                                                      from 671
  450   CLEAN_WATER_OUT     refill dock: tank missing                      E, V       confirmed (frState docks)
  451   CLEAN_WATER_EMPTY   refill dock: tank level too low                E, V       confirmed (frState docks)
  350   BAG                 dock bag missing                               E, V       confirmed
  353   BAG                 dock bag full                                  E, V       confirmed
  668   MOP                 no mop attached (pad wash)                     E, V       confirmed
  756   MOP                 no mop attached (pad dry)                      E, V       confirmed
  else  OTHER               not decoded (717 among them: see below)                   -

671 and 672 can't tell "empty"/"full" from "not in place": iRobot's own text says "or not
installed", and the field test produced 671 by pulling the tank. The app says so in its advice.

Not decoded on purpose: `ro-stats.unprocessedError` ("picea unknown fault code:717" on this
robot). It is a string from iRobot's platform layer, not one of these fields, 717 is in no table,
and it was already there (alerted daily since Nov 5) when the Nov 6 vacuum-and-mop clean ran in
full, so it is not the tank. It stays where it was (roomba_status.fault_text).
"""

CLEAN_WATER_EMPTY = "clean_water_empty"
CLEAN_WATER_OUT = "clean_water_out"
DIRTY_WATER_FULL = "dirty_water_full"
DIRTY_WATER_OUT = "dirty_water_out"
BAG = "bag"
MOP = "mop"
OTHER = "other"

KINDS = {
    650: CLEAN_WATER_OUT, 651: CLEAN_WATER_EMPTY, 671: CLEAN_WATER_EMPTY,
    653: DIRTY_WATER_OUT, 654: DIRTY_WATER_FULL, 672: DIRTY_WATER_FULL,
    450: CLEAN_WATER_OUT, 451: CLEAN_WATER_EMPTY,
    350: BAG, 353: BAG,
    668: MOP, 756: MOP,
}

# The codes that mean nothing is wrong, per field [E]. 0 is DOCK_NO_COMMON_ERROR; the x00
# values are each family's "unknown" (no reading yet), the rest are idle / working / done
# (e.g. 302-305 emptying the bin, 602 washing the pad, 702 drying it, 606/707 dock updating).
# 406 is the Classic app's "tank partially refilled", which [E] lacks.
OK = {
    "error": frozenset({0}),
    "pwState": frozenset({0, *range(600, 609)}),
    "pdState": frozenset({0, *range(700, 708)}),
    "frState": frozenset({0, *range(400, 407)}),
    "state": frozenset({0, *range(300, 306)}),
}


def _code(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def dock_issue(dock):
    """(kind, code) for what the dock is complaining about, or (None, None) when nothing.

    A decoded complaint wins over an undecoded one wherever it is; otherwise the first field in
    OK's order (error, pad wash, pad dry, refill, bin emptying) that isn't all-is-well."""
    if not isinstance(dock, dict):
        return None, None
    other = None
    for field, fine in OK.items():
        code = _code(dock.get(field))
        if code is None or code in fine:
            continue
        kind = KINDS.get(code)
        if kind:
            return kind, code
        if other is None:
            other = (OTHER, code)
    return other or (None, None)
