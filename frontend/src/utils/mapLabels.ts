/**
 * Pure plane geometry for the Roomba floor map (components/RoombaMap.tsx): where a room's
 * name goes, how big it can be, and which rooms touch. Everything works in one 2-D space
 * (the map's SVG units) and never touches the DOM, so it is tested on its own
 * (test/mapLabels.test.ts).
 */

export type Pt = [number, number];

/** A ring without the repeated closing point GeoJSON adds. */
export function openRing(ring: Pt[]): Pt[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1);
  return ring;
}

/** Even-odd point-in-polygon over one or more rings (an outer ring and its holes). */
export function pointInRings(px: number, py: number, rings: Pt[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segDistSq(px: number, py: number, a: Pt, b: Pt): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

/** Distance from a point to the nearest edge; positive inside the rings, negative outside. */
export function signedDistance(px: number, py: number, rings: Pt[][]): number {
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) min = Math.min(min, segDistSq(px, py, ring[i], ring[j]));
  }
  if (min === Infinity) return -Infinity;
  return (pointInRings(px, py, rings) ? 1 : -1) * Math.sqrt(min);
}

/** The area-weighted centroid of a ring (the mean of its points when it has no area). */
export function ringCentroid(ring: Pt[]): Pt {
  const pts = openRing(ring);
  if (pts.length === 0) return [0, 0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    return [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

interface Cell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

/**
 * The pole of inaccessibility: the point inside the rings farthest from any edge, and that
 * distance (the radius of the largest circle that fits). This is the visual centre of a room:
 * in an L-shaped room it sits in the thicker arm, never in the corner outside the L, which is
 * where the plain centroid falls. Grid search with pruning, after Mapbox's polylabel.
 * `rings[0]` is the outer ring; any more are holes.
 */
export function poleOfInaccessibility(rings: Pt[][], precision?: number): { x: number; y: number; d: number } {
  const clean = rings.map(openRing).filter((r) => r.length > 0);
  const outer = clean[0];
  if (!outer) return { x: 0, y: 0, d: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const hgt = maxY - minY;
  const cellSize = Math.min(w, hgt);
  const c = ringCentroid(outer);
  if (cellSize <= 0) return { x: c[0], y: c[1], d: 0 };
  const eps = precision ?? Math.max(w, hgt) / 400;

  const make = (x: number, y: number, h: number): Cell => {
    const d = signedDistance(x, y, clean);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  // A small max-heap on `max`, so the most promising cell is split first.
  const heap: Cell[] = [];
  const push = (cell: Cell) => {
    heap.push(cell);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].max >= heap[i].max) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): Cell => {
    const top = heap[0];
    const last = heap.pop() as Cell;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].max > heap[m].max) m = l;
        if (r < heap.length && heap[r].max > heap[m].max) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const h0 = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) push(make(x + h0, y + h0, h0));
  }
  // Start from the centroid (exact for a rectangle), then the box's middle.
  let best = make(c[0], c[1], 0);
  const mid = make(minX + w / 2, minY + hgt / 2, 0);
  if (mid.d > best.d) best = mid;

  let guard = 0;
  while (heap.length && guard++ < 20000) {
    const cell = pop();
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= eps) continue;
    const h = cell.h / 2;
    push(make(cell.x - h, cell.y - h, h));
    push(make(cell.x + h, cell.y - h, h));
    push(make(cell.x - h, cell.y + h, h));
    push(make(cell.x + h, cell.y + h, h));
  }
  return { x: best.x, y: best.y, d: Math.max(0, best.d) };
}

/** Where a room's name goes: its pole of inaccessibility (B-122). */
export function labelPoint(ring: Pt[]): Pt {
  const p = poleOfInaccessibility([ring]);
  return [p.x, p.y];
}

function segmentCrossesBox(a: Pt, b: Pt, x0: number, y0: number, x1: number, y1: number): boolean {
  // Liang-Barsky clip against the open box; a crossing of positive length means the edge
  // runs through the box's interior.
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] <= 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t1 - t0 > 1e-9;
}

/** True when the box centred on (cx, cy) with half-sizes hw × hh lies wholly inside the rings. */
export function boxInRings(rings: Pt[][], cx: number, cy: number, hw: number, hh: number): boolean {
  const x0 = cx - hw;
  const x1 = cx + hw;
  const y0 = cy - hh;
  const y1 = cy + hh;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as Pt[]) {
    if (!pointInRings(x, y, rings)) return false;
  }
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (segmentCrossesBox(ring[j], ring[i], x0, y0, x1, y1)) return false;
    }
  }
  return true;
}

// Advance widths of Archivo (weight 600, normal width) in em, by character class. An
// estimate, checked in the browser against the bundled font (room names come out 2-8% wider
// than measured), deliberately on the wide side so a label that "fits" here fits on screen.
const NARROW = new Set([...'iljI!|.,:;\'`']);
const SEMI = new Set([...'frt()[]-/ ']);
const WIDE = new Set([...'mw@%']);
const WIDEST = new Set([...'MW']);

