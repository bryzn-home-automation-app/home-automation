"""Where the robot has cleaned more than once this mission.

The cloud's live coverage (coverage.geojson, see poller._persist_coverage) is a
plain union: one "vacuuming" and one "traveling" MultiPolygon per mission, whose
only property is `operatingModes`. It carries no pass count (checked against the
rows stored on the NUC, 2026-11-11), and the stored map bundle has no
`trajectories` layer. So the count is derived here from the live position
stream: every PositionSample the robot reports while it is cleaning is drawn onto
a grid of CELL-metre cells, along the segment from the previous sample, as a band
HALF_WIDTH either side of the robot's path. (The cloud draws its cleaned band
about 0.18 m wide, so a pass marks solid ground, never a comb of lanes.)

A cell's count goes up only when the robot comes BACK to it:
  * after SAME_PASS_SECONDS since it last went over the cell, from any direction;
  * or after CROSS_SECONDS, if it now crosses the cell at CROSS_ANGLE or more to
    the way it went over it last time (a second pass at right angles to the
    first, which can start right where the first one ended).
Neighbouring lanes of one pass overlap by design. The lane back comes over the
overlap within a lane's length or two, running the opposite way, so it never
counts.

What is shown is then tidied: twice-over ground narrower than about the robot
itself (an edge pass meeting the lane ends, a single crossing, a turn on the spot)
is an overlap rather than an area, so it is removed (a morphological opening), and
small gaps inside a twice-over area are filled (a closing).

Pure functions and one small class: no I/O and no third-party imports, so the
tests run anywhere (`python -m unittest discover -s roomba-poller`).
"""
import math

# Grid cell size, metres. 5 cm resolves the robot's ~18 cm cleaning band in 3-4
# cells, so one pass covers solidly; a whole house is ~60k cells.
CELL = 0.05
# Half the width marked around the robot's path, metres. The cloud's cleaned band
# is ~0.18 m wide; a little wider here so lanes always meet.
HALF_WIDTH = 0.10

# Consecutive cleaning samples are joined into a segment only when they are this
# close in space and time. Beyond that the stream had a gap (a reconnect, a
# relocalisation), and drawing a straight line across the plan would be wrong.
JOIN_MAX_DIST = 1.0
JOIN_MAX_SECONDS = 10.0

# The revisit rules (see the module docstring). A lane back over the far end of a
# 9 m room at ~0.3 m/s comes ~60 s later; longer rooms leave thin stripes that the
# opening below removes.
SAME_PASS_SECONDS = 60.0
CROSS_SECONDS = 10.0
CROSS_ANGLE = math.radians(60)
# Shorter moves than this give no reliable heading.
MIN_AXIS_LENGTH = 0.02
MAX_COUNT = 9

# Display tidying, in cells. Opening radius 3 -> twice-over ground narrower than
# 7 cells (35 cm, about the robot's diameter) is dropped. Closing radius 2 ->
# gaps up to 4 cells (20 cm) inside it are filled.
OPEN_RADIUS = 3
CLOSE_RADIUS = 2

# PositionSample.operating_modes is OperatingModeBitmask (roombapy_prime.models.
# mission_control): 1 traveling, 2 vacuuming, 4 mop only, 8 video, 16 air
# purifying, 32 vac+mop combo, 64 scrubbing, 128 mowing, 256 mopping, 512 vac then
# mop. 0 is seen for the first seconds of a mission. A sample counts as cleaning
# when any cleaning bit is set (a mopping robot was seen reporting 5 = 1|4 for a
# whole clean), matching how the frontend reads the cloud's coverage modes.
CLEANING_BITS = 2 | 4 | 32 | 64 | 256 | 512

FORMAT_VERSION = 1


def is_cleaning(operating_modes):
    try:
        return bool(int(operating_modes) & CLEANING_BITS)
    except (TypeError, ValueError):
        return False


def axis_of(dx, dy):
    """The line a move runs along, as an angle in [0, pi) (direction ignored), or
    None for a move too short to say."""
    if math.hypot(dx, dy) < MIN_AXIS_LENGTH:
        return None
    return math.atan2(dy, dx) % math.pi


def axis_gap(a, b):
    """Angle between two axes, 0..pi/2."""
    d = abs(a - b) % math.pi
    return min(d, math.pi - d)


