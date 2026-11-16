/**
 * Errors that are safe to show to the person making the request. Anything else is logged and
 * replaced with a generic message, so internal details never reach the client.
 */
export class AppError extends Error {
  constructor(
    readonly code:
      | 'UNAUTHENTICATED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'INVALID_INPUT'
      | 'UNAVAILABLE',
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () =>
  new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
export const forbidden = () => new AppError('FORBIDDEN', 'You do not have access to this.', 403);
export const notFound = (what = 'That item') =>
  new AppError('NOT_FOUND', `${what} could not be found.`, 404);
export const conflict = (message: string) => new AppError('CONFLICT', message, 409);
export const rateLimited = () =>
  new AppError('RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', 429);
export const invalidInput = (message: string, fieldErrors?: Record<string, string[]>) =>
  new AppError('INVALID_INPUT', message, 422, fieldErrors);
