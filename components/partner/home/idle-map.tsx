'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { gsap } from 'gsap';
import { MapPinOff } from 'lucide-react';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { type Point, distanceMeters } from '@/lib/map-geometry';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * The idle map (F6 design 6.8): loaded only on the online screen, never touchable (a bump can't
 * move it), hidden from screen readers (the distance line stands in for it, P17.3). OpenFreeMap's
 * positron in light, dark in dark. His dot glides to each new fix; under reduced motion it jumps.
 * A failure says sharing carries on.
 */

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOAD_TIMEOUT_MS = 12_000;
const FIT_KITCHEN_M = 3_000;

let workerReady: Promise<void> | undefined;

async function loadWorker(setWorkerUrl: (url: string) => void) {
  const response = await fetch(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url));
  if (!response.ok) throw new Error(`Map worker answered ${response.status}`);
  const source = await response.text();
  setWorkerUrl(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
}

function prepareWorker(setWorkerUrl: (url: string) => void): Promise<void> {
  workerReady ??= loadWorker(setWorkerUrl).catch((error: unknown) => {
    workerReady = undefined;
    throw error;
  });
  return workerReady;
}

function dotElement(dark: boolean): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  const size = 18;
  Object.assign(element.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '9999px',
    background: dark ? '#4c9be0' : '#106aab',
    border: `3px solid ${dark ? '#e6e8ec' : '#ffffff'}`,
    boxShadow: dark ? 'none' : '0 0 0 1px rgb(20 20 22 / 0.25)',
    boxSizing: 'border-box',
  });
  return element;
}

function kitchenElement(dark: boolean): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 40');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '40');
  const drop = document.createElementNS(SVG_NS, 'path');
  drop.setAttribute('d', 'M16 39S30 24.6 30 15A14 14 0 0 0 2 15c0 9.6 14 24 14 24Z');
  drop.setAttribute('fill', dark ? '#04b90b' : '#03850a');
  drop.setAttribute('stroke', dark ? '#141416' : '#ffffff');
  drop.setAttribute('stroke-width', '2');
  // A small shop front in the head of the pin.
  const glyph = document.createElementNS(SVG_NS, 'path');
  glyph.setAttribute('d', 'M10 12h12l1 3H9zM10.5 15.5v5h11v-5M14 20.5v-3h4v3');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('stroke', dark ? '#141416' : '#ffffff');
  glyph.setAttribute('stroke-width', '1.6');
  glyph.setAttribute('stroke-linejoin', 'round');
  svg.append(drop, glyph);
  element.append(svg);
  return element;
}

/** A circle of `radius` metres around `center`, as a GeoJSON polygon. */
function circle(center: Point, radius: number) {
  const points = 48;
  const coordinates: [number, number][] = [];
  const latScale = radius / 111_320;
  const lngScale = radius / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let index = 0; index <= points; index++) {
    const angle = (index / points) * Math.PI * 2;
    coordinates.push([
      center.lng + lngScale * Math.cos(angle),
      center.lat + latScale * Math.sin(angle),
    ]);
  }
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [coordinates] },
  };
}

function viewFor(map: MapLibreMap, at: Point, kitchen: Point, animate: boolean) {
  const far = distanceMeters(at, kitchen) > FIT_KITCHEN_M;
  if (far) {
    const options = { center: [at.lng, at.lat] as [number, number], zoom: 13 };
    if (animate) map.easeTo({ ...options, duration: 600 });
    else map.jumpTo(options);
    return;
  }
  const bounds: [[number, number], [number, number]] = [
    [Math.min(at.lng, kitchen.lng), Math.min(at.lat, kitchen.lat)],
    [Math.max(at.lng, kitchen.lng), Math.max(at.lat, kitchen.lat)],
  ];
  map.fitBounds(bounds, {
    padding: 48,
    minZoom: 13,
    maxZoom: 16,
    duration: animate ? 600 : 0,
  });
}

