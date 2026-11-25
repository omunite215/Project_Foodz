'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, MapOptions } from 'maplibre-gl';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { MAP_STYLES, type MapTheme } from '@/lib/map/colors';
import {
  COOPERATIVE_LOCALE,
  loadMapLibre,
  MAP_LOAD_TIMEOUT_MS,
  type MapLibreModule,
} from '@/lib/map/maplibre';
import type { Point } from '@/lib/map-geometry';
import { cn } from '@/lib/utils';

/*
 * The one MapLibre frame every F8 map is drawn in (design 0, "Components"). The F6 S2 rule:
 * MapLibre's stylesheet is unlayered, so `.maplibregl-map { position: relative }` beats
 * Tailwind's `absolute inset-0` and the map collapses to 0 px. The box owns the height (its own
 * classes, or a sized grid cell) and the container inside it is always `h-full w-full`. The
 * canvas is out of the tab order and hidden from screen readers; a text twin stands in for it.
 * A map that fails (no WebGL, tiles blocked, offline, 10 s) keeps its box and says so; it never
 * takes the text around it with it.
 */

export type MapState = 'loading' | 'ready' | 'failed';

export interface MapHandle {
  map: MapLibreMap;
  lib: MapLibreModule;
}

export type MapGestures =
  /** Customer: one finger scrolls the page, two move the map. */
  | 'cooperative'
  /** Staff live map: the whole view, ordinary pan and zoom. */
  | 'free'
  /** Detail map and the partner's map while he moves: no touch at all. */
  | 'none';

export interface MapFrameOptions {
  theme: MapTheme;
  center: Point;
  zoom: number;
  gestures: MapGestures;
  minZoom?: number;
  maxZoom?: number;
}

export function useMapLibre(
  containerRef: RefObject<HTMLDivElement | null>,
  options: MapFrameOptions,
): { handle: MapHandle | null; state: MapState } {
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [state, setState] = useState<MapState>('loading');
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const { theme, gestures } = options;

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let observer: ResizeObserver | null = null;
    const fail = () => {
      if (cancelled) return;
      setState('failed');
      setHandle(null);
    };
    const timeout = setTimeout(fail, MAP_LOAD_TIMEOUT_MS);
    void (async () => {
      try {
        const lib = await loadMapLibre();
        const container = containerRef.current;
        if (cancelled || !container) return;
        const start = latest.current;
        const init: MapOptions = {
          container,
          style: MAP_STYLES[theme],
          center: [start.center.lng, start.center.lat],
          zoom: start.zoom,
          minZoom: start.minZoom ?? 3,
          maxZoom: start.maxZoom ?? 18,
          attributionControl: false,
          keyboard: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          interactive: gestures !== 'none',
          cooperativeGestures: gestures === 'cooperative',
          locale: COOPERATIVE_LOCALE,
        };
        map = new lib.Map(init);
        map.touchZoomRotate.disableRotation();
        map.getCanvas().setAttribute('tabindex', '-1');
        map.on('error', (event) => {
          // Tile hiccups are retried by MapLibre; a style that never loads, or WebGL, fails.
          const message = event.error?.message ?? '';
          if (!map?.isStyleLoaded() || message.includes('WebGL')) fail();
        });
        map.once('load', () => {
          if (cancelled || !map) return;
          clearTimeout(timeout);
          map.resize();
          observer = new ResizeObserver(() => map?.resize());
          observer.observe(container);
          setHandle({ map, lib });
          setState('ready');
        });
      } catch {
        fail();
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      observer?.disconnect();
      map?.remove();
      setHandle(null);
      setState('loading');
    };
  }, [containerRef, theme, gestures]);

  return { handle, state };
}

/**
 * The box and its container. `boxClassName` gives the height (`h-60`, `h-44 min-[22.5rem]:h-56`,
 * or `h-full` in a sized cell); `children` draws on the map once its style has loaded.
 */
export function MapFrame({
  boxClassName,
  options,
  failure,
  overlay,
  onState,
  children,
}: {
  boxClassName: string;
  options: MapFrameOptions;
  /** What the box says when the map fails, centered. */
  failure: ReactNode;
  /** Controls drawn over a ready map; each carries its own background and a 3:1 edge. */
  overlay?: ReactNode;
  onState?: (state: MapState) => void;
  children?: (handle: MapHandle) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { handle, state } = useMapLibre(containerRef, options);
  const reported = useRef<MapState | null>(null);
  useEffect(() => {
    if (reported.current === state) return;
    reported.current = state;
    onState?.(state);
  });

  return (
    <div className={cn('relative overflow-hidden', boxClassName)} data-map-state={state}>
      <div
        ref={containerRef}
        aria-hidden
        data-map-container=""
        className={cn('h-full w-full', state === 'failed' && 'invisible')}
      />
      {state === 'loading' ? (
        <div aria-hidden className="absolute inset-0 bg-muted motion-safe:animate-skeleton" />
      ) : null}
      {state === 'failed' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted p-4 text-center">
          {failure}
        </div>
      ) : null}
      {state === 'ready' && handle ? (
        <>
          {children?.(handle)}
          {overlay}
        </>
      ) : null}
    </div>
  );
}

/** The attribution line under every map (design 1.3, 2.1). */
export function MapAttribution({ className }: { className?: string }) {
  return (
    <p className={cn('text-caption leading-normal', className)}>
      Map ©{' '}
      <a href="https://openfreemap.org" className="underline underline-offset-2">
        OpenFreeMap
      </a>{' '}
      ·{' '}
      <a href="https://openmaptiles.org" className="underline underline-offset-2">
        © OpenMapTiles
      </a>{' '}
      · Data{' '}
      <a href="https://www.openstreetmap.org/copyright" className="underline underline-offset-2">
        © OpenStreetMap contributors
      </a>
    </p>
  );
}
