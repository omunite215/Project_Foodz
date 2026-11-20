import 'server-only';
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { isRole, isStaff } from './roles';

export interface TwoFactorChallengeState {
  /** A sign-in is waiting for its code and has not timed out. */
  valid: boolean;
  /** "Don't ask again on this device" may be offered: customers and partners, never staff. */
  canTrustDevice: boolean;
  /** For the audit log only; never sent to the browser. */
  userId: string | null;
}

const none: TwoFactorChallengeState = { valid: false, canTrustDevice: false, userId: null };

/**
 * Reads the pending two-factor sign-in from its signed cookie, the same way the two-factor
 * plugin does. Server-only: callable through `auth.api`, never routed over HTTP.
 */
export const twoFactorChallenge = () =>
  ({
    id: 'two-factor-challenge',
    endpoints: {
      twoFactorChallenge: createAuthEndpoint.serverOnly({ method: 'GET' }, async (ctx) => {
        const cookie = ctx.context.createAuthCookie('two_factor');
        const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
        if (!identifier) return ctx.json(none);

        const pending = await ctx.context.internalAdapter.findVerificationValue(identifier);
        if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) return ctx.json(none);

        const user = await ctx.context.internalAdapter.findUserById(pending.value);
        if (!user) return ctx.json(none);
        const role: unknown = Reflect.get(user, 'role');
        return ctx.json({
          valid: true,
          canTrustDevice: !(isRole(role) && isStaff(role)),
          userId: user.id,
        } satisfies TwoFactorChallengeState);
      }),
    },
  }) satisfies BetterAuthPlugin;