export default function IdleMap({
  at,
  accuracy,
  kitchen,
  dark,
}: {
  at: Point;
  accuracy: number | null;
  kitchen: Point;
  dark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dotRef = useRef<Marker | null>(null);
  const proxy = useRef({ lng: at.lng, lat: at.lat });
  const latest = useRef({ at, accuracy, kitchen });
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    latest.current = { at, accuracy, kitchen };
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    const timeout = setTimeout(() => {
      if (!cancelled) setState((current) => (current === 'loading' ? 'failed' : current));
    }, LOAD_TIMEOUT_MS);
    void (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        await prepareWorker(maplibre.setWorkerUrl);
        const container = containerRef.current;
        if (cancelled || !container) return;
        const start = latest.current;
        map = new maplibre.Map({
          container,
          style: dark ? STYLES.dark : STYLES.light,
          center: [start.at.lng, start.at.lat],
          zoom: 14,
          interactive: false,
          attributionControl: false,
        });
        mapRef.current = map;
        map.getCanvas().setAttribute('tabindex', '-1');
        new maplibre.Marker({ element: kitchenElement(dark), anchor: 'bottom' })
          .setLngLat([start.kitchen.lng, start.kitchen.lat])
          .addTo(map);
        dotRef.current = new maplibre.Marker({ element: dotElement(dark) })
          .setLngLat([start.at.lng, start.at.lat])
          .addTo(map);
        proxy.current = { lng: start.at.lng, lat: start.at.lat };
        map.on('load', () => {
          if (cancelled || !map) return;
          clearTimeout(timeout);
          const color = dark ? '#4c9be0' : '#106aab';
          map.addSource('accuracy', {
            type: 'geojson',
            data: circle(start.at, start.accuracy ?? 0),
          });
          map.addLayer({
            id: 'accuracy-fill',
            type: 'fill',
            source: 'accuracy',
            paint: { 'fill-color': color, 'fill-opacity': 0.15 },
          });
          map.addLayer({
            id: 'accuracy-line',
            type: 'line',
            source: 'accuracy',
            paint: { 'line-color': color, 'line-opacity': 0.5, 'line-width': 1.5 },
          });
          viewFor(map, start.at, start.kitchen, false);
          setState('ready');
        });
        map.on('error', (event) => {
          // Tile hiccups are retried by MapLibre; only a style that never loads fails the map.
          if (!map?.isStyleLoaded() && event.error) setState('failed');
        });
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      map?.remove();
      mapRef.current = null;
      dotRef.current = null;
    };
  }, [dark]);

  // Each new fix: the dot glides there and the view follows (600 ms; a jump under reduced motion).
  useEffect(() => {
    const map = mapRef.current;
    const dot = dotRef.current;
    if (!map || !dot || state !== 'ready') return;
    const source = map.getSource<GeoJSONSource>('accuracy');
    void source?.setData(circle(at, accuracy ?? 0));
    const reduced = prefersReducedMotion();
    if (reduced) {
      proxy.current = { lng: at.lng, lat: at.lat };
      dot.setLngLat([at.lng, at.lat]);
    } else {
      gsap.to(proxy.current, {
        lng: at.lng,
        lat: at.lat,
        duration: 0.6,
        ease: 'power1.inOut',
        onUpdate: () => dot.setLngLat([proxy.current.lng, proxy.current.lat]),
      });
    }
    viewFor(map, at, kitchen, !reduced);
  }, [at, accuracy, kitchen, state]);

  return (
    <div aria-hidden className="relative h-44 min-[22.5rem]:h-56">
      <div ref={containerRef} className={cn('absolute inset-0', state === 'failed' && 'hidden')} />
      {state === 'loading' ? (
        <div className="absolute inset-0 bg-muted motion-safe:animate-skeleton" />
      ) : null}
      {state === 'failed' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted p-4 text-center">
          <MapPinOff className="size-6 text-muted-foreground" />
          <p className="text-body-5 font-medium text-strong">Map unavailable right now</p>
          <p className="text-body-5 text-foreground">Your location is still being shared.</p>
        </div>
      ) : null}
    </div>
  );
}