def cells_near_segment(x0, y0, x1, y1, half=HALF_WIDTH, cell=CELL):
    """Grid cells (ix, iy) whose centres lie within `half` of the segment
    (x0, y0)-(x1, y1). A zero-length segment marks a disc."""
    dx, dy = x1 - x0, y1 - y0
    len2 = dx * dx + dy * dy
    h2 = half * half
    ix_lo = math.floor((min(x0, x1) - half) / cell)
    ix_hi = math.floor((max(x0, x1) + half) / cell)
    iy_lo = math.floor((min(y0, y1) - half) / cell)
    iy_hi = math.floor((max(y0, y1) + half) / cell)
    out = []
    for iy in range(iy_lo, iy_hi + 1):
        cy = (iy + 0.5) * cell
        for ix in range(ix_lo, ix_hi + 1):
            cx = (ix + 0.5) * cell
            if len2 > 0:
                u = ((cx - x0) * dx + (cy - y0) * dy) / len2
                u = 0.0 if u < 0 else 1.0 if u > 1 else u
                px, py = x0 + u * dx, y0 + u * dy
            else:
                px, py = x0, y0
            if (cx - px) ** 2 + (cy - py) ** 2 <= h2:
                out.append((ix, iy))
    return out


def revisit(count, last_t, last_axis, t, axis):
    """A cell's count after the robot goes over it at time t along `axis`."""
    if count <= 0:
        return 1
    dt = t - last_t
    back = dt > SAME_PASS_SECONDS or (
        dt > CROSS_SECONDS
        and axis is not None
        and last_axis is not None
        and axis_gap(axis, last_axis) >= CROSS_ANGLE
    )
    return min(count + 1, MAX_COUNT) if back else count


class PassGrid:
    """The pass count for one mission. Feed it position samples as they arrive;
    read `counts()` to persist or show it."""

    def __init__(self, mission_id, cell=CELL):
        self.mission_id = mission_id
        self.cell = cell
        self.cells = {}      # (ix, iy) -> [count, last_t, axis or None]
        self.prev = None     # (x, y, t) of the last cleaning sample
        self.version = 0     # bumps whenever a cell is added or its count changes

    def add_samples(self, samples, t):
        """`samples`: (x, y, operating_modes) tuples, oldest first, metres in the
        map's space; `t`: when they arrived (seconds, any monotonic clock)."""
        for x, y, modes in samples:
            try:
                x, y = float(x), float(y)
            except (TypeError, ValueError):
                continue
            if not (math.isfinite(x) and math.isfinite(y)):
                continue
            if not is_cleaning(modes):
                self.prev = None   # travelling doesn't clean; don't bridge over it
                continue
            p = self.prev
            if p is not None and t - p[2] <= JOIN_MAX_SECONDS and math.hypot(x - p[0], y - p[1]) <= JOIN_MAX_DIST:
                self._mark(p[0], p[1], x, y, t)
            else:
                self._mark(x, y, x, y, t)
            self.prev = (x, y, t)

    def break_path(self):
        """The stream stopped (task restart, pause): don't join across the gap."""
        self.prev = None

    def _mark(self, x0, y0, x1, y1, t):
        axis = axis_of(x1 - x0, y1 - y0)
        for key in cells_near_segment(x0, y0, x1, y1, cell=self.cell):
            c = self.cells.get(key)
            if c is None:
                self.cells[key] = [1, t, axis]
                self.version += 1
                continue
            n = revisit(c[0], c[1], c[2], t, axis)
            if n != c[0]:
                c[0] = n
                self.version += 1
            c[1] = t
            if axis is not None:
                c[2] = axis

    def counts(self):
        """{(ix, iy): count} snapshot, safe to hand to another thread."""
        return {k: v[0] for k, v in self.cells.items()}

    @classmethod
    def restore(cls, mission_id, data):
        """Rebuild from `encode_grid` output (after a poller restart mid-clean).
        When each cell was last visited isn't kept, so every restored cell counts
        as visited long ago: the robot coming back over any of it is a new pass.
        (Stamping them "now" instead would hide the next minute of a second pass.)
        The one false hit that leaves, the robot's own lane right where it was when
        the poller stopped, is a strip or a spot narrower than the robot, which
        the display's opening drops."""
        cell, counts = decode_grid(data)
        g = cls(mission_id, cell)
        g.cells = {k: [n, -math.inf, None] for k, n in counts.items()}
        return g


