/** Connections each server process may hold: DATABASE_POOL_MAX, or 10 (server/env.ts checks it). */
export function poolMax(value = process.env.DATABASE_POOL_MAX): number {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed >= 1 ? parsed : 10;
}
