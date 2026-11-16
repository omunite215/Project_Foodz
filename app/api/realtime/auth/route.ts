import { z } from 'zod';
import { getActor, getSession } from '@/server/auth/session';
import { AppError, forbidden, invalidInput, unauthenticated } from '@/server/errors';
import { canSubscribe } from '@/server/modules/realtime/service';
import { signSubscription } from '@/server/realtime/pusher';
import { isSameOrigin } from '@/server/security/origin';
import { enforceRateLimit } from '@/server/security/rate-limit';

// pusher-js posts these as a form when the browser subscribes to a private channel.
const subscriptionRequest = z
  .object({
    socket_id: z.string().regex(/^\d{1,20}\.\d{1,20}$/),
    channel_name: z.string().min(1).max(200),
  })
  .strict();

const errorResponse = (error: AppError) =>
  Response.json({ message: error.message }, { status: error.status });

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) throw forbidden();

    const actor = await getActor();
    if (actor.kind !== 'user') throw unauthenticated();
    await enforceRateLimit('realtime.auth', `user:${actor.userId}`);

    const parsed = subscriptionRequest.safeParse(
      Object.fromEntries(new URLSearchParams(await request.text())),
    );
    if (!parsed.success) throw invalidInput('Invalid subscription request.');
    const { socket_id: socketId, channel_name: channel } = parsed.data;

    const session = await getSession();
    const allowed = await canSubscribe(
      {
        userId: actor.userId,
        role: actor.role,
        isDemo: actor.isDemo,
        twoFactorEnabled: Boolean(session?.user.twoFactorEnabled),
      },
      channel,
    );
    if (!allowed) throw forbidden();

    return Response.json(signSubscription(socketId, channel));
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);
    throw error;
  }
}
