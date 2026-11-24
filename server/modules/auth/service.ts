import 'server-only';
import { isAPIError } from 'better-auth/api';
import { headers } from 'next/headers';
import {
  resetPasswordLanding,
  safeRedirectPath,
  signInLanding,
  verifyEmailLanding,
} from '@/lib/redirect';
import { auth, CLIENT_IP_HEADER } from '@/server/auth';
import { isRole, roleHome } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import { AppError, conflict, forbidden, invalidInput, rateLimited } from '@/server/errors';
import { logger } from '@/server/logger';
import {
  findEmailForReset,
  accountHome,
  notifyAccountExists,
  passwordChanged,
  prepareEmailChange,
  recordFailedSignIn,
  recordFailedTwoFactor,
  recordSignIn,
} from '@/server/modules/account/identity';
import { setWelcomeNotice } from '@/server/modules/account/notices';
import { emailKey, takeAttempt } from '@/server/security/rate-limit';
import { checkTurnstile, turnstileError } from '@/server/security/turnstile';
import {
  CAPTCHA_ACTIONS,
  type CaptchaAction,
  changeEmailInput,
  changePasswordInput,
  requestPasswordResetInput,
  resendVerificationInput,
  resetPasswordInput,
  type SignInResult,
  signInInput,
  type SignUpResult,
  signUpInput,
  type TwoFactorChallenge,
  twoFactorInput,
} from './schema';

/*
 * Every sign-in and account-security flow, behind Server Actions. Rate limits and Turnstile are
 * applied here, then Better Auth does the work; its errors become plain-language AppErrors.
 * The HTTP versions of these endpoints are closed (server/auth/guards.ts).
 */

/** The request a flow runs for: the client address and the headers (cookies) Better Auth reads. */
export interface FlowRequest {
  ip: string;
  headers: Headers;
}

const SUSPENDED = 'This account is suspended. Contact support if you think this is a mistake.';
const WRONG_DETAILS = "That email and password don't match. Try again, or reset your password.";
const TIMED_OUT = 'This sign-in timed out. Please start again.';
const LINK_EXPIRED = 'This link has expired or has already been used. We can send you a new one.';
const TWO_FACTOR_LOCK_SECONDS = 15 * 60;

const codeOf = (error: unknown) =>
  isAPIError(error)
    ? ((error.body as { code?: string } | undefined)?.code ?? undefined)
    : undefined;

const authHeaders = (request: FlowRequest) => {
  const forwarded = new Headers(request.headers);
  forwarded.set(CLIENT_IP_HEADER, request.ip);
  return forwarded;
};

const withReturnPath = (page: string, path: string) =>
  path === '/' ? page : `${page}?callbackUrl=${encodeURIComponent(path)}`;

const PASSWORD_CODES = new Set(['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG', 'PASSWORD_COMPROMISED']);

/** Better Auth's input errors as field errors on our forms. */
function inputError(error: unknown, passwordField: string): AppError | undefined {
  const code = codeOf(error);
  const fields: Record<string, Record<string, string[]>> = {
    PASSWORD_TOO_SHORT: { [passwordField]: ['Use at least 10 characters.'] },
    PASSWORD_TOO_LONG: { [passwordField]: ['Use 128 characters or fewer.'] },
    PASSWORD_COMPROMISED: {
      [passwordField]: [
        'This password has appeared in a data breach. Please choose a different one.',
      ],
    },
    INVALID_EMAIL: { email: ['Enter an email address like name@example.com.'] },
  };
  const fieldErrors = code ? fields[code] : undefined;
  return fieldErrors ? invalidInput('Check the highlighted fields.', fieldErrors) : undefined;
}

function unexpected(error: unknown, flow: string): never {
  if (error instanceof AppError) throw error;
  logger.error({ err: error, flow, errorCode: codeOf(error) }, 'auth flow failed');
  throw error;
}

async function requireTurnstile(
  token: string | undefined,
  check: { ip: string; action: CaptchaAction },
  refund: () => Promise<unknown>,
) {
  const result = await checkTurnstile(token, check);
  if (result === 'passed') return;
  await refund();
  throw turnstileError(result);
}

// ------------------------------------------------------------------ sign in (S2)

