"""Tests for coverage_passes (stdlib only):
    python -m unittest discover -s roomba-poller -v

The clean simulations drive a robot the way a Roomba covers a room: an edge pass
round the walls, then lawnmower lanes, reporting a position every 0.2 s in
messages of five.
"""
import math
import unittest

import coverage_passes as cp

VAC = 2          # OperatingModeBitmask.VACUUMING
TRAVEL = 1       # OperatingModeBitmask.TRAVELING
INSET = 0.17     # robot centre stays this far off the walls


def _walk(points, speed, step=0.2):
    """Positions every `step` seconds along a polyline at `speed` m/s."""
    out = [points[0]]
    carry = 0.0
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        seg = math.hypot(bx - ax, by - ay)
        d = speed * step - carry
        while d <= seg:
            u = d / seg
            out.append((ax + u * (bx - ax), ay + u * (by - ay)))
            d += speed * step
        carry = seg - (d - speed * step)
    return out


def edge_path(x0, y0, x1, y1):
    a, b, c, d = x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET
    return [(a, b), (c, b), (c, d), (a, d), (a, b)]


def lanes(x0, y0, x1, y1, spacing, vertical=False, reverse=False):
    """Lawnmower lanes covering the room, as one polyline."""
    if vertical:
        pts = lanes(y0, x0, y1, x1, spacing, reverse=reverse)
        return [(y, x) for x, y in pts]
    a, c = x0 + INSET, x1 - INSET
    ys = []
    y = y0 + INSET
    while y <= y1 - INSET + 1e-9:
        ys.append(y)
        y += spacing
    if reverse:
        ys.reverse()
    pts = []
    for i, y in enumerate(ys):
        pts += [(a, y), (c, y)] if i % 2 == 0 else [(c, y), (a, y)]
    return pts


def drive(grid, path, t0=0.0, speed=0.3, modes=VAC, step=0.2, per_msg=5):
    """Feed a path to the grid in messages; returns the time it ended."""
    pos = _walk(path, speed, step)
    t = t0
    for i in range(0, len(pos), per_msg):
        t = t0 + (i + per_msg) * step
        grid.add_samples([(x, y, modes) for x, y in pos[i:i + per_msg]], t)
    return t


def room_cells(x0, y0, x1, y1, margin):
    """Cells well inside a room (away from the walls by `margin`)."""
    c = cp.CELL
    return {
        (ix, iy)
        for ix in range(math.floor((x0 + margin) / c), math.floor((x1 - margin) / c))
        for iy in range(math.floor((y0 + margin) / c), math.floor((y1 - margin) / c))
    }


ROOM = (0.0, 0.0, 4.0, 3.0)


class Basics(unittest.TestCase):
    def test_cleaning_bits(self):
        self.assertTrue(cp.is_cleaning(2))
        self.assertTrue(cp.is_cleaning(6))
        self.assertTrue(cp.is_cleaning(5))      # traveling + mop, seen for a whole clean
        self.assertTrue(cp.is_cleaning(512))
        self.assertFalse(cp.is_cleaning(0))     # settling at mission start
        self.assertFalse(cp.is_cleaning(1))     # traveling only
        self.assertFalse(cp.is_cleaning(None))

    def test_segment_band(self):
        cells = cp.cells_near_segment(0.0, 0.0, 1.0, 0.0)
        rows = {iy for _, iy in cells}
        cols = {ix for ix, _ in cells}
        self.assertEqual(rows, {-2, -1, 0, 1})          # 4 cells = 20 cm band
        self.assertEqual(min(cols), -2)
        self.assertEqual(max(cols), 21)
        disc = cp.cells_near_segment(0.5, 0.5, 0.5, 0.5)
        self.assertIn((10, 10), disc)
        self.assertLess(len(disc), 20)

    def test_axis(self):
        self.assertIsNone(cp.axis_of(0.001, 0.0))
        self.assertAlmostEqual(cp.axis_of(1, 0), 0.0)
        self.assertAlmostEqual(cp.axis_of(-1, 0), 0.0)   # direction doesn't matter
        self.assertAlmostEqual(cp.axis_gap(cp.axis_of(1, 0), cp.axis_of(0, 1)), math.pi / 2)

    def test_revisit_rules(self):
        h, v = 0.0, math.pi / 2
        self.assertEqual(cp.revisit(0, 0, None, 5, h), 1)
        self.assertEqual(cp.revisit(1, 0, h, 30, h), 1)          # neighbouring lane, same pass
        self.assertEqual(cp.revisit(1, 0, h, 61, h), 2)          # came back after a minute
        self.assertEqual(cp.revisit(1, 0, h, 5, v), 1)           # the turn at a lane end
        self.assertEqual(cp.revisit(1, 0, h, 11, v), 2)          # crossing the earlier lanes
        self.assertEqual(cp.revisit(1, 0, None, 30, v), 1)       # no heading: time rule only
        self.assertEqual(cp.revisit(cp.MAX_COUNT, 0, h, 100, h), cp.MAX_COUNT)


