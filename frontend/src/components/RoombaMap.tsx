import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRoombaPosition } from '../api/roomba';
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
}: RoombaMapProps) {
  const geo = map?.geojson;
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);
  // Split ("divide a room") interaction: only the live cursor is local state —
  // the placed corners live in the parent (controlled via splitDraft).
  const [cursor, setCursor] = useState<{ vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Clear the rubber-band cursor whenever split mode toggles off.
  useEffect(() => {
    if (!splitMode) setCursor(null);
  }, [splitMode]);

  // Keyboard shortcuts while dividing: Enter finishes (≥2 corners), Backspace
  // removes the last corner.
  useEffect(() => {
    if (!splitMode) return;
    const onKey = (e: KeyboardEvent) => {
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
        let sx = 0;
        let sy = 0;
        for (const [px, py] of outerPts) {
          sx += px;
          sy += py;
        }
        const cx = sx / outerPts.length;
        const cy = sy / outerPts.length;

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
    refetchInterval: running ? 1500 : false,
    refetchIntervalInBackground: false,
    staleTime: 1000,
  });
  const position = running ? positionQuery.data ?? null : null;

  if (loading) {
    return (
      <div
        className={`animate-pulse rounded-[24px] border border-appborder bg-appinset ${className ?? ''}`}
        style={{ minHeight: 320 }}
        aria-hidden
      />
    );
  }

  // 204 / no map yet, or a map row with no drawable geometry.
  if (!model || !model.hasGeometry) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-appborder bg-appinset p-8 text-center ${className ?? ''}`}
        style={{ minHeight: 320 }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft">
          <svg className="h-6 w-6 text-appaccent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <p className="text-sm font-medium text-apptext-soft">No map yet</p>
        <p className="max-w-xs text-xs leading-5 text-apptext-muted">
          Your Roomba builds its floor map over the first few cleaning runs. Once it
          has mapped a room, the layout will appear here.
        </p>
      </div>
    );
  }

  const {
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
    dockR,
  } = model;
  const maxDim = Math.max(width, height);
  const isSplitting = !!splitMode && !!onSplitAddPoint;
  const draftPts = isSplitting ? splitDraft ?? [] : [];
  // Rename clicks are disabled while dividing, so the two interactions never conflict.
  const canEdit = !!editable && !!onSelectRoom && !isSplitting;

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
  const robot =
    position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? (() => {
          const [cx, cy] = project([position.x, position.y]);
          const r = maxDim * 0.02;
          const theta = typeof position.theta === 'number' ? position.theta : null;
          const L = r * 2.4;
          const head =
            theta != null
              ? { hx: cx + L * Math.cos(theta), hy: cy - L * Math.sin(theta) }
              : null;
          return { cx, cy, r, head };
        })()
      : null;

  return (
    <div
      className={`overflow-hidden rounded-[24px] border border-appborder bg-appinset p-3 ${className ?? ''}`}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Roomba floor plan${map?.name ? `: ${map.name}` : ''}`}
        preserveAspectRatio="xMidYMid meet"
        style={isSplitting ? { cursor: 'crosshair' } : undefined}
        onClick={isSplitting ? handleSplitClick : undefined}
        onDoubleClick={isSplitting ? handleSplitDblClick : undefined}
        onMouseMove={isSplitting ? handleSplitMove : undefined}
      >
        {/* Floor plan — the outer walkable surface */}
        {floorPolys.map((pts, i) => (
          <polygon
            key={`floor-${i}`}
            points={pts}
            fill="var(--appsurface-raised)"
            stroke="var(--appborder)"
            strokeWidth={Math.max(width, height) * 0.004}
            strokeLinejoin="round"
          />
        ))}

        {/* Rooms — accent-tinted regions (decorative; interaction layer is below) */}
        {rooms.map((room, ri) =>
          room.rings.map((pts, i) => (
            <polygon
              key={`room-${ri}-${i}`}
              points={pts}
              fill={
                canEdit && hoveredRoom && hoveredRoom === room.id
                  ? 'var(--appaccent)'
                  : 'var(--appaccent-soft)'
              }
              fillOpacity={canEdit && hoveredRoom === room.id ? 0.28 : 1}
              stroke="var(--appaccent-border)"
              strokeWidth={maxDim * 0.003}
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
            />
          )),
        )}

        {/* Keep-out / no-mop zones — hatched, distinct per category */}
        {zonePolys.map((z, i) => {
          const noMop = z.category.includes('NO_MOP') || z.category.includes('MOP');
          const color = noMop ? 'var(--appwarning)' : 'var(--appdanger)';
          return (
            <polygon
              key={`zone-${i}`}
              points={z.points}
              fill={color}
              fillOpacity={0.14}
              stroke={color}
              strokeOpacity={0.85}
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
            stroke="var(--apptext-muted)"
            strokeWidth={maxDim * 0.006}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Virtual walls — LineString policy zones, dashed danger-colored */}
        {wallLines.map((pts, i) => (
          <polyline
            key={`vwall-${i}`}
            points={pts}
            fill="none"
            stroke="var(--appdanger)"
            strokeWidth={maxDim * 0.007}
            strokeDasharray={`${maxDim * 0.016} ${maxDim * 0.01}`}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Dock marker */}
        {dockMarkers.map(([cx, cy], i) => (
          <g key={`dock-${i}`}>
            <circle cx={cx} cy={cy} r={dockR * 2.2} fill="var(--appaccent-soft)" />
            <circle
              cx={cx}
              cy={cy}
              r={dockR}
              fill="var(--appaccent)"
              stroke="var(--appsurface-raised)"
              strokeWidth={dockR * 0.35}
            />
          </g>
        ))}

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
              fontSize={maxDim * (isPrompt ? 0.022 : 0.026)}
              fontWeight={isPrompt ? 500 : 600}
              fontStyle={isPrompt ? 'italic' : 'normal'}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
              stroke="var(--appsurface-raised)"
              strokeWidth={maxDim * 0.006}
              strokeLinejoin="round"
            >
              {label}
            </text>
          );
        })}

        {/* Interaction layer — clickable room hit areas (admin edit mode only).
            Rendered on top so clicks land regardless of other layers' z-order. */}
        {canEdit &&
          rooms
            .filter((room) => room.id)
            .map((room, ri) => (
              <g
                key={`roomhit-${ri}`}
                role="button"
                tabIndex={0}
                aria-label={`Rename ${room.name ?? 'unnamed room'}`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectRoom?.({ id: room.id as string, name: room.name })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectRoom?.({ id: room.id as string, name: room.name });
                  }
                }}
                onMouseEnter={() => setHoveredRoom(room.id)}
                onMouseLeave={() => setHoveredRoom((h) => (h === room.id ? null : h))}
              >
                {room.rings.map((pts, i) => (
                  <polygon
                    key={`hit-${ri}-${i}`}
                    points={pts}
                    fill="transparent"
                    stroke={hoveredRoom === room.id ? 'var(--appaccent)' : 'transparent'}
                    strokeWidth={maxDim * 0.005}
                    strokeLinejoin="round"
                  />
                ))}
                {/* Pencil affordance for already-named rooms */}
                {room.name && (
                  <text
                    x={room.cx}
                    y={room.cy + maxDim * 0.03}
                    fill="var(--apptext-muted)"
                    fontSize={maxDim * 0.02}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ pointerEvents: 'none' }}
                  >
                    ✏️
                  </text>
                )}
              </g>
            ))}

        {/* Live robot dot + heading — same project() space, hidden when stale */}
        {robot && (
          <g aria-label="Robot position">
            {robot.head && (
              <line
                x1={robot.cx}
                y1={robot.cy}
                x2={robot.head.hx}
                y2={robot.head.hy}
                stroke="var(--appsuccess)"
                strokeWidth={robot.r * 0.55}
                strokeLinecap="round"
              />
            )}
            <circle cx={robot.cx} cy={robot.cy} r={robot.r * 2.4} fill="var(--appsuccess)" fillOpacity={0.18}>
              <animate attributeName="r" values={`${robot.r * 1.8};${robot.r * 3};${robot.r * 1.8}`} dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="fill-opacity" values="0.28;0.05;0.28" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle
              cx={robot.cx}
              cy={robot.cy}
              r={robot.r}
              fill="var(--appsuccess)"
              stroke="var(--appsurface-raised)"
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
                      fill="var(--appaccent)"
                      fillOpacity={0.16}
                      stroke="var(--appaccent)"
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
                  stroke="var(--appdanger)"
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
                  stroke="var(--appdanger)"
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
                  fill="var(--appdanger)"
                  stroke="var(--appsurface-raised)"
                  strokeWidth={maxDim * 0.004}
                />
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
});