/**
 * Failed attempts are counted per email (5 a minute) and per network (20), then blocked for 5
 * minutes; successful sign-ins are refunded. Turnstile is asked for only once the email or the
 * network has failed recently (B7).
 */
export async function signIn(input: unknown, request: FlowRequest): Promise<SignInResult> {
  const { email, password, captchaToken, callbackUrl } = signInInput.parse(input);
  const byNetwork = await takeAttempt('auth.sign-in.ip', `ip:${request.ip}`);
  let byEmail;
  try {
    byEmail = await takeAttempt('auth.sign-in.email', emailKey(email));
  } catch (error) {
    await byNetwork.refund();
    throw error;
  }
  const refund = () => Promise.all([byNetwork.refund(), byEmail.refund()]);

  if (byEmail.consumed > 1 || byNetwork.consumed > 3) {
    await requireTurnstile(
      captchaToken,
      { ip: request.ip, action: CAPTCHA_ACTIONS.signIn },
      refund,
    );
  }

  const returnPath = safeRedirectPath(callbackUrl);
  try {
    const result = (await auth.api.signInEmail({
      body: { email, password },
      headers: authHeaders(request),
    })) as {
      twoFactorRedirect?: boolean;
      user?: {
        id: string;
        email: string;
        name: string;
        role?: string | null;
        isDemo?: boolean | null;
      };
    };
    await refund();
    if (result.twoFactorRedirect) {
      return {
        status: 'two-factor',
        redirectTo: withReturnPath('/sign-in/two-factor', returnPath),
      };
    }
    if (result.user) await recordSignIn(result.user, 'password');
    const role = result.user?.role;
    return {
      status: 'signed-in',
      redirectTo: signInLanding(returnPath, isRole(role) ? roleHome(role) : null),
    };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'INVALID_EMAIL_OR_PASSWORD') {
      await recordFailedSignIn(email, 'password');
      throw new AppError('INVALID_CREDENTIALS', WRONG_DETAILS, 401);
    }
    if (code === 'BANNED_USER') {
      await recordFailedSignIn(email, 'suspended');
      throw new AppError('ACCOUNT_SUSPENDED', SUSPENDED, 403);
    }
    await refund();
    throw inputError(error, 'password') ?? unexpected(error, 'sign-in');
  }
}

/**
 * For the code page (a Server Component): whether a sign-in is waiting for its code, and whether
 * "Don't ask again on this device" may be offered (never to staff).
 */
export async function getTwoFactorChallenge(): Promise<TwoFactorChallenge> {
  const { valid, canTrustDevice } = await auth.api.twoFactorChallenge({
    headers: new Headers(await headers()),
  });
  return { valid, canTrustDevice };
}

export async function verifyTwoFactor(input: unknown, request: FlowRequest) {
  const { method, code, trustDevice, callbackUrl } = twoFactorInput.parse(input);
  await takeAttempt('auth.two-factor', `ip:${request.ip}`);

  const forwarded = authHeaders(request);
  const challenge = await auth.api.twoFactorChallenge({ headers: forwarded });
  if (!challenge.valid) throw new AppError('SIGN_IN_EXPIRED', TIMED_OUT, 401);

  // Staff are asked for a code at every sign-in (S2.9, admin section).
  const body = { code, trustDevice: trustDevice && challenge.canTrustDevice };
  try {
    const result =
      method === 'totp'
        ? await auth.api.verifyTOTP({ body, headers: forwarded })
        : await auth.api.verifyBackupCode({ body, headers: forwarded });
    const user = (result as { user?: { id: string; email: string; name: string } }).user;
    if (user) await recordSignIn(user, 'two-factor');
    const returnPath = safeRedirectPath(callbackUrl);
    // Nowhere asked for: staff land on their tools, partners on the app (F5 A1.1, F6 P7.3).
    // Only then is the role read.
    const home = returnPath === '/' ? await accountHome(user?.id ?? challenge.userId) : null;
    return { redirectTo: signInLanding(returnPath, home) };
  } catch (error) {
    switch (codeOf(error)) {
      case 'INVALID_CODE':
      case 'INVALID_BACKUP_CODE':
        await recordFailedTwoFactor(challenge.userId);
        throw invalidInput('Check the highlighted fields.', {
          code: [
            method === 'totp'
              ? "That code didn't work. Check your app and try again."
              : "That backup code didn't work. Each code works once.",
          ],
        });
      case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
        throw new AppError('SIGN_IN_EXPIRED', 'Too many wrong codes. Please sign in again.', 401);
      case 'INVALID_TWO_FACTOR_COOKIE':
        throw new AppError('SIGN_IN_EXPIRED', TIMED_OUT, 401);
      case 'ACCOUNT_TEMPORARILY_LOCKED':
        throw rateLimited(
          'Too many wrong codes. Try again in 15 minutes.',
          TWO_FACTOR_LOCK_SECONDS,
        );
      default:
        return unexpected(error, 'two-factor');
    }
  }
}

