import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';
import { clientIpOptInRefused, clientIpWarning } from './client-ip';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .default(false);

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('auto'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_PUBLIC_BUCKET: z.string().min(1),
    S3_PRIVATE_BUCKET: z.string().min(1),
    S3_PUBLIC_URL: z.url(),

    SMTP_URL: z.url(),
    EMAIL_FROM: z.string().min(3),

    PUSHER_APP_ID: z.string().min(1),
    PUSHER_SECRET: z.string().min(1),
    PUSHER_HOST: z.string().optional(),
    PUSHER_PORT: z.coerce.number().int().optional(),
    PUSHER_USE_TLS: bool,

    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),

    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Test-only: take the client address from X-Forwarded-For without a proxy (server/client-ip.ts).
    CLIENT_IP_FROM_HEADER: bool,
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    TURNSTILE_SECRET_KEY: z.string().min(1),

    STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),

    SENTRY_DSN: z.url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  },
  client: {
    NEXT_PUBLIC_SITE_URL: z.url(),
    NEXT_PUBLIC_PUSHER_KEY: z.string().min(1),
    NEXT_PUBLIC_PUSHER_HOST: z.string().optional(),
    NEXT_PUBLIC_PUSHER_PORT: z.coerce.number().int().optional(),
    NEXT_PUBLIC_PUSHER_USE_TLS: bool,
    NEXT_PUBLIC_PUSHER_CLUSTER: z.string().default('mt1'),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_PUSHER_KEY: process.env.NEXT_PUBLIC_PUSHER_KEY,
    NEXT_PUBLIC_PUSHER_HOST: process.env.NEXT_PUBLIC_PUSHER_HOST,
    NEXT_PUBLIC_PUSHER_PORT: process.env.NEXT_PUBLIC_PUSHER_PORT,
    NEXT_PUBLIC_PUSHER_USE_TLS: process.env.NEXT_PUBLIC_PUSHER_USE_TLS,
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  // Docker image builds run without secrets; the values are validated when the server starts.
  skipValidation: process.env.SKIP_ENV_VALIDATION === '1',
  emptyStringAsUndefined: true,
});

// Checked when the server starts (instrumentation.ts imports this file).
if (clientIpOptInRefused(process.env)) {
  throw new Error('CLIENT_IP_FROM_HEADER is for tests only and is refused on Vercel production.');
}
const ipWarning = clientIpWarning(process.env);
if (ipWarning) console.warn(ipWarning);
