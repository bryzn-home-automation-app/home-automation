import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRoombaPosition, fetchRoombaCoverage } from '../api/roomba';
import { EmptyState, ErrorState, Icon, Loading, SkelBlock } from './ui';
import type {
  GeoFeatureCollection,
  GeoPosition,
  RoombaMap as RoombaMapData,
} from '../types';

/** A mapped room the caller can act on (rename). id is the map's room_id. */
export interface RoomSelection {
  id: string;
  name: string | null;
}

/** A completed divide line: the room to split + the two endpoints in meters. */
export interface SplitLine {
  roomId: string;
  roomName: string | null;
  points: [number, number][];
}

interface RoombaMapProps {
  map: RoombaMapData | null;
  loading?: boolean;
  /** The first load failed (B-005): say so with a Try again, never "No map yet". */
  error?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  /** The robot's name, for the legend's dot ("Rosie"). */
  robotName?: string | null;
  /** Drawn under the plan, beside the legend (the battery ring). */
  aside?: ReactNode;
  className?: string;
  /** When true, poll the live position (~1.5s) and draw the moving robot dot. */
  running?: boolean;
  /** When true, rooms are clickable (admin) — clicking one fires onSelectRoom. */
  editable?: boolean;
  onSelectRoom?: (room: RoomSelection) => void;
  /**
   * "Divide a room" mode. The divide path is a CONTROLLED polyline owned by the
   * parent: each click adds a corner (`onSplitAddPoint`), and the parent renders
   * the accumulated `splitDraft` (meter points) back onto the map. Finish with a
   * button / double-click / Enter (`onSplitFinish`); undo the last corner with
   * Backspace (`onSplitUndo`).
   */
  splitMode?: boolean;
  /** Meter-space corners placed so far (for rendering the in-progress divide line). */
  splitDraft?: [number, number][] | null;
  /** The room the divide belongs to (its first corner) — highlighted while drawing. */
  splitRoomId?: string | null;
  /** Add a corner: the point in meters + the room it landed in (null outside any room). */
  onSplitAddPoint?: (point: [number, number], room: RoomSelection | null) => void;
  onSplitFinish?: () => void;
  onSplitUndo?: () => void;
  /**
   * "Merge rooms" mode: clicking a room toggles it in the selection (controlled by
   * the parent via `mergeSelection`). Selected rooms are highlighted.
   */
  mergeMode?: boolean;
  mergeSelection?: string[];
  onToggleMergeRoom?: (room: RoomSelection) => void;
  /** "Clean a room" mode: clicking a room opens its clean-config dialog. */
  cleanMode?: boolean;
  onSelectCleanRoom?: (room: RoomSelection) => void;
}

/** A drawable policy zone (keep-out / no-mop) polygon + its category. */
interface ZonePoly {
  points: string;
  category: string;
}

/** One room feature: its ring polygons, centroid (SVG units), id and current name. */
interface RoomShape {
  id: string | null;
  name: string | null;
  rings: string[];
  /** Numeric outer ring in projected SVG space — for point-in-room hit testing. */
  outerPts: [number, number][];
  cx: number;
  cy: number;
}

/** Ray-casting point-in-polygon test (ring is [x,y] pairs, in any one space). */
function pointInRing(px: number, py: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Where a room's name goes: the area-weighted (shoelace) centroid of its outer ring, and when
 * that falls outside the room (an L shape), the middle of the widest horizontal run through the
 * room at the centroid's height, or failing that at the box's middle (B-122). The plain average
 * of the vertices it replaced counted the ring's repeated closing point and drifted toward it.
 */
export function labelPoint(ring: [number, number][]): [number, number] {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
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
  const c: [number, number] = Math.abs(a) < 1e-9
    // Degenerate (a line): the mean of the distinct points.
    ? [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length]
    : [cx / (3 * a), cy / (3 * a)];
  if (pointInRing(c[0], c[1], pts)) return c;
  const ys = pts.map((p) => p[1]);
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const y of [c[1], midY]) {
    const span = widestSpan(pts, y);
    if (span) return [(span[0] + span[1]) / 2, y];
  }
  return c;
}

/** The widest stretch of a horizontal line at `y` that lies inside the ring. */
function widestSpan(ring: [number, number][], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((p, q) => p - q);
  let best: [number, number] | null = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  }
  return best;
}

