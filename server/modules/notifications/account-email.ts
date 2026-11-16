import 'server-only';
import { z } from 'zod';
import { accountEmailRequested, inngest } from '@/server/jobs/client';
import { logger } from '@/server/logger';
import { actionEmail, type Email, noticeEmail, sendEmail } from '@/server/notifications/email';
import { decryptField, encryptField } from '@/server/security/field-encryption';

/*
 * Account emails: confirm, reset, password changed, account deleted, and "someone tried to sign
 * up with your email". They cannot be switched off (S8.3).
 *
 * They go out from a background job with retries, like other notifications, so a slow mail
 * server never holds up a sign-up and a reset request for a real account takes as long as one
 * for an unknown address. The job payload is encrypted: it carries an address and, for most
 * kinds, a sign-in-grade link, and job logs are kept by the job service.
 */

const ENCRYPTION_CONTEXT = 'jobs:account-email';

export const accountEmailSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verify-email'), to: z.email(), name: z.string(), url: z.url() }),
  z.object({ kind: z.literal('reset-password'), to: z.email(), name: z.string(), url: z.url() }),
  z.object({ kind: z.literal('password-changed'), to: z.email(), name: z.string() }),
  z.object({ kind: z.literal('account-exists'), to: z.email() }),
  z.object({ kind: z.literal('account-deleted'), to: z.email(), name: z.string() }),
]);

export type AccountEmail = z.infer<typeof accountEmailSchema>;

const siteUrl = (path: string) =>
  new URL(path, process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3456').toString();

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

/** The finished email for each kind. Exported for tests and previews. */
export function renderAccountEmail(message: AccountEmail): Email {
  switch (message.kind) {
    case 'verify-email':
      return {
        to: message.to,
        subject: 'Confirm your email for Foodz',
        ...actionEmail({
          heading: 'Confirm your email',
          message: `Hi ${firstName(message.name)}, confirm this address so you can place your first order. The link works for 24 hours.`,
          action: 'Confirm email',
          url: message.url,
          footer: ["If you didn't create a Foodz account, you can ignore this email."],
        }),
      };
    case 'reset-password':
      return {
        to: message.to,
        subject: 'Reset your Foodz password',
        ...actionEmail({
          heading: 'Reset your password',
          message:
            'We got a request to reset the password for your Foodz account. The link works for 30 minutes and only once.',
          action: 'Choose a new password',
          url: message.url,
          footer: ["If you didn't ask for this, ignore this email. Your password stays the same."],
        }),
      };
    case 'password-changed':
      return {
        to: message.to,
        subject: 'Your Foodz password was changed',
        ...actionEmail({
          heading: 'Your password was changed',
          message: `Hi ${firstName(message.name)}, the password for your Foodz account was just changed. If this wasn't you, reset it now and contact us.`,
          action: 'Reset your password',
          url: siteUrl('/forgot-password'),
          footer: [`Contact us: ${siteUrl('/contact')}`],
        }),
      };
    case 'account-exists':
      return {
        to: message.to,
        subject: 'Someone tried to sign up with your email',
        ...actionEmail({
          heading: 'Someone tried to use your email',
          message:
            'Someone tried to create a Foodz account with this address. If it was you, sign in or reset your password.',
          action: 'Sign in to Foodz',
          url: siteUrl('/sign-in'),
          footer: [
            `Forgot your password? ${siteUrl('/forgot-password')}`,
            "If it wasn't you, you don't need to do anything. Your account is safe.",
          ],
        }),
      };
    default:
      // account-deleted
      return {
        to: message.to,
        subject: 'Your Foodz account has been deleted',
        ...noticeEmail({
          heading: 'Your account has been deleted',
          message: `Hi ${firstName(message.name)}, your Foodz account and its personal details have been deleted. Past orders are kept without your name or contact details, for our accounting records.`,
          footer: [`If you didn't do this, contact us: ${siteUrl('/contact')}`],
        }),
      };
  }
}

export function sealAccountEmail(message: AccountEmail) {
  return encryptField(JSON.stringify(accountEmailSchema.parse(message)), ENCRYPTION_CONTEXT);
}

export function unsealAccountEmail(sealed: string): AccountEmail {
  return accountEmailSchema.parse(JSON.parse(decryptField(sealed, ENCRYPTION_CONTEXT)));
}

/**
 * Queues an account email. Never throws: a failure to queue is logged, and the person can ask
 * again (resend, reset) from the same screen.
 */
export async function queueAccountEmail(message: AccountEmail): Promise<void> {
  try {
    await inngest.send(
      accountEmailRequested.create(
        { sealed: sealAccountEmail(message) },
        { id: `account-email-${crypto.randomUUID()}` },
      ),
    );
  } catch (error) {
    logger.error({ err: error, kind: message.kind }, 'could not queue account email');
  }
}

/** Run by the background job. */
export async function deliverAccountEmail(sealed: string): Promise<'sent'> {
  await sendEmail(renderAccountEmail(unsealAccountEmail(sealed)));
  return 'sent';
}
