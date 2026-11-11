import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRoombaPosition, fetchRoombaCoverage, type RoombaPasses } from '../api/roomba';
import { EmptyState, ErrorState, Icon, Loading, SkelBlock } from './ui';
import {
  alternateTones,
  boxInRings,
  fitRoomLabel,
  labelPoint as labelPointOf,
  poleOfInaccessibility,
  pointInRings,
  roomNeighbours,
  type LabelFit,
  type Pt,
} from '../utils/mapLabels';
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
  /**
   * The rooms the last finished clean covered, drawn as faint lanes while the robot is docked,
   * and the key's words for it ("Cleaned yesterday"). Keep it referentially stable.
   */
  lastClean?: LastClean | null;
}

/** The last finished clean, for the docked map's quiet "cleaned" lanes. */
export interface LastClean {
  rooms: string[];
  label: string;
}

/** A drawable policy zone (keep-out / no-mop) polygon + its category. */
interface ZonePoly {
  points: string;
  category: string;
}

/** One room feature: its ring polygons, label anchor (SVG units), id and current name. */
interface RoomShape {
  id: string | null;
  name: string | null;
  rings: string[];
  /** Numeric outer ring in projected SVG space — for point-in-room hit testing. */
  outerPts: [number, number][];
  /** The first polygon's rings (outer + holes), numeric — for label fitting. */
  labelRings: Pt[][];
  /** The room's visual centre (pole of inaccessibility) and its clearance to the walls. */
  cx: number;
  cy: number;
  clearance: number;
  /** Which of the alternating plate tones this room takes (no two neighbours share one). */
  tone: number;
}

/** Where a room's label sits: its pole of inaccessibility (B-122). Kept here for the tests. */
export const labelPoint = labelPointOf;

/** Ray-casting point-in-polygon test (ring is [x,y] pairs, in any one space). */
function pointInRing(px: number, py: number, ring: [number, number][]): boolean {
  return pointInRings(px, py, [ring]);
}

