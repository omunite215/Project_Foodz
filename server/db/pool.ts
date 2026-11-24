/** Connections each server process may hold: DATABASE_POOL_MAX, or 10 (server/env.ts checks it). */
export function poolMax(value = process.env.DATABASE_POOL_MAX): number {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed >= 1 ? parsed : 10;
}

/**
 * How long a transaction waits for a pooled connection before giving up (Prisma P2028), and how
 * long one connection attempt may take before the pool drops it and frees its place.
 */
export const CONNECTION_WAIT_MS = 10_000;
