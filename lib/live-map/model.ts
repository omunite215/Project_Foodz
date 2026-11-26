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

// ------------------------------------------------------------------ stacking and labels (3.3)

export type Stacked = { kind: 'courier' | 'delivery'; id: string };

/**
 * Top first (review S5): the selected courier, the other couriers, then the drop-off pins (the
 * selected one first). Couriers sit above pins, so a pin never hides a state at the door, and
 * the label that wins a clash belongs to the marker drawn on top.
 */
export function stackOrder(
  selection: Stacked | null,
  courierIds: readonly string[],
  pinIds: readonly string[],
): Stacked[] {
  const first = (kind: Stacked['kind'], ids: readonly string[]) =>
    ids
      .toSorted(
        (a, b) =>
          Number(selection?.kind === kind && b === selection.id) -
          Number(selection?.kind === kind && a === selection.id),
      )
      .map((id) => ({ kind, id }));
  return [...first('courier', courierIds), ...first('delivery', pinIds)];
}

export interface LabelBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The selected marker's label always shows. */
  keep: boolean;
}

/** Labels (courier chips and drop-off chips alike) that would overlap one drawn above them. */
export function hiddenLabels(boxes: readonly LabelBox[]): Set<string> {
  const kept: LabelBox[] = [];
  const hidden = new Set<string>();
  for (const box of boxes) {
    const clash = kept.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    if (clash && !box.keep) hidden.add(box.id);
    else kept.push(box);
  }
  return hidden;
}