/** True for a key press that belongs to a control (a button, a field), not to the map's shortcuts. */
export function isFromControl(target: EventTarget | null): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  return !!el?.closest?.('button, a, input, select, textarea, summary, [role="button"]');
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Walk every coordinate in a geometry, feeding each [x,y] to `visit`. */
function eachPosition(coords: unknown, visit: (p: GeoPosition) => void): void {
  if (!Array.isArray(coords)) return;
  // A position is [number, number, ...]; anything else is a nested array.
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords as GeoPosition);
    return;
  }
  for (const child of coords) eachPosition(child, visit);
}

function extendBounds(fc: GeoFeatureCollection | null | undefined, b: Bounds): void {
  if (!fc?.features) return;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    eachPosition((f.geometry as { coordinates?: unknown }).coordinates, ([x, y]) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (x > b.maxX) b.maxX = x;
      if (y > b.maxY) b.maxY = y;
    });
  }
}

// Target viewBox extent (SVG units) for the longer axis — gives crisp strokes
// regardless of the real-world size of the map in meters.
const VIEW_EXTENT = 1000;
const PAD_RATIO = 0.06; // 6% breathing room around the plan
// Room names never draw smaller than this on screen (B-123: about 8px on a phone before).
const MIN_LABEL_PX = 11;