/** A room name as drawn: its lines, size and width, or a number that the key spells out. */
interface RoomLabel {
  x: number;
  y: number;
  text: string;
  isPrompt: boolean;
  fit: LabelFit | null;
  /** 1-based number shown in the room when the name doesn't fit; the key lists it. */
  keyNo: number | null;
  /** Drawn reading upward (a tall, narrow room). */
  rotated: boolean;
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
// Breathing room around the plan, inside the well (the well itself has no padding, so the
// plan gets nearly the full width on a phone). Marks at the very edge may spill into it.
const PAD_RATIO = 0.045;
// Room names never draw smaller than this on screen (B-123: about 8px on a phone before),
// and no bigger than this in a big room: type is sized for the eye, not the floor area.
const MIN_LABEL_PX = 11;
const MAX_LABEL_PX = 13;
const MAX_LABEL_PX_WIDE = 14;
// A plan drawn at least this wide (a desktop) may use the larger name size.
const WIDE_PLAN_PX = 520;
// The plate tones that alternate between neighbouring rooms (tokens in index.css).
const PLATE = ['var(--appmap-plate)', 'var(--appmap-plate-alt)', 'var(--appmap-plate-alt2)'];

/** viewBox units per CSS px; before the plan is measured, assume a 600px drawing. */
function unitsPerPx(viewWidth: number, drawnWidth: number): number {
  return drawnWidth > 0 ? viewWidth / drawnWidth : viewWidth / 600;
}

/** An id safe inside url(#…): React's useId() has colons. */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

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
  lastClean,
}: RoombaMapProps) {
  const geo = map?.geojson;
  // Room hover highlight is driven purely by CSS `:hover` on the hit-area group
  // (see the `.roomba-roomhit` rules in index.css) — no React state, so hovering
  // a dense map triggers zero re-renders.
  // Split ("divide a room") interaction: only the live cursor is local state —
  // the placed corners live in the parent (controlled via splitDraft).
  const [cursor, setCursor] = useState<{ vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Pattern / clip ids, unique per map on the page.
  const idGrid = useSvgId('fpmap-grid');
  const idLanes = useSvgId('fpmap-lanes');
  const idTwice = useSvgId('fpmap-twice');
  const idCleaned = useSvgId('fpmap-cleaned');
  const idNotCleaned = useSvgId('fpmap-notcleaned');
  const idLast = useSvgId('fpmap-last');
  const idKeepOut = useSvgId('fpmap-keepout');
  const idNoMop = useSvgId('fpmap-nomop');
  const idClip = useSvgId('fpmap-clip');

  // Clear the rubber-band cursor whenever split mode toggles off.
  useEffect(() => {
    if (!splitMode) setCursor(null);
  }, [splitMode]);

  // How wide the plan is drawn on screen, in CSS px, so labels and marks keep a readable size.
  // Measured on the svg itself (its height can be capped on a tall plan, which letterboxes the
  // drawing), rounded to 10px steps so a resize doesn't redraw the static layers every frame;
  // it never changes on a position or coverage poll.
  const [drawnWidth, setDrawnWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const setSvg = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const vb = el.viewBox?.baseVal;
      const w = vb && vb.width > 0 && vb.height > 0 && r.height > 0
        ? Math.min(r.width, (r.height * vb.width) / vb.height)
        : r.width;
      setDrawnWidth(Math.round(w / 10) * 10);
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

    // Rooms — one entry per feature, carrying its ring polygons, label anchor, id
    // (the map's room_id, used for renaming) and current name. The label sits at the
    // visual centre of the room's first polygon (its pole of inaccessibility).
    const maxDim = Math.max(width, height);
    const rooms: RoomShape[] = [];
    if (geo.rooms?.features) {
      for (const f of geo.rooms.features) {
        const g = f.geometry;
        if (!g) continue;
        const rings: string[] = [];
        let first: GeoPosition[][] | null = null;
        if (g.type === 'Polygon') {
          for (const ring of g.coordinates) rings.push(ringToPoints(ring));
          first = g.coordinates;
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates)
            for (const ring of poly) rings.push(ringToPoints(ring));
          first = g.coordinates[0] ?? null;
        }
        const outer = first?.[0];
        if (rings.length === 0 || !first || !outer || outer.length === 0) continue;

        const outerPts = outer.map((p) => project(p));
        const labelRings = first.filter((r) => r.length > 0).map((r) => r.map((p) => project(p)));
        const pole = poleOfInaccessibility(labelRings, maxDim / 500);

        const rawName = (f.properties?.name ?? f.properties?.room_name) as unknown;
        const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
        const rawId = f.id;
        const id = rawId == null ? null : String(rawId);

        rooms.push({ id, name, rings, outerPts, labelRings, cx: pole.x, cy: pole.y, clearance: pole.d, tone: 0 });
      }
    }
    // Neighbouring rooms take different plate tones, so a wall-less doorway still reads as
    // two rooms. A shared wall is 2% of the plan long or more; a corner touch doesn't count.
    const tones = alternateTones(roomNeighbours(rooms.map((r) => r.outerPts), maxDim * 0.004, maxDim * 0.02));
    rooms.forEach((r, i) => {
      r.tone = tones[i] ?? 0;
    });

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
      // viewBox units per metre, and where a whole metre falls (for the scale grid)
      scale,
      gridX: pad + (Math.ceil(b.minX) - b.minX) * scale,
      gridY: pad + (b.maxY - Math.floor(b.maxY)) * scale,
      // dock marker radius relative to the map extent
      dockR: maxDim * 0.018,
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
  // map, tagged cleaned (vacuumed) vs traveled so they render at different shades,
  // plus the ground cleaned twice or more (the poller's pass count).
  const coverageLayer = useMemo(() => {
    const cov = running ? coverageQuery.data ?? null : null;
    if (!cov?.coverage?.features || !model) return { paths: [], cleaned: '', twice: '' };
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
    // The twice-over area is drawn only inside the cloud's cleaned ground, so the two
    // layers always agree (the pass count comes from a different source).
    const cleaned = out.filter((c) => c.mode === 'cleaned').map((c) => c.d).join('');
    return { paths: out, cleaned, twice: cleaned ? twicePath(cov.passes, project) : '' };
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

  // Room names: each fitted inside its room at the room's visual centre — as large as the room
  // allows (up to MAX_LABEL_PX), on two lines before giving up, read upward in a tall narrow
  // room, and never under MIN_LABEL_PX. A room too small for its name on this screen gets a number, and
  // the key under the map spells it out. Depends on the drawn width, never on a poll.
  const labels = useMemo(() => {
    const list: Array<RoomLabel | null> = [];
    const keyed: Array<{ n: number; name: string }> = [];
    if (!model) return { list, keyed };
    const upp = unitsPerPx(model.width, drawnWidth);
    const maxPx = drawnWidth >= WIDE_PLAN_PX ? MAX_LABEL_PX_WIDE : MAX_LABEL_PX;
    for (const room of model.rooms) {
      const text = room.name ?? (canEdit && room.id ? 'Name this room' : null);
      if (!text) {
        list.push(null);
        continue;
      }
      const roomPx = room.clearance / upp;
      const maxSize = Math.min(maxPx, Math.max(MIN_LABEL_PX, roomPx * 0.55)) * upp;
      const opts = { maxSize, minSize: MIN_LABEL_PX * upp };
      let fit = fitRoomLabel(text, (hw, hh) => boxInRings(room.labelRings, room.cx, room.cy, hw, hh), opts);
      // A tall, narrow room (a bathroom, a closet) reads its name up the room, as on a plan.
      let rotated = false;
      if (!fit) {
        fit = fitRoomLabel(text, (hw, hh) => boxInRings(room.labelRings, room.cx, room.cy, hh, hw), opts);
        rotated = !!fit;
      }
      // An unnamed room's prompt that doesn't fit is left out; the Rooms list names it.
      if (!fit && !room.name) {
        list.push(null);
        continue;
      }
      const keyNo = fit ? null : keyed.length + 1;
      if (keyNo != null && room.name) keyed.push({ n: keyNo, name: room.name });
      list.push({ x: room.cx, y: room.cy, text, isPrompt: !room.name, fit, keyNo, rotated });
    }
    return { list, keyed };
  }, [model, drawnWidth, canEdit]);

  const lastCleanSet = useMemo(() => new Set(lastClean?.rooms ?? []), [lastClean]);

  const staticBase = useMemo(() => {
    if (!model) return null;
    const { floorPolys, rooms, width, height, scale, gridX, gridY } = model;
    const maxDim = Math.max(width, height);
    const upp = unitsPerPx(width, drawnWidth);
    const mergeSet = isMerging ? new Set(mergeSelection ?? []) : null;
    // The scale grid: a dot every metre (every 2 m when a metre is under 12px on screen).
    const step = scale / upp >= 12 ? scale : scale * 2;
    const lane = 4 * upp; // cleaned lanes: a fine rule every 4px, like the robot's passes
    const hatch = 5 * upp;
    return (
      <>
        <defs>
          <pattern id={idGrid} patternUnits="userSpaceOnUse" x={gridX - step / 2} y={gridY - step / 2} width={step} height={step}>
            <circle cx={step / 2} cy={step / 2} r={0.9 * upp} fill="var(--appmap-grid)" />
          </pattern>
          {/* Cleaned this run: fine lanes over a wash, in the cleaned colour. */}
          <pattern id={idLanes} patternUnits="userSpaceOnUse" width={lane * 4} height={lane}>
            <rect width={lane * 4} height={lane} fill="var(--appmap-cleaned)" fillOpacity={0.12} />
            <rect y={lane / 2 - 0.5 * upp} width={lane * 4} height={upp} fill="var(--appmap-cleaned)" fillOpacity={0.6} />
          </pattern>
          {/* Cleaned twice: laid over the lanes above, it adds rules across them (a
              second pass, crosswise) and deepens the wash, so twice-over ground reads
              as ruled both ways, not only as a darker shade. */}
          <pattern id={idTwice} patternUnits="userSpaceOnUse" width={lane} height={lane}>
            <rect width={lane} height={lane} fill="var(--appmap-cleaned)" fillOpacity={0.16} />
            <rect x={lane / 2 - 0.5 * upp} width={upp} height={lane} fill="var(--appmap-cleaned)" fillOpacity={0.45} />
          </pattern>
          {/* The last clean, when docked: the same lanes, wider apart and faint. */}
          <pattern id={idLast} patternUnits="userSpaceOnUse" width={lane * 4} height={lane * 1.25}>
            <rect y={lane * 0.625 - 0.45 * upp} width={lane * 4} height={0.9 * upp} fill="var(--apptext)" fillOpacity={0.11} />
          </pattern>
          <pattern id={idKeepOut} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
            <rect width={hatch} height={hatch} fill="var(--apptint-problem)" />
            <rect width={1.1 * upp} height={hatch} fill="var(--apptext-danger)" fillOpacity={0.55} />
          </pattern>
          <pattern id={idNoMop} patternUnits="userSpaceOnUse" width={hatch} height={hatch}>
            <rect width={hatch} height={hatch} fill="var(--apptint-warn)" />
            <circle cx={hatch / 2} cy={hatch / 2} r={0.95 * upp} fill="var(--apptext-warning)" fillOpacity={0.7} />
          </pattern>
          {/* Live coverage is clipped to the floor, so a pass that brushes a wall stays inside it. */}
          <clipPath id={idClip}>
            {(floorPolys.length > 0 ? floorPolys : rooms.flatMap((r) => r.rings)).map((pts, i) => (
              <polygon key={i} points={pts} />
            ))}
          </clipPath>
        </defs>

        {/* The well: a metre grid for scale, under the plan, filling the whole well. */}
        <rect
          x={-width}
          y={-height}
          width={width * 3}
          height={height * 3}
          fill={`url(#${idGrid})`}
          style={{ pointerEvents: 'none' }}
        />

        {/* Floor plan — the outer walkable surface, a plate over the grid */}
        {floorPolys.map((pts, i) => (
          <polygon
            key={`floor-${i}`}
            points={pts}
            fill="var(--appmap-plate)"
            stroke="var(--appborder-strong)"
            strokeWidth={maxDim * 0.002}
            strokeLinejoin="round"
          />
        ))}

        {/* Rooms — enamel plates in alternating tones with a hairline edge (decorative; the
            interaction layer is in the overlay). The hover highlight lives on the hit-area
            layer via CSS, so these depend only on the merge selection and the last clean. */}
        {rooms.map((room, ri) => {
          const mergeSelected = !!(mergeSet && room.id && mergeSet.has(room.id));
          const lastCleaned = !!(room.name && lastCleanSet.has(room.name));
          return room.rings.map((pts, i) => (
            <g key={`room-${ri}-${i}`} style={{ pointerEvents: 'none' }}>
              <polygon
                points={pts}
                fill={PLATE[room.tone] ?? PLATE[0]}
                stroke="var(--appborder)"
                strokeWidth={Math.max(maxDim * 0.0018, upp)}
                strokeLinejoin="round"
              />
              {lastCleaned && <polygon points={pts} fill={`url(#${idLast})`} />}
              {mergeSelected && (
                <polygon
                  points={pts}
                  fill="var(--appaccent)"
                  fillOpacity={0.2}
                  stroke="var(--appaccent)"
                  strokeWidth={2 * upp}
                  strokeLinejoin="round"
                />
              )}
            </g>
          ));
        })}
      </>
    );
  }, [model, isMerging, mergeSelection, drawnWidth, lastCleanSet, idGrid, idLanes, idTwice, idLast, idKeepOut, idNoMop, idClip]);

  const staticOverlay = useMemo(() => {
    if (!model) return null;
    const { rooms, borderPaths, dockMarkers, zonePolys, wallLines, width, height, dockR } = model;
    const maxDim = Math.max(width, height);
    const mergeSet = isMerging ? new Set(mergeSelection ?? []) : null;
    const interactive = canEdit || isMerging || isCleaning;
    // viewBox units per CSS px; labels and glyphs keep a readable on-screen size (B-123).
    const upp = unitsPerPx(width, drawnWidth);
    const glyphSize = 16 * upp;
    const wallW = Math.max(maxDim * 0.0055, 2.5 * upp);
    return (
      <>
        {/* Keep-out zones: a diagonal hatch in a solid red edge. No-mop zones: a dot screen
            in a dashed amber edge. The key under the map draws the same two. */}
        {zonePolys.map((z, i) => {
          const noMop = isNoMop(z.category);
          return (
            <polygon
              key={`zone-${i}`}
              points={z.points}
              fill={`url(#${noMop ? idNoMop : idKeepOut})`}
              stroke={noMop ? 'var(--apptext-warning)' : 'var(--apptext-danger)'}
              strokeWidth={1.25 * upp}
              strokeDasharray={noMop ? `${4 * upp} ${3 * upp}` : undefined}
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
            />
          );
        })}

        {/* Borders / walls — ink, the heaviest line on the plate. Doorways are the gaps. */}
        {borderPaths.map((pts, i) => (
          <polyline
            key={`border-${i}`}
            points={pts}
            fill="none"
            stroke="var(--appmap-wall)"
            strokeWidth={wallW}
            strokeLinejoin="miter"
            strokeLinecap="square"
            style={{ pointerEvents: 'none' }}
          />
        ))}

        {/* Virtual walls — LineString policy zones: a dashed red rule with a stop bar at each end */}
        {wallLines.map((pts, i) => {
          const coords = pts.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
          const bar = 5 * upp;
          const ends = [
            [coords[0], coords[1]],
            [coords[coords.length - 1], coords[coords.length - 2]],
          ].filter(([a, b]) => a && b) as Array<[[number, number], [number, number]]>;
          return (
            <g key={`vwall-${i}`} style={{ pointerEvents: 'none' }}>
              <polyline
                points={pts}
                fill="none"
                stroke="var(--apptext-danger)"
                strokeWidth={2.25 * upp}
                strokeDasharray={`${5 * upp} ${3.5 * upp}`}
                strokeLinejoin="round"
              />
              {ends.map(([a, b], k) => {
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
                const nx = (-(b[1] - a[1]) / len) * bar;
                const ny = ((b[0] - a[0]) / len) * bar;
                return (
                  <line
                    key={k}
                    x1={a[0] - nx}
                    y1={a[1] - ny}
                    x2={a[0] + nx}
                    y2={a[1] + ny}
                    stroke="var(--apptext-danger)"
                    strokeWidth={2 * upp}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          );
        })}

        {/* Dock: a square key-plate with the dock icon, as in the key. The robot is a round
            puck, so the two never read as the same mark. */}
        {dockMarkers.map(([cx, cy], i) => {
          const s = Math.max(dockR * 2.2, 22 * upp);
          return (
            <g key={`dock-${i}`} style={{ pointerEvents: 'none' }}>
              <rect
                x={cx - s / 2}
                y={cy - s / 2}
                width={s}
                height={s}
                rx={s * 0.22}
                fill="var(--appsurface)"
                stroke="var(--apptext)"
                strokeWidth={1.25 * upp}
              />
              <use
                href="#fp-i-dock"
                x={cx - s * 0.33}
                y={cy - s * 0.33}
                width={s * 0.66}
                height={s * 0.66}
                fill="none"
                stroke="var(--apptext)"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Room names — ink on the plate, each fitted inside its room (see `labels`). In edit
            mode, unnamed rooms show a "Name this room" prompt instead. A halo in the room's
            own tone keeps a name readable over a zone's hatch or the cleaned lanes. */}
        {rooms.map((room, i) => {
          const l = labels.list[i];
          if (!l) return null;
          const mergeSelected = !!(mergeSet && room.id && mergeSet.has(room.id));
          if (l.keyNo != null) {
            const r = 8.5 * upp;
            return (
              <g key={`roomlabel-${i}`} style={{ pointerEvents: 'none' }}>
                <circle cx={l.x} cy={l.y} r={r} fill="var(--appsurface)" stroke="var(--apptext)" strokeWidth={1.1 * upp} />
                <text
                  x={l.x}
                  y={l.y}
                  fill="var(--apptext)"
                  fontSize={10.5 * upp}
                  fontWeight={500}
                  fontFamily="var(--appfont-mono)"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {l.keyNo}
                </text>
              </g>
            );
          }
          const f = l.fit as LabelFit;
          const lh = 1.18 * f.size;
          return (
            <text
              key={`roomlabel-${i}`}
              x={l.x}
              y={l.y}
              fill={l.isPrompt ? 'var(--apptext-muted)' : 'var(--apptext)'}
              fontSize={f.size}
              fontWeight={l.isPrompt ? 500 : 600}
              fontStyle={l.isPrompt ? 'italic' : 'normal'}
              textAnchor="middle"
              dominantBaseline="central"
              transform={l.rotated ? `rotate(-90 ${l.x.toFixed(1)} ${l.y.toFixed(1)})` : undefined}
              // Names as written (not silk-screen caps, which are too wide for small rooms).
              style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
              stroke={mergeSelected ? 'none' : PLATE[room.tone] ?? PLATE[0]}
              strokeWidth={f.size * 0.32}
              strokeLinejoin="round"
            >
              {f.lines.length === 1
                ? f.lines[0]
                : f.lines.map((line, k) => (
                    <tspan key={k} x={l.x} dy={k === 0 ? -((f.lines.length - 1) * lh) / 2 : lh}>
                      {line}
                    </tspan>
                  ))}
            </text>
          );
        })}

        {/* Interaction layer — clickable room hit areas. Active for rename (edit
            mode) OR merge selection. On top so clicks land regardless of z-order. */}
        {interactive &&
          rooms
            .map((room, index) => ({ ...room, index }))
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
                      room, play in clean mode, a pencil on a named room in rename mode (the
                      pencil shows on hover / focus only, so the resting plan stays quiet; the
                      line under the map says rooms can be renamed). Drawn under the name
                      when there's room for it, otherwise left out. */}
                  {(isMerging ? mergeSelected : isCleaning || !!room.name) && (() => {
                    const l = labels.list[room.index];
                    const below = l?.fit ? (l.rotated ? l.fit.halfW : l.fit.halfH) : l?.keyNo != null ? 8.5 * upp : -glyphSize / 2 - 3 * upp;
                    const gy = room.cy + below + 3 * upp + glyphSize / 2;
                    if (!boxInRings(room.labelRings, room.cx, gy, glyphSize / 2, glyphSize / 2)) return null;
                    return (
                      <use
                        className={canEdit ? 'roomba-roomhit-glyph' : undefined}
                        href={`#fp-i-${isMerging ? 'check' : isCleaning ? 'play' : 'edit'}`}
                        x={room.cx - glyphSize / 2}
                        y={gy - glyphSize / 2}
                        width={glyphSize}
                        height={glyphSize}
                        fill="none"
                        stroke={isMerging ? 'var(--appaccent-text)' : 'var(--apptext-muted)'}
                        strokeWidth={isMerging ? 2.2 : 1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ pointerEvents: 'none' }}
                      />
                    );
                  })()}
                </g>
              );
            })}
      </>
    );
  }, [model, isMerging, isCleaning, canEdit, mergeSelection, onToggleMergeRoom, onSelectCleanRoom, onSelectRoom, drawnWidth, labels, idKeepOut, idNoMop]);

  // The legend names only the marks this plan actually has.
  const legend = useMemo(() => {
    if (!model) return null;
    return {
      keepOut: model.zonePolys.some((z) => !isNoMop(z.category)),
      noMop: model.zonePolys.some((z) => isNoMop(z.category)),
      wall: model.wallLines.length > 0,
      dock: model.dockMarkers.length > 0,
      lastClean: !!lastClean && model.rooms.some((r) => !!r.name && lastCleanSet.has(r.name)),
    };
  }, [model, lastClean, lastCleanSet]);

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
  const upp = unitsPerPx(width, drawnWidth);
  const robot =
    position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? (() => {
          const [cx, cy] = project([position.x, position.y]);
          const r = Math.max(maxDim * 0.014, 8 * upp);
          const theta = typeof position.theta === 'number' ? position.theta : null;
          // SVG rotates clockwise with y down, so the meter-space angle turns the other way.
          const deg = theta != null ? (-theta * 180) / Math.PI : null;
          return { cx, cy, r, deg };
        })()
      : null;

  const interactive = canEdit || isMerging || isCleaning;
  const name = robotName?.trim() || 'Robot';

  return (
    <div className={className}>
      <div className="fp-map-well overflow-hidden rounded-well border border-appborder bg-appmap-floor">
      <svg
        ref={setSvg}
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        className="fp-map-plan block h-auto w-full"
        overflow="visible"
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

        {/* Live cleaning coverage — the instrument's filled arc: what has been vacuumed
            or mopped this run is ruled with fine lanes over a wash in the cleaned colour,
            like the passes themselves; ground cleaned twice or more is ruled across as
            well, on a deeper wash; ground only travelled over gets a faint ink wash; the
            rest of the plate stays bare. Clipped to the floor, and drawn under the walls
            so they stay crisp. */}
        {coverageLayer.paths.length > 0 && (() => {
          const cleanedPaths = coverageLayer.paths.filter((c) => c.mode === 'cleaned').map((c) => c.d);
          return (
          <g clipPath={`url(#${idClip})`} style={{ pointerEvents: 'none' }}>
            {coverageLayer.cleaned && (
              <>
                {/* One path per cleaned feature (a clip's children are unioned), so two
                    features that overlap, say vacuumed and mopped, don't cancel out. */}
                <clipPath id={idCleaned}>
                  {cleanedPaths.map((d, i) => (
                    <path key={i} d={d} clipRule="evenodd" />
                  ))}
                </clipPath>
                {/* Everything but the cleaned ground, so the travel wash stays on
                    travelled-only ground instead of muddying the lanes. */}
                <mask id={idNotCleaned} maskUnits="userSpaceOnUse" x={-width} y={-height} width={width * 3} height={height * 3}>
                  <rect x={-width} y={-height} width={width * 3} height={height * 3} fill="#fff" />
                  {cleanedPaths.map((d, i) => (
                    <path key={i} d={d} fillRule="evenodd" fill="#000" />
                  ))}
                </mask>
              </>
            )}
            {coverageLayer.paths.map((c, i) =>
              c.mode === 'cleaned' ? (
                <path key={`cov-${i}`} d={c.d} fillRule="evenodd" fill={`url(#${idLanes})`} stroke="none" />
              ) : (
                <path
                  key={`cov-${i}`}
                  d={c.d}
                  fillRule="evenodd"
                  fill="var(--apptext)"
                  fillOpacity={0.05}
                  mask={coverageLayer.cleaned ? `url(#${idNotCleaned})` : undefined}
                  stroke="none"
                />
              ),
            )}
            {coverageLayer.twice && (
              <path d={coverageLayer.twice} fill={`url(#${idTwice})`} clipPath={`url(#${idCleaned})`} stroke="none" />
            )}
          </g>
          );
        })()}

        {/* Static overlay layers (zones, walls, dock, labels, room hit-areas) —
            memoized; unaffected by position/coverage polls. */}
        {staticOverlay}

        {/* Live robot — a round puck seen from above (its CLEAN button ring, and a notch
            at the front when the heading is known), so it never reads as the square dock.
            Same project() space; hidden when stale. */}
        {robot && (
          <g aria-label={`${name}'s position`}>
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
            {robot.deg != null ? (
              // A puck drawn to a point at its front: the familiar "here, facing this way" pin.
              <path
                d={robotPointer(robot.r)}
                fill="var(--apptext)"
                stroke="var(--appmap-plate)"
                strokeWidth={robot.r * 0.26}
                strokeLinejoin="round"
                transform={`translate(${robot.cx.toFixed(1)} ${robot.cy.toFixed(1)}) rotate(${robot.deg.toFixed(1)})`}
              />
            ) : (
              <circle
                cx={robot.cx}
                cy={robot.cy}
                r={robot.r}
                fill="var(--apptext)"
                stroke="var(--appmap-plate)"
                strokeWidth={robot.r * 0.26}
              />
            )}
            <circle cx={robot.cx} cy={robot.cy} r={robot.r * 0.34} fill="var(--appmap-plate)" />
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
        // The key beside the battery: the key wraps in its own column, so on a phone the
        // battery doesn't take a row of its own under it.
        <div className="mt-3 flex items-center justify-between gap-x-4">
          <ul className="fp-dial-legend fp-map-legend min-w-0 flex-1 justify-start" aria-label="Map key">
            {coverageLayer.paths.length > 0 && <MapKey kind="cleaned">Cleaned this run</MapKey>}
            {coverageLayer.twice && <MapKey kind="twice">Cleaned twice</MapKey>}
            {coverageLayer.paths.length === 0 && legend?.lastClean && lastClean && <MapKey kind="last">{lastClean.label}</MapKey>}
            {legend?.keepOut && <MapKey kind="keepout">Off-limits</MapKey>}
            {legend?.noMop && <MapKey kind="nomop">No mopping</MapKey>}
            {legend?.wall && <MapKey kind="wall">Virtual wall</MapKey>}
            {robot && <MapKey kind="robot">{name}</MapKey>}
            {legend?.dock && <MapKey kind="dock">Dock</MapKey>}
            {labels.keyed.map((k) => (
              <MapKey key={`n-${k.n}`} kind="num" n={k.n}>{k.name}</MapKey>
            ))}
          </ul>
          {aside != null && <div className="shrink-0">{aside}</div>}
        </div>
      )}
    </div>
  );
});

/**
 * The robot with a heading, around the origin pointing along +x: a circle of radius r drawn
 * out to a point at 1.75r, its sides tangent to the circle.
 */
function robotPointer(r: number): string {
  const tip = 1.75 * r;
  const a = Math.acos(r / tip);
  const x = (r * Math.cos(a)).toFixed(2);
  const y = (r * Math.sin(a)).toFixed(2);
  return `M${tip.toFixed(2)} 0 L${x} ${y} A${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 ${x} ${-Number(y)} Z`;
}

function isNoMop(category: string): boolean {
  return category.includes('NO_MOP') || category.includes('MOP');
}

/**
 * The ground cleaned twice as one SVG path: each of the poller's rectangles ([ix, iy, w, h]
 * in grid cells, metres = value * cell, y up) projected into the plan. One path, so
 * neighbouring rectangles fill without seams. Empty when there is nothing usable.
 */
export function twicePath(
  passes: RoombaPasses | null | undefined,
  project: (p: GeoPosition) => [number, number],
): string {
  const cell = passes?.cell;
  if (!passes || !Array.isArray(passes.rects) || typeof cell !== 'number' || !(cell > 0)) return '';
  let d = '';
  for (const r of passes.rects) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const [ix, iy, w, h] = r;
    if (![ix, iy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    // The plan's y runs down, so the rectangle's top edge on screen is its top in metres.
    const [x0, y0] = project([ix * cell, (iy + h) * cell]);
    const [x1, y1] = project([(ix + w) * cell, iy * cell]);
    d += `M${x0.toFixed(1)} ${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`;
  }
  return d;
}

type MapKeyKind = 'cleaned' | 'twice' | 'last' | 'keepout' | 'nomop' | 'wall' | 'robot' | 'dock' | 'num';

/** A legend swatch, drawn with the same strokes, hatches and fills as the mark on the plan. */
function MapSwatch({ kind, n }: { kind: MapKeyKind; n?: number }) {
  const id = useSvgId('fpkey');
  const W = 18;
  const H = 12;
  const plate = <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} fill="var(--appmap-plate)" stroke="var(--appborder)" />;
  let body: ReactNode;
  switch (kind) {
    case 'cleaned':
    case 'twice':
      // The plan's lanes at the same 4px pitch; twice adds the crosswise rules and the
      // deeper wash on top, as on the plan.
      body = (
        <>
          <defs>
            <pattern id={id} patternUnits="userSpaceOnUse" width={4} height={4}>
              <rect width={4} height={4} fill="var(--appmap-cleaned)" fillOpacity={kind === 'twice' ? 0.26 : 0.12} />
              <rect y={1.5} width={4} height={1} fill="var(--appmap-cleaned)" fillOpacity={0.6} />
              {kind === 'twice' && <rect x={1.5} width={1} height={4} fill="var(--appmap-cleaned)" fillOpacity={0.45} />}
            </pattern>
          </defs>
          {plate}
          <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} fill={`url(#${id})`} />
        </>
      );
      break;
    case 'last':
      body = (
        <>
          <defs>
            <pattern id={id} patternUnits="userSpaceOnUse" width={16} height={5}>
              <rect y={2.05} width={16} height={0.9} fill="var(--apptext)" fillOpacity={0.11} />
            </pattern>
          </defs>
          {plate}
          <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} fill={`url(#${id})`} />
        </>
      );
      break;
    case 'keepout':
      body = (
        <>
          <defs>
            <pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
              <rect width={5} height={5} fill="var(--apptint-problem)" />
              <rect width={1.1} height={5} fill="var(--apptext-danger)" fillOpacity={0.55} />
            </pattern>
          </defs>
          {plate}
          <rect x={1} y={1} width={W - 2} height={H - 2} fill={`url(#${id})`} stroke="var(--apptext-danger)" strokeWidth={1.25} />
        </>
      );
      break;
    case 'nomop':
      body = (
        <>
          <defs>
            <pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5} x={1} y={1}>
              <rect width={5} height={5} fill="var(--apptint-warn)" />
              <circle cx={2.5} cy={2.5} r={0.95} fill="var(--apptext-warning)" fillOpacity={0.7} />
            </pattern>
          </defs>
          {plate}
          <rect x={1} y={1} width={W - 2} height={H - 2} fill={`url(#${id})`} stroke="var(--apptext-warning)" strokeWidth={1.25} strokeDasharray="4 3" />
        </>
      );
      break;
    case 'wall':
      body = (
        <g stroke="var(--apptext-danger)">
          <line x1={2} y1={6} x2={16} y2={6} strokeWidth={2.25} strokeDasharray="5 3.5" />
          <line x1={2} y1={1.5} x2={2} y2={10.5} strokeWidth={2} strokeLinecap="round" />
          <line x1={16} y1={1.5} x2={16} y2={10.5} strokeWidth={2} strokeLinecap="round" />
        </g>
      );
      break;
    case 'robot':
      body = (
        <g>
          <path d={robotPointer(4.6)} transform="translate(6.5 6)" fill="var(--apptext)" />
          <circle cx={6.5} cy={6} r={1.6} fill="var(--appmap-plate)" />
        </g>
      );
      break;
    case 'num':
      body = (
        <g>
          <circle cx={9} cy={6} r={5.5} fill="var(--appsurface)" stroke="var(--apptext)" strokeWidth={1} />
          <text x={9} y={6} fontSize={7.5} fontFamily="var(--appfont-mono)" fontWeight={500} fill="var(--apptext)" textAnchor="middle" dominantBaseline="central">
            {n}
          </text>
        </g>
      );
      break;
    default:
      body = null;
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block shrink-0" focusable="false">
      {body}
    </svg>
  );
}

/** One legend entry, its key drawn like the mark it explains. */
function MapKey({ kind, n, children }: { kind: MapKeyKind; n?: number; children: ReactNode }) {
  return (
    <li className="fp-lg-item">
      <span aria-hidden="true" className="inline-flex">
        {kind === 'dock' ? (
          <span className="fp-map-key-dock">
            <Icon name="dock" className="fp-icon--s" />
          </span>
        ) : (
          <MapSwatch kind={kind} n={n} />
        )}
      </span>
      {kind === 'num' ? <span><span className="fp-sr-only">{`Room ${n}: `}</span>{children}</span> : children}
    </li>
  );
}
