import 'server-only';
import { z } from 'zod';
import { logger } from '@/server/logger';
import { redis, waitUntilReady } from '@/server/redis';
import { LOCATION_TTL_SECONDS } from './location';

/*
 * The partner's one live point (B7, P15.2): the last accepted position in Redis under
 * `partner:loc:<partnerId>`, expiring 10 minutes after the last write. No history is kept.
 */

const storedPoint = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  heading: z.number().nullable(),
  speed: z.number().nullable(),
  recordedAt: z.string(),
  /**
   * The server's acceptance time: "Location shared · 20 s ago", and what freshness reads. The
   * same coordinates again move it at most 2 minutes past `movedAt` (S7, `pointClocks`).
   */
  acceptedAt: z.string(),
  /** When the coordinates last changed; missing on points kept before it existed. */
  movedAt: z.string().nullish(),
  /** When the point last went to `last_location` (at most once a minute). */
  writtenAt: z.string().nullable(),
});
export type StoredPoint = z.infer<typeof storedPoint>;

const keyOf = (partnerId: string) => `partner:loc:${partnerId}`;
const jumpsKey = (partnerId: string) => `partner:jumps:${partnerId}`;

export async function readPoint(partnerId: string): Promise<StoredPoint | null> {
  await waitUntilReady();
  const raw = await redis.get(keyOf(partnerId));
  if (!raw) return null;
  const parsed = storedPoint.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function readPoints(partnerIds: string[]): Promise<Map<string, StoredPoint>> {
  const found = new Map<string, StoredPoint>();
  if (partnerIds.length === 0) return found;
  await waitUntilReady();
  const values = await redis.mget(partnerIds.map(keyOf));
  values.forEach((raw, index) => {
    const id = partnerIds[index];
    if (!raw || !id) return;
    const parsed = storedPoint.safeParse(JSON.parse(raw));
    if (parsed.success) found.set(id, parsed.data);
  });
  return found;
}

export async function writePoint(
  partnerId: string,
  point: StoredPoint,
  ttlSeconds = LOCATION_TTL_SECONDS,
) {
  await waitUntilReady();
  await redis.set(keyOf(partnerId), JSON.stringify(point), 'EX', ttlSeconds);
}

/** Going offline deletes the point at once (P12.1). A failure is logged; the TTL still ends it. */
export async function deletePoint(partnerId: string) {
  try {
    await waitUntilReady();
    await redis.del(keyOf(partnerId));
  } catch (error) {
    logger.error(
      { err: error, partnerId, alert: 'partner-location' },
      'could not delete the live point',
    );
  }
}

/** Refused jumps in the last hour (P16.6); returns the new count. */
export async function countJumps(partnerId: string, jumps: number): Promise<number> {
  if (jumps === 0) return 0;
  try {
    await waitUntilReady();
    const total = await redis.incrby(jumpsKey(partnerId), jumps);
    if (total === jumps) await redis.expire(jumpsKey(partnerId), 3600);
    return total;
  } catch (error) {
    logger.warn({ err: error }, 'could not count refused jumps');
    return 0;
  }
}

/** Counts something per actor per hour (alerts, A21.5, A31.4); returns the new count. */
export async function countHourly(name: string, actorId: string, member?: string): Promise<number> {
  try {
    await waitUntilReady();
    const key = `alert:${name}:${actorId}`;
    if (member) {
      await redis.sadd(key, member);
      await redis.expire(key, 3600, 'NX');
      return await redis.scard(key);
    }
    const total = await redis.incr(key);
    if (total === 1) await redis.expire(key, 3600);
    return total;
  } catch (error) {
    logger.warn({ err: error }, 'could not count for an alert');
    return 0;
  }
}
