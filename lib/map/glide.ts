import { gsap } from 'gsap';
import type { Point } from '@/lib/map-geometry';

/*
 * A marker's glide to each new point (F8 motion table): a linear 1 s tween of its position,
 * started from wherever it is when a new point arrives mid-glide. It never moves on a guess:
 * with no new point it stays put. Under reduced motion it jumps.
 */

export interface PositionedMarker {
  setLngLat: (lngLat: [number, number]) => unknown;
}

export interface Glider {
  to: (point: Point, options?: { reduced?: boolean; seconds?: number }) => void;
  /** Where the marker is drawn now. */
  position: () => Point;
  kill: () => void;
}

export const GLIDE_SECONDS = 1;

export function createGlider(marker: PositionedMarker, start: Point): Glider {
  const proxy = { lat: start.lat, lng: start.lng };
  let tween: gsap.core.Tween | null = null;
  const draw = () => marker.setLngLat([proxy.lng, proxy.lat]);
  return {
    to(point, { reduced = false, seconds = GLIDE_SECONDS } = {}) {
      tween?.kill();
      tween = null;
      if (reduced || seconds <= 0) {
        proxy.lat = point.lat;
        proxy.lng = point.lng;
        draw();
        return;
      }
      tween = gsap.to(proxy, {
        lat: point.lat,
        lng: point.lng,
        duration: seconds,
        ease: 'none',
        onUpdate: draw,
      });
    },
    position: () => ({ lat: proxy.lat, lng: proxy.lng }),
    kill() {
      tween?.kill();
      tween = null;
    },
  };
}