// ------------------------------------------------------------------ sign up (S1)

/**
 * Turnstile is always required. Accepted attempts count (3 per 10 minutes per network);
 * rejected passwords and bad input do not (S1.7). A taken email answers like a new account,
 * without signing in, and its owner is told (S1.5).
 */
export async function signUp(input: unknown, request: FlowRequest): Promise<SignUpResult> {
  const { name, email, password, captchaToken, callbackUrl } = signUpInput.parse(input);
  const attempt = await takeAttempt('auth.sign-up', `ip:${request.ip}`);
  await requireTurnstile(captchaToken, { ip: request.ip, action: CAPTCHA_ACTIONS.signUp }, () =>
    attempt.refund(),
  );

  const redirectTo = safeRedirectPath(callbackUrl);
  try {
    await auth.api.signUpEmail({
      body: { name, email, password, callbackURL: verifyEmailLanding(redirectTo) },
      headers: authHeaders(request),
    });
    await setWelcomeNotice();
    return { signedIn: true, email, redirectTo };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || code === 'USER_ALREADY_EXISTS') {
      await notifyAccountExists(email);
      return { signedIn: false, email, redirectTo };
    }
    if ((code && PASSWORD_CODES.has(code)) || code === 'INVALID_EMAIL') await attempt.refund();
    throw inputError(error, 'password') ?? unexpected(error, 'sign-up');
  }
}

// ------------------------------------------------------------------ password reset (S3.8 to S3.13)

/** Always the same answer; unknown, demo and deleted addresses get no email. */
export async function requestPasswordReset(input: unknown, request: FlowRequest) {
  const { email, captchaToken, callbackUrl } = requestPasswordResetInput.parse(input);
  const byNetwork = await takeAttempt('auth.password-reset.ip', `ip:${request.ip}`);
  const byEmail = await takeAttempt('auth.password-reset.email', emailKey(email)).catch(
    async (error: unknown) => {
      await byNetwork.refund();
      throw error;
    },
  );
  await requireTurnstile(captchaToken, { ip: request.ip, action: CAPTCHA_ACTIONS.reset }, () =>
    Promise.all([byNetwork.refund(), byEmail.refund()]),
  );

  await auth.api.requestPasswordReset({
    body: { email, redirectTo: resetPasswordLanding(callbackUrl) },
    headers: authHeaders(request),
  });
  return { email };
}

/**
 * After a reset every session of the account is gone (`revokeSessionsOnPasswordReset`), but a
 * browser that held one still has its cookie, so the page it lands on would still show the old
 * session's header and welcome until the next request. Reading the session here finds it gone
 * and clears that cookie in this response (S3.11). A browser signed in to another account keeps
 * its own session. The cookie cache is off (server/auth), and is skipped here in any case.
 */
async function clearEndedSession(request: FlowRequest) {
  try {
    await auth.api.getSession({
      headers: authHeaders(request),
      query: { disableCookieCache: true },
    });
  } catch (error) {
    // The password is changed either way; the next request finds the session gone.
    logger.warn({ err: error }, 'session not re-read after a reset');
  }
}

/**
 * Sets the new password, signs out every device (this browser included), confirms the email and
 * sends "Your Foodz password was changed". Returns the account email for the sign-in page (S3.11).
 */
