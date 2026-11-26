'use client';

import type { GeoJSONSource } from 'maplibre-gl';
import { LocateFixed, MapPinOff } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { PartnerDeliveryF8 } from '@/server/modules/tracking/schema';
import { MapAttribution, MapFrame, type MapHandle } from '@/components/map/map-frame';
import {
  DoorPin,
  KitchenPin,
  LabelChip,
  mountMarker,
  PinWithLabel,
  YouDot,
} from '@/components/map/markers';
import { RouteLine } from '@/components/map/route-line';
import { Button } from '@/components/ui/button';
import { MAP_PALETTES, type MapPalette } from '@/lib/map/colors';
import { createGlider, type Glider } from '@/lib/map/glide';
import { boundsOf, routeFrom } from '@/lib/map/maplibre';
import { distanceMeters, type Point } from '@/lib/map-geometry';
import { prefersReducedMotion } from '@/lib/motion';
import { DELIVERY_COPY, routeFigure } from '@/lib/partner/delivery-text';
import { isMoving, type PartnerFix } from '@/lib/partner/moving';

export type { PartnerFix };

/*
 * The courier's map (F8 design 2.1), shared by the pick-up and deliver screens: his dot and its
 * accuracy, the next stop's pin and the route to it, centered on him and recentered on each
 * fix. While he moves it takes no touch at all (a bump can't move it); once he has stopped for
 * 10 s, one finger pans and pinches. If he pans, "Recenter" appears and following stops until
 * he presses it or moves again. Hidden from screen readers: the figure under it is the twin.
 */

const FIT_WITHIN_M = 3_000;

