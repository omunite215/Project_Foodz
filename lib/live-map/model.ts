import type {
  MapState,
  OpsMapCourier,
  OpsMapDelivery,
  OpsMapSnapshot,
} from '@/server/modules/tracking/schema';
import { mapStateWords } from '@/server/modules/tracking/text';

/*
 * The live map's model (F8 A46): the snapshot as the browser holds it, and one courier's move
 * applied to it. Pure, so the list, the markers and the panel always read the same copy.
 */

export type OpsMapData = OpsMapSnapshot & {
  /** The device's clock when the snapshot arrived, for the server clock offset. */
  receivedAt: number;
};

export interface PositionEvent {
  partnerId: string;
  lat: number;
  lng: number;
  heading: number | null;
  state: MapState;
  at: string;
}

/**
 * One courier moved or changed state. An older point is ignored; a courier the snapshot
 * doesn't know yet comes with the next snapshot (it needs a name).
 */
export function applyPosition(data: OpsMapData, event: PositionEvent): OpsMapData | null {
  const index = data.couriers.findIndex((courier) => courier.partnerId === event.partnerId);
  const courier = data.couriers[index];
  if (!courier) return null;
  if (courier.at && Date.parse(event.at) < Date.parse(courier.at)) return data;
  const next = {
    ...courier,
    point: { lat: event.lat, lng: event.lng },
    heading: event.heading,
    at: event.at,
    freshness: 'live' as const,
    state: event.state,
    words: mapStateWords(event.state, courier.orderNumber, null),
  };
  const couriers = [...data.couriers];
  couriers[index] = next;
  return { ...data, couriers };
}

type Point = { lat: number; lng: number };

/** The camera's first view (design 3.3): the kitchen and every marker on the map. */
export function firstViewPoints(
  kitchen: Point | null,
  couriers: readonly Pick<OpsMapCourier, 'point'>[],
  deliveries: readonly Pick<OpsMapDelivery, 'dropoffPoint'>[],
): Point[] {
  return [
    ...(kitchen ? [kitchen] : []),
    ...couriers.flatMap((courier) => (courier.point ? [courier.point] : [])),
    ...deliveries.map((delivery) => delivery.dropoffPoint),
  ];
}