/** Estimated width of `text` in em, in Archivo 600 at its normal width. */
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) w += 0.27;
    else if (SEMI.has(ch)) w += 0.36;
    else if (WIDE.has(ch)) w += 0.88;
    else if (WIDEST.has(ch)) w += 1.02;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else if (ch >= '0' && ch <= '9') w += 0.6;
    else w += 0.57;
  }
  return w;
}

/** The two-line split of a name nearest its middle, or null for a single word. */
export function splitTwoLines(text: string): [string, string] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let bestW = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ');
    const b = words.slice(k).join(' ');
    const w = Math.max(textWidthEm(a), textWidthEm(b));
    if (w < bestW) {
      bestW = w;
      best = [a, b];
    }
  }
  return best;
}

export interface LabelFit {
  lines: string[];
  /** Font size, in the caller's units. */
  size: number;
  /** Archivo's width axis, in percent (100 normal, less is condensed). */
  stretch: number;
  /** Half the label block's width and height, padding included. */
  halfW: number;
  halfH: number;
}

export interface FitOptions {
  /** The largest size worth trying (a big room) and the smallest allowed (readable on a phone). */
  maxSize: number;
  minSize: number;
  /**
   * Widths to try at each size, widest first. Normal width only by default: the bundled
   * Archivo files measure the same at every font-stretch (no working width axis), so a
   * condensed fit would overflow on screen.
   */
  stretches?: number[];
  lineHeight?: number;
  /** Clear space around the text, in em. */
  pad?: number;
}

/**
 * The largest label that fits: one line at the largest size (trying each of `stretches` before
 * shrinking), down to `minSize`; then the same on two lines; null when even that won't fit (the room
 * then gets a number, and its name goes in the map key). `fits(halfW, halfH)` says whether a
 * centred box of that half-size fits the room.
 */
export function fitRoomLabel(
  text: string,
  fits: (halfW: number, halfH: number) => boolean,
  { maxSize, minSize, stretches = [100], lineHeight = 1.18, pad = 0.3 }: FitOptions,
): LabelFit | null {
  const hi = Math.max(maxSize, minSize);
  const sizes: number[] = [];
  for (let s = hi; s > minSize * 1.0001; s *= 0.9) sizes.push(s);
  sizes.push(minSize);
  const two = splitTwoLines(text);
  const options: string[][] = two ? [[text], two] : [[text]];
  for (const lines of options) {
    const em = Math.max(...lines.map(textWidthEm));
    for (const size of sizes) {
      for (const stretch of stretches) {
        const halfW = (em * size * (stretch / 100)) / 2 + pad * size;
        const halfH = (lines.length * lineHeight * size) / 2 + pad * size * 0.5;
        if (fits(halfW, halfH)) return { lines, size, stretch, halfW, halfH };
      }
    }
  }
  return null;
}

/**
 * Which rooms touch: two rooms are neighbours when an edge of one runs along an edge of the
 * other for more than `minShared` (a shared wall or doorway; a corner touch doesn't count).
 * Returns, for each room, the indices of its neighbours.
 */
export function roomNeighbours(rings: Pt[][], tolerance: number, minShared: number): number[][] {
  const out: number[][] = rings.map(() => []);
  const boxes = rings.map((r) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0 - tolerance, y0 - tolerance, x1 + tolerance, y1 + tolerance];
  });
  const tolSq = tolerance * tolerance;
  // Length of ring a's boundary that lies within `tolerance` of ring b's boundary, sampled.
  const shared = (a: Pt[], b: Pt[]): number => {
    let total = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const p = a[j];
      const q = a[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len === 0) continue;
      const steps = Math.max(1, Math.ceil(len / Math.max(tolerance, minShared / 4)));
      let near = 0;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = p[0] + (q[0] - p[0]) * t;
        const y = p[1] + (q[1] - p[1]) * t;
        let hit = false;
        for (let k = 0, m = b.length - 1; k < b.length && !hit; m = k++) hit = segDistSq(x, y, b[m], b[k]) <= tolSq;
        if (hit) near++;
      }
      total += len * (near / (steps + 1));
    }
    return total;
  };
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const [a0, b0, c0, d0] = boxes[i];
      const [a1, b1, c1, d1] = boxes[j];
      if (a0 > c1 || a1 > c0 || b0 > d1 || b1 > d0) continue;
      if (shared(rings[i], rings[j]) > minShared) {
        out[i].push(j);
        out[j].push(i);
      }
    }
  }
  return out;
}

/**
 * A tone index per room so no two neighbours share one: greedy, largest-degree first, using
 * the lowest tone free. With two tones most plans alternate cleanly; a third is used only where
 * three rooms meet around a ring of neighbours.
 */
export function alternateTones(neighbours: number[][], tones = 3): number[] {
  const order = neighbours.map((_, i) => i).sort((a, b) => neighbours[b].length - neighbours[a].length || a - b);
  const tone: number[] = neighbours.map(() => -1);
  for (const i of order) {
    const used = new Set(neighbours[i].map((j) => tone[j]));
    let t = 0;
    while (used.has(t) && t < tones - 1) t++;
    tone[i] = t;
  }
  return tone;
}
