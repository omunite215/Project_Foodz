/*
 * Small distances on the map, for moving the pin without dragging (S4.5). The map is always
 * north-up, so "up" is north and "right" is east. Accurate to well under a metre at city scale.
 */

export interface Point {
  lat: number;
  lng: number;
}

export type PinDirection = 'up' | 'down' | 'left' | 'right';

const METERS_PER_DEGREE = 111_320;
const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** The point `meters` away in a map direction. */
export function movePoint(point: Point, direction: PinDirection, meters: number): Point {
  const north = direction === 'up' ? meters : direction === 'down' ? -meters : 0;
  const east = direction === 'right' ? meters : direction === 'left' ? -meters : 0;
  const lat = point.lat + north / METERS_PER_DEGREE;
  const lng = point.lng + east / (METERS_PER_DEGREE * Math.cos(toRadians(point.lat)));
  return { lat: round(lat), lng: round(lng) };
}

/** Seven decimals (about a centimetre) keeps repeated moves from drifting in display. */
const round = (value: number) => Math.round(value * 1e7) / 1e7;

/** Straight-line distance in metres (haversine). */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "30 m up", "120 m left": how far the pin is from where the search put it. */
export function offsetText(from: Point, to: Point): string | null {
  const north = (to.lat - from.lat) * METERS_PER_DEGREE;
  const east = (to.lng - from.lng) * METERS_PER_DEGREE * Math.cos(toRadians(from.lat));
  const meters = Math.round(Math.hypot(north, east) / 10) * 10;
  if (meters === 0) return null;
  const direction =
    Math.abs(north) >= Math.abs(east) ? (north > 0 ? 'up' : 'down') : east > 0 ? 'right' : 'left';
  return `${meters} m ${direction}`;
}

/** Further than this from the found point, the form asks to check the building. */
export const FAR_FROM_ADDRESS_M = 150;

/** "about 400 m" for the far-from-the-address hint. */
export function roughMeters(meters: number): string {
  return `about ${Math.round(meters / 10) * 10} m`;
}
