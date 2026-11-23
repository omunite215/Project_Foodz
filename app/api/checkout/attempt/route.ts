import { getActor } from '@/server/auth/session';
import { AppError, forbidden, invalidInput, unauthenticated } from '@/server/errors';
import { attemptStatusInput } from '@/server/modules/orders/schema';
import { getAttemptStatus } from '@/server/modules/orders/service';
import { enforceRateLimit } from '@/server/security/rate-limit';

/*
 * What became of a press, by its attempt key (S7.3), for checkout's 15 s status panel. The same
 * check as `attemptStatusAction`, as a plain GET: Next runs a page's Server Actions one at a
 * time, so a check made as an action would wait behind the very press it is asking about.
 * Same rules as the action: signed in, the caller's own attempts only, the input checked by the
 * same schema, the same rate limit ('order.status'), and never cached.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    // Only this site's own pages ask (a cross-site page can't read the answer either way).
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin') throw forbidden();

    const actor = await getActor();
    if (actor.kind !== 'user') throw unauthenticated();
    await enforceRateLimit('order.status', `user:${actor.userId}`);

    const parsed = attemptStatusInput.safeParse({
      attemptKey: new URL(request.url).searchParams.get('key'),
    });
    if (!parsed.success) throw invalidInput('Invalid attempt key.');

    return Response.json(await getAttemptStatus(actor, parsed.data), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(error.toJSON(), { status: error.status, headers: NO_STORE });
    }
    throw error;
  }
}