class Cleans(unittest.TestCase):
    def test_one_pass_reads_once(self):
        """Edge pass + lanes, lanes overlapping by design, at several spacings:
        nothing reads as twice."""
        for spacing in (0.12, 0.15, 0.17):
            g = cp.PassGrid("m")
            t = drive(g, edge_path(*ROOM))
            drive(g, lanes(*ROOM, spacing), t0=t)
            once = {k for k, n in g.counts().items() if n >= 1}
            self.assertTrue(room_cells(*ROOM, 0.3) <= once, f"solid at {spacing}")
            self.assertEqual(cp.twice_cells(g.counts()), set(), f"spacing {spacing}")

    def test_two_passes_crosswise_read_twice(self):
        """The second pass at right angles, starting where the first ended."""
        g = cp.PassGrid("m")
        t = drive(g, edge_path(*ROOM))
        p1 = lanes(*ROOM, 0.17)
        t = drive(g, p1, t0=t)
        p2 = lanes(*ROOM, 0.17, vertical=True)
        # Start the crosswise lanes from the corner the first pass ended in.
        if math.hypot(p2[0][0] - p1[-1][0], p2[0][1] - p1[-1][1]) > 1:
            p2 = lanes(*ROOM, 0.17, vertical=True, reverse=True)
        drive(g, p2, t0=t)
        twice = cp.twice_cells(g.counts())
        inner = room_cells(*ROOM, 0.3)
        self.assertGreater(len(inner & twice) / len(inner), 0.97)

    def test_two_passes_same_way_read_twice(self):
        """The second pass retracing the first lanes back the way it came: only the
        last lanes of the first pass are too recent to count."""
        g = cp.PassGrid("m")
        t = drive(g, lanes(*ROOM, 0.17))
        drive(g, lanes(*ROOM, 0.17, reverse=True), t0=t)
        twice = cp.twice_cells(g.counts())
        inner = room_cells(*ROOM, 0.3)
        self.assertGreater(len(inner & twice) / len(inner), 0.75)

    def test_crossing_line_is_not_an_area(self):
        """Going straight back across a cleaned room later is a line, not an area."""
        g = cp.PassGrid("m")
        t = drive(g, lanes(*ROOM, 0.17))
        drive(g, [(0.3, 0.5), (3.7, 2.5)], t0=t + 120)
        self.assertGreater(sum(1 for n in g.counts().values() if n >= 2), 20)
        self.assertEqual(cp.twice_cells(g.counts()), set())

    def test_travel_and_gaps_are_not_drawn(self):
        g = cp.PassGrid("m")
        g.add_samples([(0.0, 0.0, TRAVEL), (2.0, 0.0, TRAVEL)], 0)
        self.assertEqual(g.counts(), {})
        g.add_samples([(0.0, 0.0, VAC)], 1)
        g.add_samples([(3.0, 0.0, VAC)], 2)                  # 3 m jump: a stream gap
        self.assertNotIn((30, 0), g.counts())                # nothing drawn between
        g.add_samples([(3.8, 0.0, VAC)], 40)                 # 38 s later: too long to join
        self.assertNotIn((68, 0), g.counts())


class Persistence(unittest.TestCase):
    def test_round_trip(self):
        counts = {(0, 0): 1, (1, 0): 1, (2, 0): 2, (5, 0): 2, (-3, -1): 3}
        cell, back = cp.decode_grid(cp.encode_grid(counts))
        self.assertEqual(cell, cp.CELL)
        self.assertEqual(back, counts)
        self.assertEqual(cp.encode_grid(counts)["runs"][1:3], [[0, 0, 2, 1], [0, 2, 1, 2]])

    def test_bad_data_raises(self):
        for bad in (None, {}, {"v": 99}, {"v": 1, "cell": 0}, {"v": 1, "cell": 0.05, "runs": [["x"]]}):
            with self.assertRaises((ValueError, TypeError)):
                cp.decode_grid(bad)

    def test_restore_mid_clean(self):
        """A poller restart partway through: the robot carrying on along its lanes
        doesn't read as twice, and a second pass straight after still does."""
        p1 = lanes(*ROOM, 0.17)
        p2 = lanes(*ROOM, 0.17, vertical=True, reverse=True)
        half = len(p1) // 2
        g = cp.PassGrid("m")
        t = drive(g, p1[:half + 1])
        r = cp.PassGrid.restore("m", cp.encode_grid(g.counts()))
        self.assertEqual(r.counts(), g.counts())
        t = drive(r, p1[half:], t0=t + 20)
        self.assertEqual(cp.twice_cells(r.counts()), set())
        drive(r, p2, t0=t)
        inner = room_cells(*ROOM, 0.3)
        self.assertGreater(len(inner & cp.twice_cells(r.counts())) / len(inner), 0.97)


class Display(unittest.TestCase):
    def test_rects_merge_rows(self):
        cells = {(x, y) for x in range(2, 6) for y in range(0, 3)} | {(10, 1)}
        self.assertEqual(cp.to_rects(cells), [[2, 0, 4, 3], [10, 1, 1, 1]])

    def test_rects_cover_exactly(self):
        cells = {(x, y) for x in range(0, 10) for y in range(0, 10) if (x - 5) ** 2 + (y - 5) ** 2 < 16}
        got = set()
        for ix, iy, w, h in cp.to_rects(cells):
            got |= {(x, y) for x in range(ix, ix + w) for y in range(iy, iy + h)}
        self.assertEqual(got, cells)

    def test_opening_and_closing(self):
        block = {(x, y) for x in range(0, 20) for y in range(0, 20)}
        strip = {(x, y) for x in range(30, 60) for y in range(0, 4)}       # 20 cm wide
        hole = {(9, 9), (10, 9), (9, 10), (10, 10)}
        counts = {k: 2 for k in (block - hole) | strip}
        twice = cp.twice_cells(counts)
        self.assertTrue(block <= twice)          # hole filled
        self.assertFalse(twice & strip)          # strip dropped

    def test_display_shape(self):
        counts = {(x, y): 2 for x in range(0, 10) for y in range(0, 10)}
        out = cp.display(counts)
        self.assertEqual(out, {"v": 1, "cell": cp.CELL, "rects": [[0, 0, 10, 10]]})
        self.assertEqual(cp.display({(0, 0): 1})["rects"], [])


if __name__ == "__main__":
    unittest.main()
