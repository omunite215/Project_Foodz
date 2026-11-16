import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { admin, captcha, haveIBeenPwned, twoFactor } from 'better-auth/plugins';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '@/server/db/client';
import { actionEmail, sendEmail } from '@/server/notifications/email';
import { ac, roles } from './roles';

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : undefined;

export const auth = betterAuth({
  appName: 'Foodz',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.NEXT_PUBLIC_SITE_URL ? [process.env.NEXT_PUBLIC_SITE_URL] : [],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 30,
    async sendResetPassword({ user, url }) {
      await sendEmail({
        to: user.email,
        subject: 'Reset your Foodz password',
        ...actionEmail({
          heading: 'Reset your password',
          message:
            'Someone asked to reset the password for this account. The link works for 30 minutes. If it was not you, ignore this email.',
          action: 'Choose a new password',
          url,
        }),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    async sendVerificationEmail({ user, url }) {
      await sendEmail({
        to: user.email,
        subject: 'Confirm your email for Foodz',
        ...actionEmail({
          heading: 'Confirm your email',
          message: 'Confirm your address to start ordering. The link works for 24 hours.',
          action: 'Confirm email',
          url,
        }),
      });
    },
  },

  socialProviders: google ? { google } : {},
  account: {
    accountLinking: { enabled: true, trustedProviders: ['google'] },
  },

  user: {
    additionalFields: {
      phone: { type: 'string', required: false },
      termsAcceptedVersion: { type: 'number', required: false, input: false },
      isDemo: { type: 'boolean', required: false, input: false, defaultValue: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // Sensitive actions require a sign-in within the last 10 minutes.
    freshAge: 60 * 10,
    // Read the session from the database on every request so bans and role changes apply at once.
    cookieCache: { enabled: false },
  },

  // Rate limiting is done in front of the auth routes with the shared Redis limiter.
  rateLimit: { enabled: false },

  advanced: {
    cookiePrefix: 'foodz',
    useSecureCookies: process.env.NODE_ENV === 'production',
    database: { generateId: () => uuidv7() },
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
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
    twoFactor({ issuer: 'Foodz' }),
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        'This password has appeared in a data breach. Please choose a different one.',
    }),
    captcha({
      provider: 'cloudflare-turnstile',
      secretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
      endpoints: ['/sign-up/email', '/sign-in/email', '/request-password-reset'],
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
