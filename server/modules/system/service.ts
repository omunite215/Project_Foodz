import 'server-only';
import { runAs } from '@/server/db/context';
import { logger } from '@/server/logger';
import { redis } from '@/server/redis';
import { pingDatabase } from './repo';

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

export async function checkHealth(): Promise<boolean> {
  try {
    await withTimeout(
      Promise.all([runAs({ kind: 'anonymous' }, pingDatabase), redis.ping()]),
      2000,
    );
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'health check failed');
    return false;
  }
}
