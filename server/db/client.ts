import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import { oneAtATime } from './one-at-a-time';
import { CONNECTION_WAIT_MS, poolMax } from './pool';
import type { DbContext } from './types';

/**
 * A transaction holds one connection, and a connection runs one query at a time. Prisma itself
 * sends some reads as several queries at once (relations it loads with separate queries), which
 * pg would queue on the connection, a fallback pg has deprecated. Queries on a transaction wait
 * their turn here instead, in the order they were sent.
 */
class PrismaPgOneQueryAtATime extends PrismaPg {
  override async connect() {
    const adapter = await super.connect();
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel) => {
      const tx = await start(isolationLevel);
      const inTurn = oneAtATime();
      const queryRaw = tx.queryRaw.bind(tx);
      const executeRaw = tx.executeRaw.bind(tx);
      tx.queryRaw = (query) => inTurn(() => queryRaw(query));
      tx.executeRaw = (query) => inTurn(() => executeRaw(query));
      return tx;
    };
    return adapter;
  }
}

function createClient() {
  const adapter = new PrismaPgOneQueryAtATime({
    connectionString: process.env.DATABASE_URL,
    max: poolMax(),
    // Without a limit, an attempt that never completes keeps its place in the pool for good.
    connectionTimeoutMillis: CONNECTION_WAIT_MS,
  });
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
