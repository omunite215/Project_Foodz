/**
 * Errors that are safe to show to the person making the request. Anything else is logged and
 * replaced with a generic message, so internal details never reach the client.
 */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'DEMO_READ_ONLY'
  | 'TWO_FACTOR_REQUIRED'
  | 'REAUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'LIMIT_REACHED'
  | 'OUTSIDE_DELIVERY_AREA'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'UNAVAILABLE'
  // Sign-in and account flows.
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_SUSPENDED'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_FAILED'
  | 'CAPTCHA_UNAVAILABLE'
  | 'LINK_EXPIRED'
  | 'SIGN_IN_EXPIRED';

export interface AppErrorOptions {
  fieldErrors?: Record<string, string[]>;
  /** How long until the caller may try again (rate limits). */
  retryAfterSeconds?: number;
  /** Extra values the client needs to explain the error (numbers and enum values, never secrets). */
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly fieldErrors?: Record<string, string[]>;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status: number,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }

  /** The shape sent to the browser. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors && { fieldErrors: this.fieldErrors }),
      ...(this.retryAfterSeconds !== undefined && { retryAfterSeconds: this.retryAfterSeconds }),
      ...(this.details && { details: this.details }),
    };
  }
}

export const unauthenticated = () =>
  new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
export const forbidden = (message = 'You do not have access to this.') =>
  new AppError('FORBIDDEN', message, 403);
export const demoReadOnly = (message = "Demo accounts can't change this.") =>
  new AppError('DEMO_READ_ONLY', message, 403);
export const twoFactorRequired = () =>
  new AppError('TWO_FACTOR_REQUIRED', 'Set up two-factor sign-in to use staff tools.', 403);
export const reauthRequired = (details?: Record<string, unknown>) =>
  new AppError('REAUTH_REQUIRED', "Confirm it's you to continue.", 403, { details });
export const notFound = (what = 'That item') =>
  new AppError('NOT_FOUND', `${what} could not be found.`, 404);
export const conflict = (message: string) => new AppError('CONFLICT', message, 409);
export const limitReached = (message: string) => new AppError('LIMIT_REACHED', message, 409);
export const rateLimited = (
  message = 'Too many attempts. Please wait a moment and try again.',
  retryAfterSeconds?: number,
) => new AppError('RATE_LIMITED', message, 429, { retryAfterSeconds });
export const invalidInput = (message: string, fieldErrors?: Record<string, string[]>) =>
  new AppError('INVALID_INPUT', message, 422, { fieldErrors });
export const unavailable = (
  message = "This isn't available right now. Please try again in a minute.",
) => new AppError('UNAVAILABLE', message, 503);