/** A circle of `radius` metres, as a GeoJSON polygon (F6 6.8's accuracy ring). */
function circle(center: Point, radius: number) {
  const coordinates: [number, number][] = [];
  const latScale = radius / 111_320;
  const lngScale = radius / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let index = 0; index <= 48; index++) {
    const angle = (index / 48) * Math.PI * 2;
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

function follow(handle: MapHandle, at: Point, stop: Point) {
  const { map } = handle;
  const reduced = prefersReducedMotion();
  if (distanceMeters(at, stop) <= FIT_WITHIN_M) {
    const bounds = boundsOf([at, stop]);
    if (bounds) {
      map.fitBounds(bounds, { padding: 40, minZoom: 13, maxZoom: 16, duration: reduced ? 0 : 600 });
      return;
    }
  }
  const target = { center: [at.lng, at.lat] as [number, number], zoom: 13 };
  if (reduced) map.jumpTo(target);
  else map.easeTo({ ...target, duration: 600 });
}

function PartnerLayers({
  handle,
  palette,
  fix,
  stop,
  toDoor,
  customerFirst,
  route,
  following,
  moving,
  stale,
  onPanned,
}: {
  handle: MapHandle;
  palette: MapPalette;
  fix: PartnerFix | null;
  stop: Point;
  toDoor: boolean;
  customerFirst: string | null;
  route: PartnerDeliveryF8['route'];
  following: boolean;
  moving: boolean;
  /** Review S8: no accepted point for 2 minutes: his dot gray, the route dashed. */
  stale: boolean;
  onPanned: () => void;
}) {
  const { map } = handle;
  const dot = useRef<{
    glider: Glider;
    remove: () => void;
    render: (node: ReactNode) => void;
  } | null>(null);
  const latest = useRef({ onPanned });
  useEffect(() => {
    latest.current = { onPanned };
  });

  // The next stop's pin, and the accuracy ring under his dot.
  useEffect(() => {
    const pin = mountMarker(
      handle,
      stop,
      toDoor ? (
        <PinWithLabel
          pin={<DoorPin palette={palette} />}
          label={customerFirst ? <LabelChip text={customerFirst} palette={palette} /> : null}
        />
      ) : (
        <KitchenPin palette={palette} />
      ),
      { anchor: 'bottom' },
    );
    if (!map.getSource('accuracy')) {
      map.addSource('accuracy', { type: 'geojson', data: circle(stop, 0) });
      map.addLayer({
        id: 'accuracy-fill',
        type: 'fill',
        source: 'accuracy',
        paint: { 'fill-color': palette.you, 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: 'accuracy-line',
        type: 'line',
        source: 'accuracy',
        paint: { 'line-color': palette.you, 'line-opacity': 0.5, 'line-width': 1.5 },
      });
    }
    const panned = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) latest.current.onPanned();
    };
    map.on('dragstart', panned);
    map.on('zoomstart', panned);
    return () => {
      map.off('dragstart', panned);
      map.off('zoomstart', panned);
      pin.remove();
    };
  }, [handle, map, stop, toDoor, customerFirst, palette]);

  // No touch while he moves; one-finger pan and pinch once stopped (north stays up).
  useEffect(() => {
    if (moving) {
      map.dragPan.disable();
      map.touchZoomRotate.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragPan.enable();
      map.touchZoomRotate.enable();
      map.touchZoomRotate.disableRotation();
      map.scrollZoom.enable();
    }
  }, [map, moving]);

  // His dot glides to each fix; the camera follows unless he panned.
  useEffect(() => {
    if (!fix) return;
    if (!dot.current) {
      const mounted = mountMarker(handle, fix, <YouDot palette={palette} stale={stale} />);
      dot.current = {
        glider: createGlider(mounted.marker, fix),
        remove: mounted.remove,
        render: mounted.render,
      };
    } else {
      dot.current.glider.to(fix, { reduced: prefersReducedMotion() });
    }
    void map.getSource<GeoJSONSource>('accuracy')?.setData(circle(fix, fix.accuracy ?? 0));
    if (following) follow(handle, fix, stop);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [fix?.at, following]);

  useEffect(() => {
    dot.current?.render(<YouDot palette={palette} stale={stale} />);
  }, [palette, stale]);

  useEffect(
    () => () => {
      dot.current?.glider.kill();
      dot.current?.remove();
      dot.current = null;
    },
    [],
  );

  return (
    <RouteLine
      handle={handle}
      coordinates={routeFrom(route?.geojson?.coordinates ?? null, fix, stop)}
      palette={palette}
      stale={stale}
    />
  );
}

export function PartnerMapCard({
  delivery,
  fix,
  fixes,
  dark,
  now,
  serverNow,
  openInMaps,
  locationRow,
  stale = false,
}: {
  delivery: PartnerDeliveryF8;
  /** His latest fix (the demo partner's pretend point). */
  fix: PartnerFix | null;
  /** The last few fixes, for moving or stopped. */
  fixes: readonly PartnerFix[];
  dark: boolean;
  /** The device's clock, ticking, so standing still for 10 s counts as stopped. */
  now: number;
  serverNow: number;
  openInMaps: ReactNode;
  /** F6's location line, only when it isn't "Shared". */
  locationRow: ReactNode;
  /** Review S8: his own point is stale (the freshness rule). */
  stale?: boolean;
}) {
  const toDoor = delivery.status === 'PICKED_UP' && delivery.dropoff !== null;
  const stop = toDoor && delivery.dropoff ? delivery.dropoff.point : delivery.kitchen.point;
  const palette = MAP_PALETTES[dark ? 'dark' : 'light'];
  const [panned, setPanned] = useState(false);
  const moving = isMoving(fixes, now);
  // Moving again brings back the follow.
  const following = !panned || moving;
  const figure = routeFigure(
    delivery.route,
    !toDoor,
    serverNow,
    fix && toDoor ? Math.round(distanceMeters(fix, stop)) : (delivery.route?.distanceM ?? null),
  );

  return (
    <section
      aria-label={toDoor ? 'Route to the drop-off' : 'Route to the kitchen'}
      data-partner-map=""
      data-stale={stale || undefined}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <MapFrame
        boxClassName="h-44 bg-muted min-[22.5rem]:h-56"
        options={{
          theme: dark ? 'dark' : 'light',
          center: fix ?? stop,
          zoom: 14,
          gestures: 'free',
          maxZoom: 18,
        }}
        failure={
          <>
            <MapPinOff className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-body-5 font-medium text-strong">{DELIVERY_COPY.mapFailed}</p>
            <p className="text-body-5 text-foreground">{DELIVERY_COPY.stillSharing}</p>
          </>
        }
        overlay={
          panned && !moving ? (
            <div className="absolute right-3 bottom-3">
              <Button
                type="button"
                size="kitchen"
                aria-label={DELIVERY_COPY.recenterName}
                onClick={() => setPanned(false)}
                className="rounded-full border border-input bg-card text-strong shadow-raised hover:bg-muted"
              >
                <LocateFixed className="size-5" aria-hidden />
                {DELIVERY_COPY.recenter}
              </Button>
            </div>
          ) : null
        }
      >
        {(handle) => (
          <PartnerLayers
            handle={handle}
            palette={palette}
            fix={fix}
            stop={stop}
            toDoor={toDoor}
            customerFirst={delivery.dropoff?.firstName ?? null}
            route={delivery.route}
            following={following}
            moving={moving}
            stale={stale}
            onPanned={() => {
              if (!moving) setPanned(true);
            }}
          />
        )}
      </MapFrame>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-3">
        {figure ? (
          <p className="text-body-4 text-foreground">
            <span aria-hidden>
              <b className="text-title-2 font-semibold text-strong tabular-nums">{figure.figure}</b>
              {figure.rest}
            </span>
            <span className="sr-only">{figure.spoken}</span>
          </p>
        ) : (
          <span />
        )}
        {openInMaps}
      </div>
      {locationRow ? <div className="border-t border-border">{locationRow}</div> : null}
      <MapAttribution className="border-t border-border px-3 py-1.5 text-muted-foreground" />
    </section>
  );
}
