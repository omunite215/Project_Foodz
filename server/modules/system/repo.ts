import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

export async function pingDatabase(ctx: DbContext) {
  await db(ctx).$queryRaw`SELECT 1`;
}
