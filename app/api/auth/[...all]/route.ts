import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';
import { AppError } from '@/server/errors';
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

async function limited(request: Request, handler: (request: Request) => Promise<Response>) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  try {
    await enforceRateLimit(policyFor(new URL(request.url).pathname), `ip:${ip}`);
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
  return handler(request);
}

export const GET = (request: Request) => limited(request, handlers.GET);
export const POST = (request: Request) => limited(request, handlers.POST);