export async function resetPassword(input: unknown, request: FlowRequest) {
  const { token, newPassword } = resetPasswordInput.parse(input);
  const attempt = await takeAttempt('auth.reset-password', `ip:${request.ip}`);
  const email = await findEmailForReset(token);
  try {
    await auth.api.resetPassword({ body: { token, newPassword }, headers: authHeaders(request) });
  } catch (error) {
    const code = codeOf(error);
    if (code === 'INVALID_TOKEN' || code === 'USER_NOT_FOUND') {
      throw new AppError('LINK_EXPIRED', LINK_EXPIRED, 400);
    }
    if (code && PASSWORD_CODES.has(code)) await attempt.refund();
    throw inputError(error, 'newPassword') ?? unexpected(error, 'reset-password');
  }
  await clearEndedSession(request);
  if (!email) throw new AppError('LINK_EXPIRED', LINK_EXPIRED, 400);
  return { email };
}

// ------------------------------------------------------------------ signed-in flows (S3, S5)

interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role?: string | null;
  isDemo?: boolean | null;
}

async function sessionUser(request: FlowRequest): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
  const user: SessionUser = session.user;
  return user;
}

/** Another confirm link: 1 a minute and 5 an hour; earlier links keep working (S3.4). */
export async function resendVerification(actor: UserActor, input: unknown, request: FlowRequest) {
  const { callbackUrl } = resendVerificationInput.parse(input);
  const user = await sessionUser(request);
  if (user.emailVerified || actor.isDemo) throw conflict('Your email is already confirmed.');

  await takeAttempt('auth.verify-email.cooldown', `user:${actor.userId}`);
  await takeAttempt('auth.verify-email', `user:${actor.userId}`);
  try {
    await auth.api.sendVerificationEmail({
      body: { email: user.email, callbackURL: verifyEmailLanding(callbackUrl) },
      headers: authHeaders(request),
    });
  } catch (error) {
    if (codeOf(error) === 'EMAIL_ALREADY_VERIFIED')
      throw conflict('Your email is already confirmed.');
    return unexpected(error, 'resend-verification');
  }
  return { sent: true as const };
}

/**
 * Fixing a mistyped, unconfirmed address (S3.6): the link goes to the new address and the
 * change happens when it is clicked. Confirmed addresses change in a later feature (S8.4).
 */
export async function changeEmail(actor: UserActor, input: unknown, request: FlowRequest) {
  const { newEmail, callbackUrl } = changeEmailInput.parse(input);
  const user = await sessionUser(request);
  if (user.emailVerified) throw forbidden("Changing a confirmed email isn't available yet.");
  if (newEmail === user.email) {
    throw invalidInput('Check the highlighted fields.', {
      newEmail: ["That's already your email."],
    });
  }

  await takeAttempt('auth.change-email', `user:${actor.userId}`);
  await prepareEmailChange(actor.userId, newEmail);
  try {
    await auth.api.changeEmail({
      body: { newEmail, callbackURL: verifyEmailLanding(callbackUrl) },
      headers: authHeaders(request),
    });
  } catch (error) {
    return unexpected(error, 'change-email');
  }
  return { email: newEmail };
}

/** Wrong current passwords are limited (5 per 15 minutes); other devices are signed out (S5.4). */
export async function changePassword(actor: UserActor, input: unknown, request: FlowRequest) {
  const { currentPassword, newPassword } = changePasswordInput.parse(input);
  const user = await sessionUser(request);
  const attempt = await takeAttempt('auth.change-password', `user:${actor.userId}`);
  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: authHeaders(request),
    });
  } catch (error) {
    const code = codeOf(error);
    if (code === 'INVALID_PASSWORD') {
      throw invalidInput('Check the highlighted fields.', {
        currentPassword: ["Your current password isn't right."],
      });
    }
    await attempt.refund();
    if (code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') {
      throw conflict('You sign in with Google. Use "Set a password" to get a link instead.');
    }
    throw inputError(error, 'newPassword') ?? unexpected(error, 'change-password');
  }
  await attempt.refund();
  await passwordChanged(user);
  return { changed: true as const };
}

/** This device only (S5.8). */
export async function signOut(request: FlowRequest) {
  await auth.api.signOut({ headers: authHeaders(request) });
  return { signedOut: true as const };
}