# ---------------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------------
def _row_runs(xs):
    """Sorted ints -> [(start, length), ...] of consecutive values."""
    runs = []
    for x in xs:
        if runs and x == runs[-1][0] + runs[-1][1]:
            runs[-1][1] += 1
        else:
            runs.append([x, 1])
    return [(a, n) for a, n in runs]


def encode_grid(counts, cell=CELL):
    """Every visited cell with its count, run-length coded per row:
    {"v", "cell", "runs": [[iy, ix0, n, count], ...]}. For restoring after a
    restart; not sent to the browser."""
    rows = {}
    for (ix, iy), n in counts.items():
        rows.setdefault(iy, []).append((ix, n))
    runs = []
    for iy in sorted(rows):
        cur = None
        for ix, n in sorted(rows[iy]):
            if cur is not None and ix == cur[1] + cur[2] and n == cur[3]:
                cur[2] += 1
            else:
                if cur is not None:
                    runs.append(cur)
                cur = [iy, ix, 1, n]
        if cur is not None:
            runs.append(cur)
    return {"v": FORMAT_VERSION, "cell": cell, "runs": runs}


def decode_grid(data):
    """encode_grid output -> (cell, {(ix, iy): count}). Raises ValueError on
    anything malformed (the caller then starts a fresh count)."""
    if not isinstance(data, dict) or data.get("v") != FORMAT_VERSION:
        raise ValueError("unknown pass grid format")
    cell = float(data.get("cell") or 0)
    if not cell > 0:
        raise ValueError("bad cell size")
    counts = {}
    for run in data.get("runs") or []:
        iy, ix0, n, c = (int(v) for v in run)
        if n <= 0 or c <= 0:
            continue
        for ix in range(ix0, ix0 + n):
            counts[(ix, iy)] = min(c, MAX_COUNT)
    return cell, counts


# ---------------------------------------------------------------------------
# Display: the twice-over region, tidied, as merged rectangles
# ---------------------------------------------------------------------------
def _erode(cells, r):
    """Square (2r+1) erosion, done as a row pass then a column pass."""
    if r <= 0:
        return set(cells)
    span = range(-r, r + 1)
    rows = {(x, y) for (x, y) in cells if all((x + d, y) in cells for d in span)}
    return {(x, y) for (x, y) in rows if all((x, y + d) in rows for d in span)}


def _dilate(cells, r):
    if r <= 0:
        return set(cells)
    span = range(-r, r + 1)
    rows = {(x + d, y) for (x, y) in cells for d in span}
    return {(x, y + d) for (x, y) in rows for d in span}


def twice_cells(counts, open_radius=OPEN_RADIUS, close_radius=CLOSE_RADIUS):
    """Cells cleaned twice or more, as an area: thin overlaps dropped (opening),
    small gaps filled (closing)."""
    raw = {k for k, n in counts.items() if n >= 2}
    if not raw:
        return set()
    opened = _dilate(_erode(raw, open_radius), open_radius)
    if not opened:
        return set()
    return _erode(_dilate(opened, close_radius), close_radius)


def to_rects(cells):
    """Cells -> [[ix, iy, w, h], ...]: runs along each row, merged down the rows
    while a run repeats exactly. Sorted, so equal input gives equal output."""
    rows = {}
    for ix, iy in cells:
        rows.setdefault(iy, []).append(ix)
    out = []
    open_ = {}
    for iy in sorted(rows):
        nxt = {}
        for ix0, w in _row_runs(sorted(rows[iy])):
            r = open_.pop((ix0, w), None)
            if r is not None and r[1] + r[3] == iy:
                r[3] += 1
            else:
                if r is not None:
                    out.append(r)
                r = [ix0, iy, w, 1]
            nxt[(ix0, w)] = r
        out.extend(open_.values())
        open_ = nxt
    out.extend(open_.values())
    out.sort(key=lambda r: (r[1], r[0]))
    return out


def display(counts, cell=CELL):
    """What the browser draws: {"v", "cell", "rects": [[ix, iy, w, h], ...]}, in
    cells (metres = value * cell), the twice-over area only."""
    return {"v": FORMAT_VERSION, "cell": cell, "rects": to_rects(twice_cells(counts))}
