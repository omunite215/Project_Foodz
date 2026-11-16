import { z } from 'zod';
import { nameSchema } from '@/server/modules/account/schema';

export const EMAIL_ERROR = 'Enter an email address like name@example.com.';
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** "Maya@Example.com " is the same address as "maya@example.com" (S1.4). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, EMAIL_ERROR)
  .pipe(z.email(EMAIL_ERROR));

/** A new password: 10 to 128 characters of any kind, no composition rules (S1.3). */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, 'Use at least 10 characters.')
  .max(PASSWORD_MAX, 'Use 128 characters or fewer.');

/** A password being checked, not chosen: any length the library accepts. */
const currentPasswordSchema = z
  .string()
  .min(1, 'Enter your password.')
  .max(PASSWORD_MAX, "That email and password don't match.");

/** The Turnstile token from the widget, when one was shown. */
const captchaToken = z.string().max(4096).optional();

/** Where to go afterwards; cleaned by safeRedirectPath() on the server. */
const callbackUrl = z.string().max(512).optional();

export const signInInput = z
  .object({ email: emailSchema, password: currentPasswordSchema, captchaToken, callbackUrl })
  .strict();

export const signUpInput = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: newPasswordSchema,
    captchaToken,
    callbackUrl,
  })
  .strict();

export const TWO_FACTOR_METHODS = ['totp', 'backup'] as const;

export const twoFactorInput = z
  .object({
    method: z.enum(TWO_FACTOR_METHODS),
    code: z.string().max(64),
    trustDevice: z.boolean().default(false),
    callbackUrl,
  })
  .strict()
  .transform((value) => ({
    ...value,
    // "123 456" and "123-456" are accepted (S2.9).
    code: value.method === 'totp' ? value.code.replace(/[\s-]/g, '') : value.code.trim(),
  }))
  .superRefine((value, ctx) => {
    if (value.method === 'totp' && !/^\d{6}$/.test(value.code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Enter the 6 digits from your app.',
      });
    }
    if (value.method === 'backup' && !/^[A-Za-z0-9-]{4,32}$/.test(value.code)) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'Enter one of your backup codes.' });
    }
  });

export const requestPasswordResetInput = z
  .object({ email: emailSchema, captchaToken, callbackUrl })
  .strict();

export const resetPasswordInput = z
  .object({ token: z.string().min(1).max(256), newPassword: newPasswordSchema })
  .strict();

export const resendVerificationInput = z.object({ callbackUrl }).strict();

export const changeEmailInput = z.object({ newEmail: emailSchema, callbackUrl }).strict();

export const changePasswordInput = z
  .object({ currentPassword: currentPasswordSchema, newPassword: newPasswordSchema })
  .strict();

// ------------------------------------------------------------------ results

export type SignInResult =
  | { status: 'signed-in'; redirectTo: string }
  /** Password right; the code step comes next (`/sign-in/two-factor?callbackUrl=…`). */
  | { status: 'two-factor'; redirectTo: string };

export interface SignUpResult {
  /** False when the email already had an account: show the same notice, not signed in (S1.5). */
  signedIn: boolean;
  email: string;
  redirectTo: string;
}

export interface TwoFactorChallenge {
  valid: boolean;
  canTrustDevice: boolean;
}
