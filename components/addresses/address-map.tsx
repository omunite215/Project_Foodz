'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { gsap } from 'gsap';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { type PinDirection, type Point } from '@/lib/map-geometry';
import { prefersReducedMotion } from '@/lib/motion';

/*
 * The map under the address field (design 5.6), loaded the first time an address is picked.
 * MapLibre GL draws OpenFreeMap's muted "positron" style, north-up, opening on the point with no
 * fly-in. The pin can be moved without dragging (tap, the buttons under the map, or the arrow keys
 * while the map has focus); dragging works too. Any failure (no WebGL, blocked tiles, a script
 * error) hands over to the "Map unavailable" state and the form carries on without the map.
 */

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const LOAD_TIMEOUT_MS = 12_000;
const EDGE_PX = 48;
const SVG_NS = 'http://www.w3.org/2000/svg';

let workerReady: Promise<void> | undefined;

/**
 * MapLibre's worker runs from a blob of its own script, so it shares this page's CSP (its tile
 * requests then follow `connect-src`). The script is a pinned file from the package.
 */
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

/** The pin: a brand-green teardrop with a white centre, drawn without innerHTML. */
function pinElement(): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  element.style.filter = 'drop-shadow(0 2px 4px rgb(20 20 22 / 0.3))';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 40');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '40');
  const drop = document.createElementNS(SVG_NS, 'path');
  drop.setAttribute('d', 'M16 39S30 24.6 30 15A14 14 0 0 0 2 15c0 9.6 14 24 14 24Z');
  drop.setAttribute('fill', '#03850a');
  drop.setAttribute('stroke', '#ffffff');
  drop.setAttribute('stroke-width', '2');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', '16');
  dot.setAttribute('cy', '15');
  dot.setAttribute('r', '4');
  dot.setAttribute('fill', '#ffffff');
  svg.append(drop, dot);
  element.append(svg);
  return element;
}

export type PinMove = 'tap' | 'drag' | 'key';

export interface AddressMapProps {
  pin: Point;
  /** "12 Peterborough Street", for the map's name. */
  place: string;
  /** Bump to recentre on the pin (a new pick, "Show the pin"). */
  recentre: number;
  onPinMove: (point: Point, how: PinMove) => void;
  onKeyMove: (direction: PinDirection, meters: number) => void;
  onReady: () => void;
  onFailed: () => void;
}

export default function AddressMap({
  pin,
  place,
  recentre,
  onPinMove,
  onKeyMove,
  onReady,
  onFailed,
}: AddressMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latest = useRef({ pin, onPinMove, onReady, onFailed });
  useEffect(() => {
    latest.current = { pin, onPinMove, onReady, onFailed };
  });

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let map: MapLibreMap | null = null;
    const fail = () => {
      if (failed || cancelled) return;
      failed = true;
      latest.current.onFailed();
    };
    const timeout = setTimeout(fail, LOAD_TIMEOUT_MS);

    void (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        await prepareWorker(maplibre.setWorkerUrl);
        const container = containerRef.current;
        if (cancelled || !container) return;
        const start = latest.current.pin;
        map = new maplibre.Map({
          container,
          style: STYLE_URL,
          center: [start.lng, start.lat],
          zoom: 17,
          minZoom: 12,
          maxZoom: 19,
          cooperativeGestures: true,
          keyboard: false,
          doubleClickZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: false,
        });
        mapRef.current = map;
        map.touchZoomRotate.disableRotation();
        // One Tab stop: the labelled wrapper, not MapLibre's canvas.
        map.getCanvas().setAttribute('tabindex', '-1');

        const marker = new maplibre.Marker({
          element: pinElement(),
          anchor: 'bottom',
          draggable: true,
        })
          .setLngLat([start.lng, start.lat])
          .addTo(map);
        markerRef.current = marker;
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat();
          latest.current.onPinMove({ lat, lng }, 'drag');
        });
        map.on('click', (event) => {
          latest.current.onPinMove({ lat: event.lngLat.lat, lng: event.lngLat.lng }, 'tap');
        });
        map.on('error', (event) => {
          // A missing tile here and there is not a failure; the style or the renderer is.
          if (!map?.isStyleLoaded() || event.error?.message?.includes('WebGL')) fail();
        });
        map.once('load', () => {
          clearTimeout(timeout);
          if (failed || cancelled) return;
          latest.current.onReady();
          if (prefersReducedMotion()) return;
          const drop = marker.getElement().firstElementChild;
          if (drop) gsap.from(drop, { y: -12, duration: 0.25, ease: 'back.out(1.4)' });
        });
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // The pin follows moves; the map pans only when the pin comes near an edge.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([pin.lng, pin.lat]);
    const point = map.project([pin.lng, pin.lat]);
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    if (
      point.x < EDGE_PX ||
      point.y < EDGE_PX ||
      point.x > width - EDGE_PX ||
      point.y > height - EDGE_PX
    ) {
      if (prefersReducedMotion()) map.jumpTo({ center: [pin.lng, pin.lat] });
      else map.panTo([pin.lng, pin.lat], { duration: 200 });
    }
  }, [pin]);

  // A new pick or "Show the pin": recentre (no fly-in under reduced motion, S4.5).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || recentre === 0) return;
    const { pin: current } = latest.current;
    if (prefersReducedMotion()) map.jumpTo({ center: [current.lng, current.lat] });
    else map.easeTo({ center: [current.lng, current.lat], duration: 400 });
  }, [recentre]);

  const zoom = (by: number) => {
    const map = mapRef.current;
    if (!map) return;
    if (prefersReducedMotion()) map.setZoom(map.getZoom() + by);
    else map.zoomTo(map.getZoom() + by, { duration: 200 });
  };

  const control =
    'size-11 rounded-lg border-neutral-6 bg-white text-neutral-2 shadow-card hover:bg-neutral-7';

  return (
    // A keyboard widget: arrow keys move the pin and plus or minus zoom, so screen readers pass
    // the keys through to it. One Tab stop for the whole map.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="application"
      aria-roledescription="map"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={`Map of ${place}. Use the arrow keys to move the pin, and plus or minus to zoom.`}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const directions: Record<string, PinDirection> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        };
        const direction = directions[event.key];
        if (direction) {
          event.preventDefault();
          onKeyMove(direction, event.shiftKey ? 50 : 10);
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoom(1);
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoom(-1);
        }
      }}
      className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <div ref={containerRef} aria-hidden className="h-full w-full overflow-hidden rounded-2xl" />
      <div className="absolute top-3 left-3 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          className={control}
          onClick={() => zoom(1)}
        >
          <Plus className="size-5" aria-hidden />
          <span className="sr-only">Zoom in</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          className={control}
          onClick={() => zoom(-1)}
        >
          <Minus className="size-5" aria-hidden />
          <span className="sr-only">Zoom out</span>
        </Button>
      </div>
      <div className="absolute top-3 right-3">
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          className={control}
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            if (prefersReducedMotion()) map.jumpTo({ center: [pin.lng, pin.lat] });
            else map.easeTo({ center: [pin.lng, pin.lat], duration: 400 });
          }}
        >
          <LocateFixed className="size-5" aria-hidden />
          <span className="sr-only">Show the pin</span>
        </Button>
      </div>
    </div>
  );
}
