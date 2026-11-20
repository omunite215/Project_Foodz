import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin, twoFactor } from 'better-auth/plugins';
import { after } from 'next/server';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '@/server/db/client';
import { logger } from '@/server/logger';
import { passwordWasReset, receivesAccountEmail } from '@/server/modules/account/identity';
import { currentTermsVersion } from '@/server/modules/content/service';
import { queueAccountEmail } from '@/server/modules/notifications/account-email';
import { twoFactorChallenge } from './challenge';
import { afterHook, beforeHook } from './hooks';
import { ac, roles } from './roles';

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : undefined;

/** Set by the /api/auth gateway and the sign-in flows from `clientIp()`; never by the client. */
export const CLIENT_IP_HEADER = 'x-foodz-client-ip';

/** Ways of starting a session that skip the password-and-code step. */
const SESSIONS_WITHOUT_SECOND_STEP = /^\/(callback\/|sign-in\/social$|verify-email$)/;

/**
 * Whether a confirm link is for a changed address (S3.6): the library names the new address as
 * `updateTo` in the link's token only then. The token was signed a moment ago by the library
 * itself; reading it only chooses the email's wording.
 */
function confirmsEmailChange(token: string): boolean {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    return (
      typeof payload === 'object' &&
      payload !== null &&
      typeof Reflect.get(payload, 'updateTo') === 'string'
    );
  } catch {
    return false;
  }
}

export const auth = betterAuth({
  appName: 'Foodz',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.NEXT_PUBLIC_SITE_URL ? [process.env.NEXT_PUBLIC_SITE_URL] : [],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  // Better Auth logs include email addresses on some paths; only errors are kept.
  logger: {
    level: 'error',
    log: (level, message, ...args) => {
      const err = args.find((arg): arg is Error => arg instanceof Error);
      logger[level]({ err }, `auth: ${message}`);
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // U1: signed in at once; the email must be confirmed before the first order (F4).
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 30,
    async sendResetPassword({ user, url }) {
      // Demo inboxes are shared; deleted accounts have none (S3.13, S6.5).
      if (!receivesAccountEmail(user)) return;
      await queueAccountEmail({ kind: 'reset-password', to: user.email, url });
    },
    async onPasswordReset({ user }) {
      await passwordWasReset(user);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // A confirm link opened in a signed-out browser signs it in (S3.2). A browser signed in to
    // another account stays as it is (hooks.ts).
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    async sendVerificationEmail({ user, url, token }) {
      if (!receivesAccountEmail(user)) return;
      await queueAccountEmail({
        kind: confirmsEmailChange(token) ? 'verify-new-email' : 'verify-email',
        to: user.email,
        url,
      });
    },
  },

  socialProviders: google ? { google } : {},
  account: {
    accountLinking: {
      enabled: true,
      // Google is linked to an existing account only when Google vouches for the email and the
      // account's own email is confirmed. An unconfirmed password account at the same address is
      // refused ("account_not_linked"), so a squatter never shares the owner's account (B5).
      trustedProviders: [],
      requireLocalEmailVerified: true,
      allowDifferentEmails: false,
    },
  },

  user: {
    additionalFields: {
      phone: { type: 'string', required: false, input: false },
      termsAcceptedVersion: { type: 'number', required: false, input: false },
      isDemo: { type: 'boolean', required: false, input: false, defaultValue: false },
      emailLinksValidAfter: { type: 'date', required: false, input: false, returned: false },
    },
    // Unconfirmed accounts may fix a mistyped address (S3.6); see hooks.ts and the change-email flow.
    changeEmail: { enabled: true },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // Sensitive actions require a sign-in within the last 10 minutes.
    freshAge: 60 * 10,
    // Read the session from the database on every request so bans and role changes apply at once.
    cookieCache: { enabled: false },
  },

  // Rate limiting is done in front of Better Auth with the shared Redis limiter.
  rateLimit: { enabled: false },

  hooks: { before: beforeHook, after: afterHook },

  databaseHooks: {
    user: {
      create: {
        // The Terms the person agreed to by signing up (S1.8).
        async before(user) {
          return { data: { ...user, termsAcceptedVersion: (await currentTermsVersion()) ?? 1 } };
        },
      },
    },
    session: {
      create: {
        // Accounts with two-factor sign in with their password and code every time, never only
        // through Google or an email link.
        async before(session, ctx) {
          if (!ctx?.path || !SESSIONS_WITHOUT_SECOND_STEP.test(ctx.path)) return;
          const user = await ctx.context.internalAdapter.findUserById(session.userId);
          if (user && Reflect.get(user, 'twoFactorEnabled') === true) {
            throw APIError.from('FORBIDDEN', {
              code: 'TWO_FACTOR_ACCOUNT',
              message: 'This account signs in with a password and a code.',
            });
          }
        },
      },
    },
  },

  advanced: {
    cookiePrefix: 'foodz',
    useSecureCookies: process.env.NODE_ENV === 'production',
    database: { generateId: () => uuidv7() },
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    // Emails are queued after the response, so a reset request for a real account takes as long
    // as one for an unknown address.
    backgroundTasks: {
      handler(promise) {
        try {
          after(promise);
        } catch {
          // Outside a request (scripts, tests) the task simply runs on.
        }
      },
    },
  },

  plugins: [
    admin({
      ac,
      roles,
      defaultRole: 'customer',
      adminRoles: ['admin'],
      bannedUserMessage:
        'This account is suspended. Contact support if you think this is a mistake.',
    }),
    twoFactor({
      issuer: 'Foodz',
      // "Too many wrong codes. Try again in 15 minutes."
      accountLockout: { maxFailedAttempts: 5, durationSeconds: 15 * 60 },
    }),
    twoFactorChallenge(),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
