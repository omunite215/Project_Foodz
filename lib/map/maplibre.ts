import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Point } from '@/lib/map-geometry';

/*
 * Loading MapLibre (plan §4): the library is imported on demand, after the page renders, and
 * its worker runs from a blob of its own pinned script so it shares the page's CSP
 * (`worker-src blob:`; tile requests then follow `connect-src`). Shared by every map.
 */

export type MapLibreModule = typeof import('maplibre-gl');

/** A map that hasn't drawn its style by then has failed (F8 S7.2). */
export const MAP_LOAD_TIMEOUT_MS = 10_000;

let workerReady: Promise<void> | undefined;

async function loadWorker(setWorkerUrl: (url: string) => void) {
  const response = await fetch(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url));
  if (!response.ok) throw new Error(`Map worker answered ${response.status}`);
  const source = await response.text();
  setWorkerUrl(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
}

/** Once per page; a failure is forgotten so the next map can try again. */
export function prepareWorker(setWorkerUrl: (url: string) => void): Promise<void> {
  workerReady ??= loadWorker(setWorkerUrl).catch((error: unknown) => {
    workerReady = undefined;
    throw error;
  });
  return workerReady;
}

export async function loadMapLibre(): Promise<MapLibreModule> {
  const maplibre = await import('maplibre-gl');
  await prepareWorker(maplibre.setWorkerUrl);
  return maplibre;
}

/** MapLibre's cooperative-gesture hint in our words (design 1.3). */
export const COOPERATIVE_LOCALE = {
  'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl + scroll to zoom the map',
  'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + scroll to zoom the map',
  'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move the map',
} as const;

export type Bounds = [[number, number], [number, number]];

/** The box around some points, padded a little when they coincide. */
export function boundsOf(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const pad = 0.0005;
  if (east - west < pad) {
    west -= pad;
    east += pad;
  }
  if (north - south < pad) {
    south -= pad;
    north += pad;
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** Whether a point is inside the map's current view, with a margin in pixels. */
export function inView(map: MapLibreMap, point: Point, margin = 24): boolean {
  const projected = map.project([point.lng, point.lat]);
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  return (
    projected.x >= margin &&
    projected.y >= margin &&
    projected.x <= width - margin &&
    projected.y <= height - margin
  );
}

/** A GeoJSON line for a route source. */
export function lineFeature(coordinates: readonly [number, number][]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coordinates.map((c) => [...c]) },
  };
}

export const EMPTY_LINE = lineFeature([]);

/** The route's coordinates from the courier's point onward (S6.5: never the path ridden). */
export function routeFrom(
  route: readonly [number, number][] | null,
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number },
): [number, number][] {
  if (!from) return route ? [...route] : [];
  if (!route || route.length < 2) {
    return [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ];
  }
  // Start at the route vertex nearest to him, so the part behind him isn't drawn.
  let nearest = 0;
  let best = Infinity;
  route.forEach(([lng, lat], index) => {
    const d = (lng - from.lng) ** 2 + (lat - from.lat) ** 2;
    if (d < best) {
      best = d;
      nearest = index;
    }
  });
  return [[from.lng, from.lat], ...route.slice(Math.min(nearest + 1, route.length - 1))];
}
