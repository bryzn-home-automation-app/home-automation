import { describe, it, expect } from 'vitest';
import {
  alternateTones,
  boxInRings,
  fitRoomLabel,
  labelPoint,
  poleOfInaccessibility,
  roomNeighbours,
  splitTwoLines,
  textWidthEm,
  type Pt,
} from '../utils/mapLabels';

// The floor map's label geometry (utils/mapLabels.ts): where a name goes, how big it can be,
// and which rooms alternate tones.

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
// An L: a long bar along the bottom (0..10 × 0..2) and a tall bar up the left (0..3 × 0..10).
const ell: Pt[] = [[0, 0], [10, 0], [10, 2], [3, 2], [3, 10], [0, 10], [0, 0]];

describe('poleOfInaccessibility', () => {
  it('is the exact centre of a rectangle, with the half short side as its clearance', () => {
    const p = poleOfInaccessibility([rect(0, 0, 4, 3)]);
    expect([p.x, p.y]).toEqual([2, 1.5]);
    expect(p.d).toBeCloseTo(1.5, 6);
    expect(labelPoint(rect(0, 0, 4, 3))).toEqual([2, 1.5]);
  });

  it('sits inside the thicker arm of an L, where the centroid would fall outside the room', () => {
    const p = poleOfInaccessibility([ell], 0.01);
    // The tall arm is 3 wide, the bar 2: the widest circle (r 1.5) fits in the tall arm.
    expect(p.x).toBeGreaterThan(1.3);
    expect(p.x).toBeLessThan(1.7);
    expect(p.y).toBeGreaterThan(1.4);
    expect(p.d).toBeGreaterThan(1.45);
  });

  it('keeps out of a hole', () => {
    const outer = rect(0, 0, 10, 10);
    const hole = rect(3, 3, 7, 7);
    const p = poleOfInaccessibility([outer, hole], 0.01);
    const inHole = p.x > 3 && p.x < 7 && p.y > 3 && p.y < 7;
    expect(inHole).toBe(false);
    expect(p.d).toBeGreaterThan(1.4);
  });

  it('copes with an empty or flat ring', () => {
    expect(poleOfInaccessibility([]).d).toBe(0);
    expect(poleOfInaccessibility([[[0, 0], [4, 0], [0, 0]]]).d).toBe(0);
  });
});

describe('boxInRings', () => {
  it('says whether a box lies wholly inside the room', () => {
    expect(boxInRings([rect(0, 0, 10, 4)], 5, 2, 4, 1.5)).toBe(true);
    expect(boxInRings([rect(0, 0, 10, 4)], 5, 2, 5.5, 1)).toBe(false);
    // In the L, a box across the inside corner pokes out of the room.
    expect(boxInRings([ell], 3, 2, 1, 1)).toBe(false);
    expect(boxInRings([ell], 1.5, 5, 1, 2)).toBe(true);
  });
});

describe('text fitting', () => {
  it('estimates narrow letters narrower than wide ones', () => {
    expect(textWidthEm('iiii')).toBeLessThan(textWidthEm('mmmm'));
    expect(textWidthEm('Kitchen')).toBeGreaterThan(3);
    expect(textWidthEm('Kitchen')).toBeLessThan(5);
  });

  it('splits a name into its two most even lines', () => {
    expect(splitTwoLines('Primary Bedroom')).toEqual(['Primary', 'Bedroom']);
    expect(splitTwoLines('Walk in closet')).toEqual(['Walk in', 'closet']);
    expect(splitTwoLines('Kitchen')).toBeNull();
  });

  // A room box half-sized hw × hh around the label point.
  const roomOf = (hw: number, hh: number) => (w: number, h: number) => w <= hw && h <= hh;

  it('gives a big room its name at the largest size on one line', () => {
    const fit = fitRoomLabel('Kitchen', roomOf(200, 100), { maxSize: 14, minSize: 11 });
    expect(fit).toMatchObject({ lines: ['Kitchen'], size: 14, stretch: 100 });
  });

  it('tries the given widths before it shrinks, then wraps, then gives up', () => {
    const one = textWidthEm('Primary Bedroom') * 14;
    // Just too narrow for the normal width at 14, wide enough condensed.
    const room = roomOf(one / 2 + 4.2 - 2, 50);
    const condensed = fitRoomLabel('Primary Bedroom', room, { maxSize: 14, minSize: 11, stretches: [100, 88] });
    expect(condensed).toMatchObject({ lines: ['Primary Bedroom'], size: 14, stretch: 88 });
    // Normal width only (the default): it shrinks instead.
    const shrunk = fitRoomLabel('Primary Bedroom', room, { maxSize: 14, minSize: 11 });
    expect(shrunk).toMatchObject({ lines: ['Primary Bedroom'], stretch: 100 });
    expect(shrunk!.size).toBeLessThan(14);

    const two = fitRoomLabel('Primary Bedroom', roomOf(40, 30), { maxSize: 14, minSize: 11 });
    expect(two?.lines).toEqual(['Primary', 'Bedroom']);
    expect(two!.size).toBeGreaterThanOrEqual(11);

    expect(fitRoomLabel('Primary Bedroom', roomOf(15, 8), { maxSize: 14, minSize: 11 })).toBeNull();
    expect(fitRoomLabel('Pantry', roomOf(10, 30), { maxSize: 14, minSize: 11 })).toBeNull();
  });

  it('never goes under the minimum size', () => {
    let smallest = Infinity;
    fitRoomLabel('Laundry', (_w, h) => {
      smallest = Math.min(smallest, h);
      return false;
    }, { maxSize: 14, minSize: 11 });
    // Half-height of one line at 11px plus its padding.
    expect(smallest).toBeGreaterThanOrEqual((11 * 1.18) / 2);
  });
});

describe('room tones', () => {
  it('finds rooms that share a wall, not ones that only touch at a corner', () => {
    const a = rect(0, 0, 4, 4);
    const b = rect(4, 0, 8, 4); // shares a wall with a
    const c = rect(8, 4, 12, 8); // touches b only at its corner
    const d = rect(4, 4, 8, 8); // shares walls with b and c
    const n = roomNeighbours([a, b, c, d], 0.05, 0.5);
    expect(n[0]).toEqual([1]);
    expect(n[1].sort()).toEqual([0, 3]);
    expect(n[2]).toEqual([3]);
  });

  it('gives neighbours different tones', () => {
    const rooms = [rect(0, 0, 4, 4), rect(4, 0, 8, 4), rect(8, 0, 12, 4), rect(0, 4, 12, 6)];
    const n = roomNeighbours(rooms, 0.05, 0.5);
    const t = alternateTones(n);
    n.forEach((list, i) => list.forEach((j) => expect(t[i]).not.toBe(t[j])));
    expect(Math.max(...t)).toBeLessThanOrEqual(2);
  });
});