export default memo(function RoombaMap({
  map,
  loading,
  className,
  running,
  editable,
  onSelectRoom,
  splitMode,
  splitDraft,
  splitRoomId,
  onSplitAddPoint,
  onSplitFinish,
  onSplitUndo,
  mergeMode,
  mergeSelection,
  onToggleMergeRoom,
  cleanMode,
  onSelectCleanRoom,
  error,
  onRetry,
  retrying,
  robotName,
  aside,
}: RoombaMapProps) {
  const geo = map?.geojson;
  // Room hover highlight is driven purely by CSS `:hover` on the hit-area group
  // (see the `.roomba-roomhit` rules in index.css) — no React state, so hovering
  // a dense map triggers zero re-renders.
  // Split ("divide a room") interaction: only the live cursor is local state —
  // the placed corners live in the parent (controlled via splitDraft).
  const [cursor, setCursor] = useState<{ vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Clear the rubber-band cursor whenever split mode toggles off.
  useEffect(() => {
    if (!splitMode) setCursor(null);
  }, [splitMode]);

  // How wide the plan is drawn on screen, in CSS px, so labels keep a readable minimum size.
  // Rounded to 20px steps so a resize doesn't redraw the static layers every frame; it never
  // changes on a position or coverage poll.
  const [drawnWidth, setDrawnWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setDrawnWidth(Math.round(w / 20) * 20);
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Keyboard shortcuts while dividing: Enter finishes (≥2 corners), Backspace
  // removes the last corner. Not when the key belongs to a focused control: Enter on
  // "Cancel divide" must cancel, not finish (B-124).
  useEffect(() => {
    if (!splitMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (isFromControl(e.target)) return;
      const n = splitDraft?.length ?? 0;
      if (e.key === 'Enter' && n >= 2) {
        e.preventDefault();
        onSplitFinish?.();
      } else if (e.key === 'Backspace' && n > 0) {
        e.preventDefault();
        onSplitUndo?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitMode, splitDraft, onSplitFinish, onSplitUndo]);

  const model = useMemo(() => {
    if (!geo) return null;

    const b: Bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    extendBounds(geo.floorPlan, b);
    extendBounds(geo.borders, b);
    extendBounds(geo.rooms, b);
    // Fold the dock in too so it's never clipped off the edge.
    extendBounds(geo.dockPose, b);

    if (!Number.isFinite(b.minX) || !Number.isFinite(b.maxX)) return null;

    const spanX = Math.max(b.maxX - b.minX, 0.01);
    const spanY = Math.max(b.maxY - b.minY, 0.01);
    const scale = VIEW_EXTENT / Math.max(spanX, spanY);
    const pad = Math.max(spanX, spanY) * scale * PAD_RATIO;

    const width = spanX * scale + pad * 2;
    const height = spanY * scale + pad * 2;

    // Meters → SVG. SVG y grows downward, so flip y about the top edge.
    const project = ([x, y]: GeoPosition): [number, number] => [
      (x - b.minX) * scale + pad,
      (b.maxY - y) * scale + pad,
    ];
    // Inverse: SVG (viewBox) → meters. Used to turn a drawn divide line back
    // into the robot's coordinate space.
    const unproject = ([vx, vy]: [number, number]): [number, number] => [
      (vx - pad) / scale + b.minX,
      b.maxY - (vy - pad) / scale,
    ];

    const ringToPoints = (ring: GeoPosition[]): string =>
      ring.map((p) => project(p).map((n) => n.toFixed(1)).join(',')).join(' ');

    // Collect renderable primitives per layer.
    const floorPolys: string[] = [];
    const borderPaths: string[] = [];
    const dockMarkers: Array<[number, number]> = [];

    const collectPolys = (
      fc: GeoFeatureCollection | null | undefined,
      out: string[],
    ): void => {
      if (!fc?.features) return;
      for (const f of fc.features) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'Polygon') {
          for (const ring of g.coordinates) out.push(ringToPoints(ring));
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates)
            for (const ring of poly) out.push(ringToPoints(ring));
        }
      }
    };

    collectPolys(geo.floorPlan, floorPolys);

    // Borders can be polygons (wall outlines) or linestrings.
    if (geo.borders?.features) {
      for (const f of geo.borders.features) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'Polygon') {
          for (const ring of g.coordinates) borderPaths.push(ringToPoints(ring));
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates)
            for (const ring of poly) borderPaths.push(ringToPoints(ring));
        } else if (g.type === 'LineString') {
          borderPaths.push(ringToPoints(g.coordinates));
        }
      }
    }

    // Dock — usually a single Point in dockPose.
    if (geo.dockPose?.features) {
      for (const f of geo.dockPose.features) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'Point') {
          dockMarkers.push(project(g.coordinates));
        } else {
          eachPosition((g as { coordinates?: unknown }).coordinates, (p) =>
            dockMarkers.push(project(p)),
          );
        }
      }
    }

    // Policy zones — keep-out / no-mop polygons + virtual-wall lines. The
    // non-obvious rule (maps.md #4): a virtual wall is a KEEP_OUT_ZONE-typed
    // feature whose GEOMETRY is a LineString, so classify by geometry first.
    const zonePolys: ZonePoly[] = [];
    const wallLines: string[] = [];
    if (geo.policyZones?.features) {
      for (const f of geo.policyZones.features) {
        const g = f.geometry;
        if (!g) continue;
        const category = String(
          (f.properties?.category ?? f.properties?.type ?? '') as string,
        ).toUpperCase();
        if (g.type === 'LineString') {
          wallLines.push(ringToPoints(g.coordinates));
        } else if (g.type === 'Polygon') {
          for (const ring of g.coordinates) zonePolys.push({ points: ringToPoints(ring), category });
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates)
            for (const ring of poly) zonePolys.push({ points: ringToPoints(ring), category });
        }
      }
    }

    // Rooms — one entry per feature, carrying its ring polygons, centroid, id
    // (the map's room_id, used for renaming) and current name. The centroid is
    // taken from the outer ring, matching where the label sits.
    const rooms: RoomShape[] = [];
    if (geo.rooms?.features) {
      for (const f of geo.rooms.features) {
        const g = f.geometry;
        if (!g) continue;
        const rings: string[] = [];
        let outer: GeoPosition[] | null = null;
        if (g.type === 'Polygon') {
          for (const ring of g.coordinates) rings.push(ringToPoints(ring));
          outer = g.coordinates[0] ?? null;
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates)
            for (const ring of poly) rings.push(ringToPoints(ring));
          outer = g.coordinates[0]?.[0] ?? null;
        }
        if (rings.length === 0 || !outer || outer.length === 0) continue;

        const outerPts = outer.map((p) => project(p));
        const [cx, cy] = labelPoint(outerPts);

        const rawName = (f.properties?.name ?? f.properties?.room_name) as unknown;
        const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
        const rawId = f.id;
        const id = rawId == null ? null : String(rawId);

        rooms.push({ id, name, rings, outerPts, cx, cy });
      }
    }

    const hasGeometry =
      floorPolys.length > 0 ||
      rooms.length > 0 ||
      borderPaths.length > 0;

    return {
      width,
      height,
      project,
      unproject,
      floorPolys,
      rooms,
      borderPaths,
      dockMarkers,
      zonePolys,
      wallLines,
      hasGeometry,
      // dock marker radius relative to the map extent
      dockR: Math.max(width, height) * 0.018,
    };
  }, [geo]);

  // Live position — polled only while the robot is running. A 204 (stale/none)
  // comes back as null from the fetcher, which hides the dot.
  const positionQuery = useQuery({
    queryKey: ['roomba-position'],
    queryFn: fetchRoombaPosition,
    enabled: !!running,
    refetchInterval: running ? 2500 : false,
    refetchIntervalInBackground: false,
    staleTime: 2000,
  });
  const position = running ? positionQuery.data ?? null : null;

  // Live cleaning coverage — polled while running, cleared otherwise. A 204
  // (stale/none) comes back null, hiding the layer once a mission ends.
  const coverageQuery = useQuery({
    queryKey: ['roomba-coverage'],
    queryFn: fetchRoombaCoverage,
    enabled: !!running,
    refetchInterval: running ? 5000 : false,
    refetchIntervalInBackground: false,
    staleTime: 4000,
  });

  // Project the coverage polygons into SVG space using the same transform as the
  // map, tagged cleaned (vacuumed) vs traveled so they render at different shades.
  const coverageLayer = useMemo(() => {
    const cov = running ? coverageQuery.data ?? null : null;
    if (!cov?.coverage?.features || !model) return [];
    const project = model.project;
    const ringsToPath = (rings: GeoPosition[][]): string => {
      let d = '';
      for (const ring of rings) {
        ring.forEach((p, i) => {
          const [px, py] = project(p);
          d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)} `;
        });
        d += 'Z ';
      }
      return d;
    };
    const out: Array<{ mode: 'cleaned' | 'traveled'; d: string }> = [];
    for (const f of cov.coverage.features) {
      const g = f.geometry;
      if (!g) continue;
      const modes = (f.properties?.operatingModes as string[] | undefined) ?? [];
      const mode: 'cleaned' | 'traveled' =
        modes.includes('vacuuming') || modes.includes('mopping') ? 'cleaned' : 'traveled';
      let d = '';
      if (g.type === 'Polygon') d = ringsToPath(g.coordinates);
      else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) d += ringsToPath(poly);
      if (d) out.push({ mode, d });
    }
    // Traveled first, cleaned painted on top (darker).
    out.sort((a, b) => (a.mode === 'cleaned' ? 1 : 0) - (b.mode === 'cleaned' ? 1 : 0));
    return out;
  }, [running, coverageQuery.data, model]);

  // ── Static SVG layers ──────────────────────────────────────────────
  // These depend only on the map geometry + interaction state (hover/merge/mode),
  // never on the live position or coverage. Memoizing them keeps the ~100-300
  // floor/room/zone/wall/dock/label/hit-area nodes from being reconciled on
  // every position poll (2.5s) and coverage poll (5s) during a running mission —
  // only the robot dot + coverage layer re-render between polls. The stack is
  // split around the live coverage layer to preserve z-order: base renders under
  // coverage, overlay renders over it.
  const isSplitting = !!splitMode && !!onSplitAddPoint;
  const isMerging = !!mergeMode && !!onToggleMergeRoom;
  const isCleaning = !!cleanMode && !!onSelectCleanRoom;
  const canEdit = !!editable && !!onSelectRoom && !isSplitting && !isMerging && !isCleaning;

  const staticBase = useMemo(() => {
    if (!model) return null;
    const { floorPolys, rooms, width, height } = model;
    const maxDim = Math.max(width, height);
    const mergeSet = isMerging ? new Set(mergeSelection ?? []) : null;
    return (
      <>
        {/* Floor plan — the outer walkable surface */}
        {floorPolys.map((pts, i) => (
          <polygon
            key={`floor-${i}`}
            points={pts}
            fill="var(--appsurface)"
            stroke="var(--appborder-strong)"
            strokeWidth={Math.max(width, height) * 0.003}
            strokeLinejoin="round"
          />
        ))}

        {/* Rooms — a faint ink wash (decorative; interaction layer is below).
            The hover highlight lives on the hit-area layer via CSS, so these fills
            depend only on merge selection. */}
        {rooms.map((room, ri) => {
          const mergeSelected = !!(mergeSet && room.id && mergeSet.has(room.id));
          return room.rings.map((pts, i) => (
            <polygon
              key={`room-${ri}-${i}`}
              points={pts}
              fill={mergeSelected ? 'var(--apptext)' : 'var(--appmap-room)'}
              fillOpacity={mergeSelected ? 0.22 : 1}
              stroke={mergeSelected ? 'var(--apptext)' : 'var(--appborder)'}
              strokeWidth={maxDim * (mergeSelected ? 0.005 : 0.003)}
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
            />
          ));
        })}
      </>
    );
  }, [model, isMerging, mergeSelection]);

  const staticOverlay = useMemo(() => {
    if (!model) return null;
    const { rooms, borderPaths, dockMarkers, zonePolys, wallLines, width, height, dockR } = model;
    const maxDim = Math.max(width, height);
    const mergeSet = isMerging ? new Set(mergeSelection ?? []) : null;
    const interactive = canEdit || isMerging || isCleaning;
    // viewBox units per CSS px; labels and glyphs keep a readable on-screen minimum (B-123).
    const unitsPerPx = drawnWidth > 0 ? width / drawnWidth : 0;
    const labelSize = Math.max(maxDim * 0.024, MIN_LABEL_PX * unitsPerPx);
    const promptSize = Math.max(maxDim * 0.022, MIN_LABEL_PX * unitsPerPx);
    const glyphSize = Math.max(maxDim * 0.03, 16 * unitsPerPx);
    return (
      <>
        {/* Keep-out / no-mop zones — hatched, distinct per category */}
        {zonePolys.map((z, i) => {
          const noMop = isNoMop(z.category);
          return (
            <polygon
              key={`zone-${i}`}
              points={z.points}
              fill={noMop ? 'var(--apptint-warn)' : 'var(--apptint-problem)'}
              stroke={noMop ? 'var(--apptext-warning)' : 'var(--apptext-danger)'}
              strokeWidth={maxDim * 0.004}
              strokeDasharray={`${maxDim * 0.012} ${maxDim * 0.008}`}
              strokeLinejoin="round"
            />
          );
        })}

        {/* Borders / walls — strong outline */}
        {borderPaths.map((pts, i) => (
          <polyline
            key={`border-${i}`}
            points={pts}
            fill="none"
            stroke="var(--appmap-wall)"
            strokeWidth={maxDim * 0.006}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Virtual walls — LineString policy zones, dashed problem-coloured */}
        {wallLines.map((pts, i) => (
          <polyline
            key={`vwall-${i}`}
            points={pts}
            fill="none"
            stroke="var(--apptext-danger)"
            strokeWidth={maxDim * 0.007}
            strokeDasharray={`${maxDim * 0.016} ${maxDim * 0.01}`}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Dock marker: a small plate with the dock icon, like the legend's key */}
        {dockMarkers.map(([cx, cy], i) => {
          const s = Math.max(dockR * 2.6, 24 * unitsPerPx);
          return (
            <g key={`dock-${i}`}>
              <rect
                x={cx - s / 2}
                y={cy - s / 2}
                width={s}
                height={s}
                rx={s * 0.25}
                fill="var(--appsurface)"
                stroke="var(--appborder-strong)"
                strokeWidth={s * 0.04}
              />
              <use
                href="#fp-i-dock"
                x={cx - s * 0.32}
                y={cy - s * 0.32}
                width={s * 0.64}
                height={s * 0.64}
                fill="none"
                stroke="var(--apptext)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Room name labels — centered on each named room's centroid. In edit
            mode, unnamed rooms show a "Name this room" prompt instead. */}
        {rooms.map((room, i) => {
          const label = room.name ?? (canEdit && room.id ? 'Name this room' : null);
          if (!label) return null;
          const isPrompt = !room.name;
          return (
            <text
              key={`roomlabel-${i}`}
              x={room.cx}
              y={room.cy}
              fill={isPrompt ? 'var(--apptext-muted)' : 'var(--apptext-soft)'}
              fontSize={isPrompt ? promptSize : labelSize}
              fontWeight={isPrompt ? 500 : 600}
              fontStyle={isPrompt ? 'italic' : 'normal'}
              textAnchor="middle"
              dominantBaseline="middle"
              // Names as written (not silk-screen caps, which are too wide for small rooms on a
              // phone); a halo in the floor colour keeps a name readable where it crosses a wall.
              style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
              stroke="var(--appsurface)"
              strokeWidth={labelSize * 0.28}
              strokeLinejoin="round"
            >
              {label}
            </text>
          );
        })}

        {/* Interaction layer — clickable room hit areas. Active for rename (edit
            mode) OR merge selection. On top so clicks land regardless of z-order. */}
        {interactive &&
          rooms
            .filter((room) => room.id)
            .map((room, ri) => {
              const sel: RoomSelection = { id: room.id as string, name: room.name };
              const act = () =>
                isMerging
                  ? onToggleMergeRoom?.(sel)
                  : isCleaning
                    ? onSelectCleanRoom?.(sel)
                    : onSelectRoom?.(sel);
              const mergeSelected = !!(mergeSet && mergeSet.has(room.id as string));
              const roomLabel = room.name ?? 'unnamed room';
              return (
                <g
                  key={`roomhit-${ri}`}
                  // CSS `:hover` on this class drives the highlight (stroke for any
                  // interactive mode; a soft fill too when editable) — no React state.
                  className={`roomba-roomhit${canEdit ? ' roomba-roomhit-editable' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    isMerging
                      ? `${mergeSelected ? 'Deselect' : 'Select'} ${roomLabel} to merge`
                      : isCleaning
                        ? `Clean ${roomLabel}`
                        : `Rename ${roomLabel}`
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={act}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      act();
                    }
                  }}
                >
                  {room.rings.map((pts, i) => (
                    <polygon
                      key={`hit-${ri}-${i}`}
                      points={pts}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={maxDim * 0.005}
                      strokeLinejoin="round"
                    />
                  ))}
                  {/* Affordance glyph from the icon sprite: a check on a selected merge
                      room, play in clean mode, a pencil on a named room in rename mode */}
                  {(isMerging ? mergeSelected : isCleaning || !!room.name) && (
                    <use
                      href={`#fp-i-${isMerging ? 'check' : isCleaning ? 'play' : 'edit'}`}
                      x={room.cx - glyphSize / 2}
                      y={room.cy + labelSize * 0.8}
                      width={glyphSize}
                      height={glyphSize}
                      fill="none"
                      stroke={isMerging ? 'var(--apptext)' : 'var(--apptext-muted)'}
                      strokeWidth={isMerging ? 2.2 : 1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              );
            })}
      </>
    );
  }, [model, isMerging, isCleaning, canEdit, mergeSelection, onToggleMergeRoom, onSelectCleanRoom, onSelectRoom, drawnWidth]);

  // The legend names only the marks this plan actually has.
  const legend = useMemo(() => {
    if (!model) return null;
    return {
      keepOut: model.zonePolys.some((z) => !isNoMop(z.category)),
      noMop: model.zonePolys.some((z) => isNoMop(z.category)),
      wall: model.wallLines.length > 0,
      dock: model.dockMarkers.length > 0,
    };
  }, [model]);

  // Loading, failed or no map yet: the state in the map's place, the aside (the battery) kept.
  const holder = (body: ReactNode) => (
    <div className={className}>
      {body}
      {aside != null && <div className="mt-3 flex justify-end">{aside}</div>}
    </div>
  );
  if (loading) {
    return holder(
      <Loading label="Loading the floor plan">
        <SkelBlock height={240} />
      </Loading>,
    );
  }

  // The first load failed: say so (B-005), with a way to try again.
  if (error && !map) {
    return holder(<ErrorState compact title="Couldn't load the floor plan" onRetry={onRetry} retrying={retrying} />);
  }

  // 204 / no map yet, or a map row with no drawable geometry.
  if (!model || !model.hasGeometry) {
    return holder(
      <EmptyState compact icon="map" title="No map yet">
        The robot builds its floor map over its first few cleans. The rooms appear here once it has mapped one.
      </EmptyState>,
    );
  }

  const {
    width,
    height,
    project,
    unproject,
    rooms,
  } = model;
  const maxDim = Math.max(width, height);
  // isSplitting / isMerging / isCleaning / canEdit are computed above the early
  // returns (needed by the memoized static layers). The static room/zone/wall/
  // dock/label/hit-area JSX lives in `staticBase` / `staticOverlay`; only the
  // live coverage, robot dot and split preview render inline below.
  const draftPts = isSplitting ? splitDraft ?? [] : [];

  // Convert a mouse event to viewBox (SVG user-space) coordinates via the CTM.
  const eventToViewBox = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return [local.x, local.y];
  };

  const roomAt = (vx: number, vy: number): RoomShape | null => {
    for (const room of rooms) {
      if (room.id && pointInRing(vx, vy, room.outerPts)) return room;
    }
    return null;
  };

  const handleSplitClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!isSplitting) return;
    // The 2nd click of a double-click also fires onClick (detail === 2); ignore it
    // so a double-click places one final corner (detail 1) and then finishes.
    if (e.detail > 1) return;
    const vb = eventToViewBox(e);
    if (!vb) return;
    const [vx, vy] = vb;
    const room = roomAt(vx, vy);
    onSplitAddPoint?.(unproject([vx, vy]), room ? { id: room.id as string, name: room.name } : null);
    setCursor({ vx, vy });
  };

  const handleSplitDblClick = () => {
    if (isSplitting && draftPts.length >= 2) onSplitFinish?.();
  };

  const handleSplitMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!isSplitting || draftPts.length === 0) return;
    const vb = eventToViewBox(e);
    if (vb) setCursor({ vx: vb[0], vy: vb[1] });
  };

  // Live robot dot geometry, in the SAME projected space as everything else.
  // The heading is drawn in SVG space where y grows downward, so the meter-space
  // angle theta maps to (cos θ, −sin θ). theta is provisional (may point out the
  // robot's back — see maps.md #1); still useful as a facing hint.
  const unitsPerPx = drawnWidth > 0 ? width / drawnWidth : 0;
  const robot =
    position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? (() => {
          const [cx, cy] = project([position.x, position.y]);
          const r = Math.max(maxDim * 0.016, 7 * unitsPerPx);
          const theta = typeof position.theta === 'number' ? position.theta : null;
          const L = r * 2.4;
          const head =
            theta != null
              ? { hx: cx + L * Math.cos(theta), hy: cy - L * Math.sin(theta) }
              : null;
          return { cx, cy, r, head };
        })()
      : null;

  const interactive = canEdit || isMerging || isCleaning;
  const name = robotName?.trim() || 'Robot';

  return (
    <div className={className}>
      <div ref={measureRef} className="overflow-hidden rounded-well border border-appborder bg-appmap-floor p-2 sm:p-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        className="block h-auto w-full"
        // An image while it is only a picture; a group while its rooms are keys, because an
        // image's children are hidden from screen readers (B-121).
        role={interactive ? 'group' : 'img'}
        aria-label={`Floor plan${map?.name ? `: ${map.name}` : ''}`}
        preserveAspectRatio="xMidYMid meet"
        style={isSplitting ? { cursor: 'crosshair' } : undefined}
        onClick={isSplitting ? handleSplitClick : undefined}
        onDoubleClick={isSplitting ? handleSplitDblClick : undefined}
        onMouseMove={isSplitting ? handleSplitMove : undefined}
      >
        {/* Static base layers (floor + room fills) — memoized; unaffected by
            position/coverage polls. */}
        {staticBase}

        {/* Live cleaning coverage — traveled-through (lighter) vs vacuumed
            (darker), painted over the light room fill so cleaned area reads as
            progress. Drawn under walls so outlines stay crisp. */}
        {coverageLayer.map((c, i) => (
          <path
            key={`cov-${i}`}
            d={c.d}
            fillRule="evenodd"
            fill="var(--apptext)"
            fillOpacity={c.mode === 'cleaned' ? 0.16 : 0.06}
            stroke="none"
            style={{ pointerEvents: 'none' }}
          />
        ))}

        {/* Static overlay layers (zones, walls, dock, labels, room hit-areas) —
            memoized; unaffected by position/coverage polls. */}
        {staticOverlay}

        {/* Live robot dot + heading — same project() space, hidden when stale */}
        {robot && (
          <g aria-label={`${name}'s position`}>
            {robot.head && (
              <line
                x1={robot.cx}
                y1={robot.cy}
                x2={robot.head.hx}
                y2={robot.head.hy}
                stroke="var(--apptext)"
                strokeWidth={robot.r * 0.45}
                strokeLinecap="round"
              />
            )}
            {/* Pulsing halo — CSS transform/opacity animation (GPU-composited,
                survives React reconciles) instead of perpetual SMIL <animate>
                nodes that force a repaint loop and re-mount on every render. */}
            <circle
              className="roomba-halo"
              cx={robot.cx}
              cy={robot.cy}
              r={robot.r * 2.4}
              fill="var(--apptext)"
              fillOpacity={0.18}
            />
            <circle
              cx={robot.cx}
              cy={robot.cy}
              r={robot.r}
              fill="var(--apptext)"
              stroke="var(--appmap-floor)"
              strokeWidth={robot.r * 0.4}
            />
          </g>
        )}

        {/* Divide-a-room preview — the room being split + the multi-corner path */}
        {isSplitting && draftPts.length > 0 && (() => {
          // Project the placed corners (meters) back to SVG for drawing.
          const proj = draftPts.map((p) => project(p));
          const polyPts = proj.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          const last = proj[proj.length - 1];
          return (
            <g style={{ pointerEvents: 'none' }}>
              {/* Highlight the room being divided */}
              {rooms
                .filter((room) => room.id === splitRoomId)
                .flatMap((room, ri) =>
                  room.rings.map((pts, i) => (
                    <polygon
                      key={`split-room-${ri}-${i}`}
                      points={pts}
                      fill="var(--apptext)"
                      fillOpacity={0.12}
                      stroke="var(--apptext)"
                      strokeWidth={maxDim * 0.004}
                      strokeLinejoin="round"
                    />
                  )),
                )}
              {/* The placed segments */}
              {proj.length >= 2 && (
                <polyline
                  points={polyPts}
                  fill="none"
                  stroke="var(--apptext-danger)"
                  strokeWidth={maxDim * 0.006}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {/* Rubber-band from the last corner to the cursor */}
              {cursor && (
                <line
                  x1={last[0]}
                  y1={last[1]}
                  x2={cursor.vx}
                  y2={cursor.vy}
                  stroke="var(--apptext-danger)"
                  strokeOpacity={0.6}
                  strokeWidth={maxDim * 0.006}
                  strokeDasharray={`${maxDim * 0.014} ${maxDim * 0.009}`}
                  strokeLinecap="round"
                />
              )}
              {/* Corner handles */}
              {proj.map(([x, y], i) => (
                <circle
                  key={`corner-${i}`}
                  cx={x}
                  cy={y}
                  r={maxDim * (i === 0 ? 0.013 : 0.01)}
                  fill="var(--apptext-danger)"
                  stroke="var(--appsurface)"
                  strokeWidth={maxDim * 0.004}
                />
              ))}
            </g>
          );
        })()}
      </svg>
      </div>
      {(aside != null || legend) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ul className="fp-dial-legend justify-start" aria-label="Map key">
            {coverageLayer.length > 0 && <MapKey kind="cleaned">Cleaned this run</MapKey>}
            {legend?.keepOut && <MapKey kind="keepout">Off-limits</MapKey>}
            {legend?.noMop && <MapKey kind="nomop">No mopping</MapKey>}
            {legend?.wall && <MapKey kind="wall">Virtual wall</MapKey>}
            {robot && <MapKey kind="dot">{name}</MapKey>}
            {legend?.dock && <MapKey kind="dock">Dock</MapKey>}
          </ul>
          {aside}
        </div>
      )}
    </div>
  );
});

function isNoMop(category: string): boolean {
  return category.includes('NO_MOP') || category.includes('MOP');
}

/** One legend entry, its key drawn like the mark it explains. */
function MapKey({ kind, children }: { kind: 'cleaned' | 'keepout' | 'nomop' | 'wall' | 'dot' | 'dock'; children: ReactNode }) {
  const key =
    kind === 'dock' ? <Icon name="dock" className="fp-icon--s" />
      : kind === 'dot' ? <span className="inline-block h-2.5 w-2.5 rounded-full bg-apptext" />
        : kind === 'wall' ? <span className="inline-block w-4 border-t-2 border-dashed border-apptext-danger" />
          : kind === 'keepout' ? <span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-dashed border-apptext-danger bg-apptint-problem" />
            : kind === 'nomop' ? <span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-dashed border-apptext-warning bg-apptint-warn" />
              : <span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-appborder bg-[color-mix(in_srgb,var(--apptext)_16%,transparent)]" />;
  return (
    <li className="fp-lg-item">
      <span aria-hidden="true" className="inline-flex">{key}</span>
      {children}
    </li>
  );
}
