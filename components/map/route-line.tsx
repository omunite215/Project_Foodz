'use client';

import type { GeoJSONSource } from 'maplibre-gl';
import { useEffect } from 'react';
import type { MapPalette } from '@/lib/map/colors';
import { lineFeature } from '@/lib/map/maplibre';
import type { MapHandle } from './map-frame';

/*
 * The route (F8 design 0): a 5 px line with round caps over an 8 px casing, from the courier's
 * latest point to the next stop. Stale (2 minutes without a point): dashed 2 · 2 in the gray
 * token, and only the part from his last point. Drawn under the markers, which are DOM.
 */

export function RouteLine({
  handle,
  id = 'route',
  coordinates,
  palette,
  stale = false,
  dashed = false,
}: {
  handle: MapHandle;
  id?: string;
  coordinates: readonly [number, number][] | null;
  palette: MapPalette;
  stale?: boolean;
  /** A plain dashed joiner (the live map's selected courier to his drop-off). */
  dashed?: boolean;
}) {
  const { map } = handle;

  useEffect(() => {
    const source = `${id}-source`;
    if (!map.getSource(source)) {
      map.addSource(source, { type: 'geojson', data: lineFeature([]) });
      if (!dashed) {
        map.addLayer({
          id: `${id}-casing`,
          type: 'line',
          source,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': palette.routeCasing, 'line-width': 8 },
        });
      }
      map.addLayer({
        id: `${id}-line`,
        type: 'line',
        source,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': palette.route, 'line-width': dashed ? 2 : 5 },
      });
    }
    return () => {
      // The map may already be gone (its frame unmounted first).
      try {
        if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
        if (map.getLayer(`${id}-casing`)) map.removeLayer(`${id}-casing`);
        if (map.getSource(source)) map.removeSource(source);
      } catch {
        // Removed with the map.
      }
    };
  }, [map, id, dashed, palette.route, palette.routeCasing]);

  useEffect(() => {
    const source = map.getSource<GeoJSONSource>(`${id}-source`);
    void source?.setData(lineFeature(coordinates ?? []));
    const line = `${id}-line`;
    if (!map.getLayer(line)) return;
    const gray = stale || dashed;
    map.setPaintProperty(line, 'line-color', gray ? palette.stale : palette.route);
    map.setPaintProperty(line, 'line-width', dashed ? 2 : stale ? 3 : 5);
    map.setPaintProperty(line, 'line-dasharray', gray ? [2, 2] : [1, 0]);
    if (map.getLayer(`${id}-casing`)) {
      map.setLayoutProperty(`${id}-casing`, 'visibility', stale ? 'none' : 'visible');
    }
  }, [map, id, coordinates, stale, dashed, palette.route, palette.stale]);

  return null;
}
