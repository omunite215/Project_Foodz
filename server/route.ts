import 'server-only';
import { ZodError } from 'zod';
import { isStaff, type Permission } from '@/server/auth/roles';
import { getActor, getSession, requirePermission, type UserActor } from '@/server/auth/session';
import { AppError, forbidden, unauthenticated } from '@/server/errors';
import { logger } from '@/server/logger';
import { enforceRateLimit, type RateLimitPolicy } from '@/server/security/rate-limit';
import { isSameOrigin } from '@/server/security/origin';

/*
 * The wrapper every partner REST route goes through (F6 contract §0): same-origin check on
 * writes, the session (banned accounts resolve to signed out), staff refused, the rate limit,
 * the JSON body (16 KB at most), then the handler. Errors leave as the same object Server
 * Actions answer, with Retry-After on 429; every answer is `no-store`.
 */

export const MAX_BODY_BYTES = 16 * 1024;

export interface RouteContext {
  actor: UserActor;
  /** The caller's session: the one that goes online owns the location (B9). */
  sessionId: string | null;
  body: unknown;
  /** The dynamic segments of the route (`[offerId]`), checked by the handler's own schema. */
  params: Record<string, string>;
  /** The query string, checked by the handler's own schema. */
  query: Record<string, string>;
}

/** What Next passes a route handler as its second argument (params is a promise in Next 16). */
interface HandlerContext {
  params?: Promise<Record<string, string | string[] | undefined>>;
}

async function readParams(context: HandlerContext | undefined): Promise<Record<string, string>> {
  const raw = (await context?.params) ?? {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
}

const NO_STORE = { 'cache-control': 'no-store' } as const;

function errorResponse(error: AppError) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (error.retryAfterSeconds !== undefined)
    headers['retry-after'] = String(error.retryAfterSeconds);
  return Response.json(error.toJSON(), { status: error.status, headers });
}

const STAFF_REFUSAL = () =>
  new AppError('NOT_A_CUSTOMER', "Staff accounts can't use the partner app.", 403);

const tooLarge = () => new AppError('INVALID_INPUT', 'That request is too large.', 413);

/** Reads chunks until the end, or stops (null) once they pass the cap. */
async function collect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: Uint8Array[],
  size: number,
): Promise<number | null> {
  const { done, value } = await reader.read();
  if (done) return size;
  const total = size + value.byteLength;
  if (total > MAX_BODY_BYTES) {
    await reader.cancel();
    return null;
  }
  chunks.push(value);
  return collect(reader, chunks, total);
}

/**
 * The JSON body, read with a cap (security gate S2): a declared length over 16 KB is refused
 * before anything is read, and a body without one stops being read once it passes the cap.
 */
async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return {};
  const chunks: Uint8Array[] = [];
  if ((await collect(request.body.getReader(), chunks, 0)) === null) throw tooLarge();
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('INVALID_INPUT', 'That request could not be read.', 400);
  }
}

export function partnerRoute<T>(options: {
  name: string;
  rateLimit: RateLimitPolicy;
  /** Count the limit per session instead of per account (the shared demo partner's practice). */
  rateLimitBy?: 'session';
  handler: (context: RouteContext) => Promise<T>;
}) {
  return async function handle(request: Request, context?: HandlerContext): Promise<Response> {
    const started = performance.now();
    try {
      if (request.method !== 'GET' && !isSameOrigin(request)) throw forbidden();
      const actor = await getActor();
      if (actor.kind !== 'user') throw unauthenticated();
      if (isStaff(actor.role)) throw STAFF_REFUSAL();
      const session = await getSession();
      const sessionId = session && session.user.id === actor.userId ? session.session.id : null;
      await enforceRateLimit(
        options.rateLimit,
        options.rateLimitBy === 'session' && sessionId
          ? `session:${sessionId}`
          : `user:${actor.userId}`,
      );
      const body = await readBody(request);
      const result = await options.handler({
        actor,
        sessionId,
        body,
        params: await readParams(context),
        query: Object.fromEntries(new URL(request.url).searchParams),
      });
      return Response.json(result, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof AppError) return errorResponse(error);
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const key = issue.path.join('.') || 'body';
          (fieldErrors[key] ??= []).push(issue.message);
        }
        return errorResponse(
          new AppError('INVALID_INPUT', 'Check the request.', 422, { fieldErrors }),
        );
      }
      logger.error({ err: error, route: options.name }, 'route failed');
      return Response.json(
        { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
        { status: 500, headers: NO_STORE },
      );
    } finally {
      logger.info({ route: options.name, ms: Math.round(performance.now() - started) }, 'route');
    }
  };
}

/**
 * The wrapper for staff file downloads (F9 A64: the payouts CSVs). POST only, so a download that
 * writes an audit entry and spends a limit can't be triggered by a link from another site;
 * same-origin; the permission with two-factor (the demo admin may read); the rate limit; the
 * capped JSON body. The handler returns the file response; errors leave as JSON.
 */
export function staffRoute(options: {
  name: string;
  rateLimit: RateLimitPolicy;
  permission: Permission;
  handler: (context: {
    actor: UserActor;
    body: unknown;
    params: Record<string, string>;
  }) => Promise<Response>;
}) {
  return async function handle(request: Request, context?: HandlerContext): Promise<Response> {
    const started = performance.now();
    try {
      if (request.method !== 'POST') {
        return Response.json(
          { code: 'INVALID_INPUT', message: 'Use POST.' },
          { status: 405, headers: { ...NO_STORE, allow: 'POST' } },
        );
      }
      if (!isSameOrigin(request)) throw forbidden();
      const actor = await requirePermission(options.permission, { write: false });
      if (!isStaff(actor.role)) throw forbidden();
      await enforceRateLimit(options.rateLimit, `user:${actor.userId}`);
      const body = await readBody(request);
      return await options.handler({ actor, body, params: await readParams(context) });
    } catch (error) {
      if (error instanceof AppError) return errorResponse(error);
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const key = issue.path.join('.') || 'body';
          (fieldErrors[key] ??= []).push(issue.message);
        }
        return errorResponse(
          new AppError('INVALID_INPUT', 'Check the request.', 422, { fieldErrors }),
        );
      }
      logger.error({ err: error, route: options.name }, 'route failed');
      return Response.json(
        { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
        { status: 500, headers: NO_STORE },
      );
    } finally {
      logger.info({ route: options.name, ms: Math.round(performance.now() - started) }, 'route');
    }
  };
}

/** A text file as a streamed, never-cached download. */
export function fileResponse(file: {
  fileName: string;
  body: string;
  contentType: string;
}): Response {
  const bytes = new TextEncoder().encode(file.body);
  const chunk = 64 * 1024;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
  return new Response(stream, {
    headers: {
      ...NO_STORE,
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
