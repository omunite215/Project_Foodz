import 'server-only';
import { createSafeActionClient } from 'next-safe-action';
import { z } from 'zod';
import { getActor, requirePermission } from '@/server/auth/session';
import type { Permission } from '@/server/auth/roles';
import { AppError, unauthenticated } from '@/server/errors';
import { logger } from '@/server/logger';
import { requestInfo } from '@/server/request';
import { enforceRateLimit, type RateLimitPolicy } from '@/server/security/rate-limit';

const metadataSchema = z.object({
  name: z.string(),
  rateLimit: z.custom<RateLimitPolicy>().optional(),
  permission: z.custom<Permission>().optional(),
  /** Set false for permission-gated actions that only read data (demo accounts may run them). */
  write: z.boolean().optional(),
});

export interface ActionError {
  code: AppError['code'] | 'INTERNAL';
  message: string;
}

/**
 * Every Server Action goes through this client. Server Actions are public HTTP endpoints, so
 * each one is rate limited, validated against its input schema and logged; errors are reduced
 * to a safe message before they reach the browser.
 */
const base = createSafeActionClient<undefined, ActionError, typeof metadataSchema>({
  defineMetadataSchema: () => metadataSchema,
  handleServerError(error, { metadata }) {
    if (error instanceof AppError) return { code: error.code, message: error.message };
    logger.error({ err: error, action: metadata?.name }, 'action failed');
    return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
  },
}).use(async ({ next, metadata }) => {
  const request = await requestInfo();
  const started = performance.now();
  const result = await next({ ctx: { request } });
  logger.info(
    {
      action: metadata.name,
      requestId: request.requestId,
      ms: Math.round(performance.now() - started),
    },
    'action',
  );
  return result;
});

/** Anyone may call; limited per IP. */
export const publicAction = base.use(async ({ next, ctx, metadata }) => {
  await enforceRateLimit(metadata.rateLimit ?? 'action.default', `ip:${ctx.request.ip}`);
  return next({ ctx: { actor: await getActor() } });
});

/** Requires a signed-in user (and the permission, when the action declares one). */
export const userAction = base.use(async ({ next, metadata }) => {
  const actor = metadata.permission
    ? await requirePermission(metadata.permission, { write: metadata.write })
    : await getActor();
  if (actor.kind !== 'user') throw unauthenticated();
  await enforceRateLimit(metadata.rateLimit ?? 'action.default', `user:${actor.userId}`);
  return next({ ctx: { actor } });
});
