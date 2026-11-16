import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import type { DbContext } from './types';

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

declare global {
  var foodzPrisma: PrismaClient | undefined;
}

// One client per process; reused across hot reloads in development.
export const prisma = globalThis.foodzPrisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalThis.foodzPrisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const handles = new WeakMap<DbContext, Tx>();

/** Binds a transaction to an opaque context. Only the context module calls this. */
export function bind(ctx: DbContext, tx: Tx) {
  handles.set(ctx, tx);
}

/** Repositories call this to reach the transaction behind a context. */
export function db(ctx: DbContext): Tx {
  const tx = handles.get(ctx);
  if (!tx) throw new Error('Database context is not active');
  return tx;
}
