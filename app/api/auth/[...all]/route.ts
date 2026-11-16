import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';
import { authRequestAllowed } from '@/server/auth/guards';
import { AppError, forbidden } from '@/server/errors';
import { enforceRateLimit, type RateLimitPolicy } from '@/server/security/rate-limit';

const handlers = toNextJsHandler(auth);

function policyFor(pathname: string): RateLimitPolicy {
  if (pathname.endsWith('/sign-in/email')) return 'auth.sign-in';
  if (pathname.endsWith('/sign-up/email')) return 'auth.sign-up';
  if (pathname.includes('reset-password') || pathname.endsWith('/request-password-reset')) {
    return 'auth.password-reset';
  }
  return 'auth.default';
}

const errorResponse = (error: AppError) =>
  Response.json({ message: error.message }, { status: error.status });

async function guarded(request: Request, handler: (request: Request) => Promise<Response>) {
  const { pathname } = new URL(request.url);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  try {
    await enforceRateLimit(policyFor(pathname), `ip:${ip}`);
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);
    throw error;
  }

  // Writes and admin endpoints get the extra demo and two-factor rules (see guards.ts).
  if (request.method !== 'GET' || pathname.includes('/admin')) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!authRequestAllowed({ method: request.method, pathname, user: session?.user })) {
      return errorResponse(forbidden());
    }
  }
  return handler(request);
}

export const GET = (request: Request) => guarded(request, handlers.GET);
export const POST = (request: Request) => guarded(request, handlers.POST);
