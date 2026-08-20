import { memo, useMemo } from 'react';
import type {
  GeoFeatureCollection,
  GeoPosition,
  RoombaMap as RoombaMapData,
} from '../types';

interface RoombaMapProps {
  map: RoombaMapData | null;
  loading?: boolean;
  className?: string;
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

export default memo(function RoombaMap({ map, loading, className }: RoombaMapProps) {
  const geo = map?.geojson;

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

    const ringToPoints = (ring: GeoPosition[]): string =>
      ring.map((p) => project(p).map((n) => n.toFixed(1)).join(',')).join(' ');

    // Collect renderable primitives per layer.
    const floorPolys: string[] = [];
    const roomPolys: string[] = [];
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
    collectPolys(geo.rooms, roomPolys);

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

    const hasGeometry =
      floorPolys.length > 0 ||
      roomPolys.length > 0 ||
      borderPaths.length > 0;

    return {
      width,
      height,
      floorPolys,
      roomPolys,
      borderPaths,
      dockMarkers,
      hasGeometry,
      // dock marker radius relative to the map extent
      dockR: Math.max(width, height) * 0.018,
    };
  }, [geo]);

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

  const { width, height, floorPolys, roomPolys, borderPaths, dockMarkers, dockR } = model;

  return (
    <div
      className={`overflow-hidden rounded-[24px] border border-appborder bg-appinset p-3 ${className ?? ''}`}
    >
      <svg
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Roomba floor plan${map?.name ? `: ${map.name}` : ''}`}
        preserveAspectRatio="xMidYMid meet"
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

        {/* Rooms — accent-tinted regions */}
        {roomPolys.map((pts, i) => (
          <polygon
            key={`room-${i}`}
            points={pts}
            fill="var(--appaccent-soft)"
            stroke="var(--appaccent-border)"
            strokeWidth={Math.max(width, height) * 0.003}
            strokeLinejoin="round"
          />
        ))}

        {/* Borders / walls — strong outline */}
        {borderPaths.map((pts, i) => (
          <polyline
            key={`border-${i}`}
            points={pts}
            fill="none"
            stroke="var(--apptext-muted)"
            strokeWidth={Math.max(width, height) * 0.006}
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
      </svg>
    </div>
  );
});
