import 'server-only';
import { AppError, demoReadOnly, forbidden } from '@/server/errors';
import { clientIp } from '@/server/request';
import { enforceRateLimit } from '@/server/security/rate-limit';
import { auth, CLIENT_IP_HEADER } from './index';
import { authPath, authRequestDecision } from './guards';

type Handler = (request: Request) => Promise<Response>;

const NO_STORE = { 'cache-control': 'no-store' };

function errorResponse(error: AppError) {
  return Response.json(error.toJSON(), {
    status: error.status,
    headers: {
      ...NO_STORE,
      ...(error.retryAfterSeconds !== undefined && {
        'retry-after': String(error.retryAfterSeconds),
      }),
    },
  });
}

const notFound = () =>
  Response.json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404, headers: NO_STORE });

// Endpoints that never depend on who is signed in.
const SESSIONLESS = new Set(['/get-session', '/ok', '/error']);

/**
 * In front of every /api/auth request: a rate limit per client address (the session read has
 * its own, larger budget so the header never flips to "Sign in", S2.1), the endpoint allowlist
 * and demo rules from guards.ts, and the client address Better Auth records, taken from
 * `clientIp()` rather than from whatever the client sent.
 */
export async function handleAuthRequest(request: Request, handler: Handler): Promise<Response> {
  const url = new URL(request.url);
  const path = authPath(url.pathname);
  const ip = clientIp(request.headers);

  try {
    await enforceRateLimit(path === '/get-session' ? 'auth.session' : 'auth.default', `ip:${ip}`);
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);
    throw error;
  }

  const session = SESSIONLESS.has(path)
    ? null
    : await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
  switch (
    authRequestDecision({ method: request.method, pathname: url.pathname, user: session?.user })
  ) {
    case 'not-found':
      return notFound();
    case 'forbidden':
      return errorResponse(forbidden());
    case 'demo-read-only':
      return errorResponse(demoReadOnly());
    case 'allow':
      break;
  }

  const headers = new Headers(request.headers);
  headers.set(CLIENT_IP_HEADER, ip);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return handler(
    new Request(request.url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
    }),
  );
}
