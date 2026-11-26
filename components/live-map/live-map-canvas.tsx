'use client';

import {
  Bike,
  Car,
  DoorClosed,
  House,
  LockKeyhole,
  type LucideIcon,
  MapPinOff,
  MessageCircleWarning,
  Motorbike,
  Scooter,
  Send,
  Store,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { VehicleType } from '@/server/db/enums';
import type { MapState, OpsMapCourier, OpsMapDelivery } from '@/server/modules/tracking/schema';
import { MapFrame, type MapHandle } from '@/components/map/map-frame';
import {
  CourierDisc,
  KitchenPin,
  LabelChip,
  mountMarker,
  type MountedMarker,
  TeardropPin,
} from '@/components/map/markers';
import { RouteLine } from '@/components/map/route-line';
import { MAP_PALETTES, STALE_FILL, STATE_FILLS } from '@/lib/map/colors';
import { createGlider, type Glider } from '@/lib/map/glide';
import { firstViewPoints } from '@/lib/live-map/model';
import { boundsOf, inView } from '@/lib/map/maplibre';
import { prefersReducedMotion } from '@/lib/motion';
import {
  ageSeconds,
  freshnessFor,
  isHollow,
  isStale,
  noLocationWords,
} from '@/lib/tracking/freshness';

/*
 * The live map's canvas (F8 design 3.3): every courier as a disc in his state's color, icon and
 * word (hollow from 45 s without a point, gray from 2 minutes), each drop-off as a pin with its
 * order number, and a dashed joiner from a selected delivering courier to his drop-off. Labels
 * hide where they'd overlap, the selected one never does; the list carries every word. The map
 * is hidden from screen readers and its markers aren't tab stops (A55.2).
 */

const LIGHT = MAP_PALETTES.light;

const VEHICLES: Record<VehicleType, LucideIcon> = {
  BICYCLE: Bike,
  SCOOTER: Scooter,
  MOTORBIKE: Motorbike,
  CAR: Car,
};

export function stateIcon(state: MapState, vehicle: VehicleType): LucideIcon {
  switch (state) {
    case 'offered':
      return Send;
    case 'atKitchen':
      return Store;
    case 'noAnswer':
      return DoorClosed;
    case 'locked':
      return LockKeyhole;
    case 'problem':
      return MessageCircleWarning;
    default:
      return VEHICLES[vehicle];
  }
}

export interface MarkerLook {
  fill: string;
  hollow: boolean;
  label: string;
}

/** The marker's color, shape and label from his state and the point's age (design 0). */
export function markerLook(courier: OpsMapCourier, serverNowMs: number): MarkerLook {
  const seconds = ageSeconds(courier.at, serverNowMs);
  const freshness = freshnessFor(seconds);
  const hollow = isHollow(freshness);
  const fill = isStale(freshness) ? STALE_FILL : STATE_FILLS[courier.state];
  const words = hollow && seconds !== null ? noLocationWords(seconds) : courier.words;
  return { fill, hollow, label: `${courier.shortName} · ${words}` };
}

export type Selection = { kind: 'courier' | 'delivery'; id: string } | null;

interface CourierMarker {
  mounted: MountedMarker;
  glider: Glider;
  at: string | null;
}

/** Labels that would overlap hide; the selected one first, then in list order (A46.6). */
function placeLabels(markers: readonly HTMLElement[]) {
  const kept: DOMRect[] = [];
  for (const marker of markers) {
    const label = marker.querySelector<HTMLElement>('[data-label]');
    if (!label) continue;
    label.style.visibility = 'visible';
    const box = label.getBoundingClientRect();
    const clash = kept.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    if (clash && marker.dataset.selected !== 'true') label.style.visibility = 'hidden';
    else kept.push(box);
  }
}

function CanvasLayers({
  handle,
  couriers,
  deliveries,
  kitchen,
  serverNowMs,
  selection,
  onSelect,
}: {
  handle: MapHandle;
  couriers: readonly OpsMapCourier[];
  deliveries: readonly OpsMapDelivery[];
  kitchen: { lat: number; lng: number } | null;
  serverNowMs: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const { map } = handle;
  const courierMarkers = useRef(new Map<string, CourierMarker>());
  const pinMarkers = useRef(new Map<string, MountedMarker>());
  const fitted = useRef(false);
  const latest = useRef({ onSelect });
  useEffect(() => {
    latest.current = { onSelect };
  });

  const relabel = () => {
    const selectedFirst = [...courierMarkers.current.entries()]
      .toSorted(([a], [b]) => Number(b === selection?.id) - Number(a === selection?.id))
      .map(([, marker]) => marker.mounted.element);
    placeLabels(selectedFirst);
  };

  // Couriers: placed, glided to new points, restyled, removed when they go offline.
  useEffect(() => {
    const seen = new Set<string>();
    const reduced = prefersReducedMotion();
    for (const courier of couriers) {
      if (!courier.point) continue;
      seen.add(courier.partnerId);
      const look = markerLook(courier, serverNowMs);
      const selected = selection?.kind === 'courier' && selection.id === courier.partnerId;
      const node = (
        <span className="relative block cursor-pointer p-1.5" data-partner={courier.partnerId}>
          <CourierDisc
            fill={look.fill}
            icon={stateIcon(courier.state, courier.vehicle)}
            size={32}
            hollow={look.hollow}
            heading={look.hollow ? null : courier.heading}
            selected={selected}
            selectedColor={LIGHT.selected}
          />
          <span data-label="" className="absolute top-2.5 left-full ml-1">
            <LabelChip text={look.label} palette={LIGHT} />
          </span>
        </span>
      );
      const held = courierMarkers.current.get(courier.partnerId);
      if (!held) {
        const mounted = mountMarker(handle, courier.point, node);
        mounted.element.addEventListener('click', () =>
          latest.current.onSelect({ kind: 'courier', id: courier.partnerId }),
        );
        courierMarkers.current.set(courier.partnerId, {
          mounted,
          glider: createGlider(mounted.marker, courier.point),
          at: courier.at,
        });
      } else {
        held.mounted.element.dataset.selected = String(selected);
        held.mounted.render(node);
        if (held.at !== courier.at) {
          held.glider.to(courier.point, { reduced });
          held.at = courier.at;
        }
      }
    }
    for (const [id, marker] of courierMarkers.current) {
      if (seen.has(id)) continue;
      marker.glider.kill();
      marker.mounted.remove();
      courierMarkers.current.delete(id);
    }
    const timer = setTimeout(relabel, 50);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [couriers, serverNowMs, selection]);

  // Drop-off pins with their order numbers; a delivered order's pin leaves.
  useEffect(() => {
    const seen = new Set<string>();
    for (const delivery of deliveries) {
      seen.add(delivery.orderId);
      const selected = selection?.kind === 'delivery' && selection.id === delivery.orderId;
      const node = (
        <span className="relative block cursor-pointer" data-order={delivery.number}>
          <TeardropPin
            fill={LIGHT.door}
            stroke={LIGHT.doorStroke}
            glyph={House}
            glyphColor={LIGHT.doorGlyph}
            width={selected ? 32 : 24}
          />
          <span className="absolute top-0.5 left-full ml-1">
            <LabelChip text={delivery.number} palette={LIGHT} />
          </span>
        </span>
      );
      const held = pinMarkers.current.get(delivery.orderId);
      if (held) held.render(node);
      else {
        const mounted = mountMarker(handle, delivery.dropoffPoint, node, { anchor: 'bottom' });
        mounted.element.addEventListener('click', () =>
          latest.current.onSelect({ kind: 'delivery', id: delivery.orderId }),
        );
        pinMarkers.current.set(delivery.orderId, mounted);
      }
    }
    for (const [id, pin] of pinMarkers.current) {
      if (seen.has(id)) continue;
      pin.remove();
      pinMarkers.current.delete(id);
    }
  }, [handle, deliveries, selection]);

  // Design 3.3: F6's kitchen pin (kept by value, so a refreshed snapshot doesn't redraw it).
  const kitchenLat = kitchen?.lat;
  const kitchenLng = kitchen?.lng;
  useEffect(() => {
    if (kitchenLat === undefined || kitchenLng === undefined) return undefined;
    const pin = mountMarker(
      handle,
      { lat: kitchenLat, lng: kitchenLng },
      <span data-kitchen-pin="">
        <KitchenPin palette={LIGHT} />
      </span>,
      { anchor: 'bottom' },
    );
    return () => pin.remove();
  }, [handle, kitchenLat, kitchenLng]);

  // The first view fits the kitchen and every marker, once; after that the map never moves by
  // itself.
  useEffect(() => {
    if (fitted.current) return;
    const bounds = boundsOf(firstViewPoints(kitchen, couriers, deliveries));
    if (!bounds) return;
    fitted.current = true;
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }, [map, couriers, deliveries, kitchen]);

  // Selecting from the list eases to the marker, only when it's off screen.
  useEffect(() => {
    if (!selection) return;
    const point =
      selection.kind === 'courier'
        ? couriers.find((courier) => courier.partnerId === selection.id)?.point
        : deliveries.find((delivery) => delivery.orderId === selection.id)?.dropoffPoint;
    if (!point || inView(map, point, 48)) return;
    if (prefersReducedMotion()) map.jumpTo({ center: [point.lng, point.lat] });
    else map.easeTo({ center: [point.lng, point.lat], duration: 600 });
    // oxlint-disable-next-line react/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    const onMove = () => relabel();
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
    };
  });

  useEffect(
    () => () => {
      for (const marker of courierMarkers.current.values()) {
        marker.glider.kill();
        marker.mounted.remove();
      }
      for (const pin of pinMarkers.current.values()) pin.remove();
      courierMarkers.current.clear();
      pinMarkers.current.clear();
    },
    [],
  );

  // The dashed joiner: a selected delivering courier and his drop-off read as a pair.
  const selectedCourier =
    selection?.kind === 'courier'
      ? couriers.find((courier) => courier.partnerId === selection.id)
      : null;
  const joined = selectedCourier?.orderId
    ? deliveries.find((delivery) => delivery.orderId === selectedCourier.orderId)
    : null;
  return (
    <RouteLine
      handle={handle}
      id="joiner"
      dashed
      coordinates={
        selectedCourier?.point && joined
          ? [
              [selectedCourier.point.lng, selectedCourier.point.lat],
              [joined.dropoffPoint.lng, joined.dropoffPoint.lat],
            ]
          : null
      }
      palette={LIGHT}
    />
  );
}

export function LiveMapCanvas({
  couriers,
  deliveries,
  kitchen = null,
  serverNowMs,
  selection,
  onSelect,
}: {
  couriers: readonly OpsMapCourier[];
  deliveries: readonly OpsMapDelivery[];
  kitchen?: { lat: number; lng: number } | null;
  serverNowMs: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const first = kitchen ??
    couriers.find((courier) => courier.point)?.point ??
    deliveries[0]?.dropoffPoint ?? { lat: 42.3505, lng: -71.045 };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MapFrame
        boxClassName="min-h-0 flex-1 bg-neutral-7"
        options={{ theme: 'light', center: first, zoom: 13, gestures: 'free', maxZoom: 18 }}
        failure={
          <>
            <MapPinOff className="size-6 text-neutral-3" aria-hidden />
            <p className="text-body-4 text-neutral-1">
              Map unavailable right now. The list is still live.
            </p>
          </>
        }
      >
        {(handle) => (
          <CanvasLayers
            handle={handle}
            couriers={couriers}
            deliveries={deliveries}
            kitchen={kitchen}
            serverNowMs={serverNowMs}
            selection={selection}
            onSelect={onSelect}
          />
        )}
      </MapFrame>
      <p className="flex h-7 shrink-0 items-center border-t border-neutral-6 bg-white px-3 text-caption text-neutral-3">
        Map © OpenFreeMap · © OpenMapTiles · Data © OpenStreetMap contributors
      </p>
    </div>
  );
}
