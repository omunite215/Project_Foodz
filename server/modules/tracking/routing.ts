import 'server-only';
import { z } from 'zod';
import { latLngSchema } from '@/lib/geo';
import type { VehicleType } from '@/server/db/enums';
import { logger } from '@/server/logger';
import { type Point, straightLineEstimate, vehicleSeconds } from './rules';
import { ROUTING } from './schema';

/*
 * The route and arrival estimate (F8 contract §1, lead decision on question 1): the straight
 * line everywhere by default. OSRM is used only when ROUTING_PROVIDER=osrm and OSRM_URL names a
 * self-hosted server (an optional ECS service); the public OSRM server is never called. Calls
 * are server-side only, with validated numeric coordinates and a 3 s timeout, and fall back to
 * the straight line on any failure. Logs carry ids and timings only.
 */

export interface RouteResult {
  geojson: { type: 'LineString'; coordinates: [number, number][] } | null;
  distanceM: number;
  durationSec: number;
  etaAt: Date;
  estimated: boolean;
}

const osrmAnswer = z.object({
  code: z.literal('Ok'),
  routes: z
    .array(
      z.object({
        distance: z.number().nonnegative(),
        duration: z.number().nonnegative(),
        geometry: z.object({
          type: z.literal('LineString'),
          coordinates: z.array(z.tuple([z.number(), z.number()])).max(20_000),
        }),
      }),
    )
    .min(1),
});

export function routingProvider(env: Record<string, string | undefined> = process.env) {
  const base = env.OSRM_URL?.trim();
  if (env.ROUTING_PROVIDER !== 'osrm' || !base) return { kind: 'straight' as const };
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'straight' as const };
  return { kind: 'osrm' as const, base: url.toString().replace(/\/$/, '') };
}

function straight(from: Point, to: Point, vehicle: VehicleType, now: Date): RouteResult {
  const estimate = straightLineEstimate(from, to, vehicle, now);
  return {
    geojson: {
      type: 'LineString',
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
    distanceM: estimate.distanceM,
    durationSec: estimate.durationSec,
    etaAt: new Date(estimate.etaAt),
    estimated: true,
  };
}

export async function routeBetween(
  fromRaw: Point,
  toRaw: Point,
  vehicle: VehicleType,
  context: { deliveryId: string; now?: Date; env?: Record<string, string | undefined> },
): Promise<RouteResult> {
  const now = context.now ?? new Date();
  const from = latLngSchema.parse({ lat: fromRaw.lat, lng: fromRaw.lng });
  const to = latLngSchema.parse({ lat: toRaw.lat, lng: toRaw.lng });
  const provider = routingProvider(context.env);
  if (provider.kind === 'straight') return straight(from, to, vehicle, now);
  const started = performance.now();
  try {
    const path = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
    const response = await fetch(
      `${provider.base}/route/v1/driving/${path}?overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(ROUTING.timeoutMs) },
    );
    const answer = osrmAnswer.parse(await response.json());
    const best = answer.routes[0]!;
    const durationSec = vehicleSeconds(best.duration, vehicle);
    logger.info(
      {
        deliveryId: context.deliveryId,
        provider: 'osrm',
        ms: Math.round(performance.now() - started),
      },
      'route',
    );
    return {
      geojson: best.geometry,
      distanceM: Math.round(best.distance),
      durationSec,
      etaAt: new Date(now.getTime() + durationSec * 1000),
      estimated: false,
    };
  } catch (error) {
    logger.warn(
      {
        deliveryId: context.deliveryId,
        provider: 'osrm',
        ms: Math.round(performance.now() - started),
        err: error instanceof Error ? error.name : 'error',
      },
      'route failed; straight line used',
    );
    return straight(from, to, vehicle, now);
  }
}

/** The demo run's points along a route, one per `stepSeconds` at `speedKmh` (L10.1). */
export function ridePoints(
  coordinates: readonly [number, number][],
  speedKmh: number,
  stepSeconds: number,
): Point[] {
  const step = (speedKmh / 3.6) * stepSeconds;
  const points: Point[] = [];
  let carried = 0;
  for (let index = 0; index + 1 < coordinates.length; index += 1) {
    const [aLng, aLat] = coordinates[index]!;
    const [bLng, bLat] = coordinates[index + 1]!;
    const a = { lat: aLat, lng: aLng };
    const b = { lat: bLat, lng: bLng };
    const length = straightLineEstimate(a, b, 'CAR', new Date(0)).distanceM;
    let along = step - carried;
    while (along <= length) {
      const t = length === 0 ? 1 : along / length;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      along += step;
    }
    carried = length - (along - step);
  }
  const last = coordinates.at(-1);
  if (last) points.push({ lat: last[1], lng: last[0] });
  return points;
}
