import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '@/server/logger';
import { bind, prisma } from './client';
import { CONNECTION_WAIT_MS } from './pool';
import type { Actor, DbContext } from './types';

export type { Actor, DbContext } from './types';

function settingsFor(actor: Actor) {
  switch (actor.kind) {
    case 'user':
      return { userId: actor.userId, role: actor.role, isDemo: actor.isDemo ? 'true' : 'false' };
    case 'system':
      return { userId: '', role: 'system', isDemo: 'false' };
    default:
      return { userId: '', role: 'anonymous', isDemo: 'false' };
  }
}

interface RunOptions {
  /** Postgres isolation level; defaults to the database default (read committed). */
  isolationLevel?: 'Serializable' | 'RepeatableRead' | 'ReadCommitted';
  timeoutMs?: number;
}

/** Present, and open, for code running inside a runAs transaction. */
const current = new AsyncLocalStorage<{ open: boolean }>();

/**
 * A transaction started inside another one waits for a second pooled connection while the first
 * keeps its own. With enough requests doing that at once, every connection waits for another
 * and no transaction can start. Pass the context down instead.
 */
function refuseNested() {
  if (!current.getStore()?.open) return;
  const error = new Error('runAs was called inside another runAs transaction');
  if (process.env.NODE_ENV === 'production') logger.error({ err: error }, 'nested transaction');
  else throw error;
}

export async function runAs<T>(
  actor: Actor,
  work: (ctx: DbContext) => Promise<T>,
  options: RunOptions = {},
): Promise<T> {
  refuseNested();
  const { userId, role, isDemo } = settingsFor(actor);
  const scope = { open: true };
  try {
    return await current.run(scope, () =>
      prisma.$transaction(
        async (tx) => {
          // app.is_demo lets the database mask real people's details for shared demo logins.
          await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.role', ${role}, true), set_config('app.is_demo', ${isDemo}, true)`;
          const ctx: DbContext = Object.freeze({ actor });
          bind(ctx, tx);
          return work(ctx);
        },
        {
          isolationLevel: options.isolationLevel,
          timeout: options.timeoutMs ?? 10_000,
          maxWait: CONNECTION_WAIT_MS,
        },
      ),
    );
  } finally {
    // Work the transaction left running (a queued job, say) may open its own later.
    scope.open = false;
  }
}

/** For webhooks and background jobs that act on behalf of the platform. */
export function runAsSystem<T>(
  reason: string,
  work: (ctx: DbContext) => Promise<T>,
  options?: RunOptions,
) {
  return runAs({ kind: 'system', reason }, work, options);
}
