import 'server-only';
import { bind, prisma } from './client';
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

export async function runAs<T>(
  actor: Actor,
  work: (ctx: DbContext) => Promise<T>,
  options: RunOptions = {},
): Promise<T> {
  const { userId, role, isDemo } = settingsFor(actor);
  return prisma.$transaction(
    async (tx) => {
      // app.is_demo lets the database mask real people's details for shared demo logins.
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.role', ${role}, true), set_config('app.is_demo', ${isDemo}, true)`;
      const ctx: DbContext = Object.freeze({ actor });
      bind(ctx, tx);
      return work(ctx);
    },
    { isolationLevel: options.isolationLevel, timeout: options.timeoutMs ?? 10_000 },
  );
}

/** For webhooks and background jobs that act on behalf of the platform. */
export function runAsSystem<T>(
  reason: string,
  work: (ctx: DbContext) => Promise<T>,
  options?: RunOptions,
) {
  return runAs({ kind: 'system', reason }, work, options);
}
