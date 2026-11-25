import { createStore, useSelector } from '@tanstack/react-store';
import { useEffect, useState } from 'react';
import type { CourierPoint } from '@/server/modules/tracking/schema';
import { serverOffset } from '@/lib/board/clock';

/*
 * The courier's latest point on the customer's order page (F8 L2, S5): the view brings one in
 * the first HTML, `courier.location` on the order's track channel brings the next ones (at most
 * every 4 s). Kept outside React state so a point every 4 seconds moves the marker and the
 * freshness line without re-rendering the order page (design open item 5).
 */

export interface TrackState {
  orderId: string | null;
  point: CourierPoint | null;
  /** Server clock minus the device's, from the view's `asOf`. */
  offset: number;
}

export const trackStore = createStore<TrackState>({ orderId: null, point: null, offset: 0 });

const newer = (next: CourierPoint | null, held: CourierPoint | null) =>
  Boolean(next && (!held || Date.parse(next.at) > Date.parse(held.at)));

/** The view arrived (first HTML, a refetch): its point, unless a newer one is held. */
export function adoptTrackingView(
  orderId: string,
  point: CourierPoint | null,
  asOf: string,
  receivedAt = Date.now(),
) {
  trackStore.setState((state) => {
    const same = state.orderId === orderId;
    const keep = same && !newer(point, state.point) ? state.point : point;
    return { orderId, point: keep, offset: serverOffset(asOf, receivedAt) };
  });
}

/** `courier.location` on the track channel; an older or another order's point is ignored. */
export function onCourierLocation(event: {
  orderId: string;
  lat: number;
  lng: number;
  heading: number | null;
  at: string;
}) {
  const state = trackStore.state;
  if (state.orderId !== event.orderId) return;
  const point: CourierPoint = {
    lat: event.lat,
    lng: event.lng,
    heading: event.heading,
    at: event.at,
  };
  if (!newer(point, state.point)) return;
  trackStore.setState((current) => ({ ...current, point }));
}

/** The end of a delivery: nothing of his position stays in memory (S6.1). */
export function forgetTracking() {
  trackStore.setState(() => ({ orderId: null, point: null, offset: 0 }));
}

/** The held point for this order, or the view's while the store hasn't adopted it yet. */
export function useCourierPoint(
  orderId: string,
  initial: CourierPoint | null,
): CourierPoint | null {
  const held = useSelector(trackStore, (state) => (state.orderId === orderId ? state.point : null));
  return newer(held, initial) ? held : (initial ?? held);
}

/**
 * The server's time, refreshed every `everyMs`. The first render (server and hydration) uses
 * `asOf`, so the HTML matches; the device's clock plus the offset takes over after.
 */
export function useServerNow(asOf: string, everyMs: number): number {
  const offset = useSelector(trackStore, (state) => state.offset);
  const [deviceNow, setDeviceNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setDeviceNow(Date.now()), 0);
    const timer = setInterval(() => setDeviceNow(Date.now()), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [everyMs]);
  return deviceNow === null ? Date.parse(asOf) : deviceNow + offset;
}
