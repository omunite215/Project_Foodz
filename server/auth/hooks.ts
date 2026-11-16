import 'server-only';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { verifyJWT } from 'better-auth/crypto';
import { NOTICE_COOKIES } from '@/lib/notices';
import { landingFor, safeRedirectPath } from '@/lib/redirect';
import { noteBreachCheckSkipped } from '@/server/modules/account/identity';
import { checkPasswordBreach } from '@/server/security/breached-passwords';

/*
 * Rules that run inside Better Auth, so they hold however an endpoint is reached:
 *   - breached passwords are refused on sign-up, reset and change (B2: accepted, and recorded,
 *     when the breach service is down);
 *   - emails are trimmed and lower-cased;
 *   - every redirect target is a path on this site (S2.4);
 *   - confirm-email links: links issued before an email change are refused, and the landing
 *     page learns whether this browser was signed in by the link (design 3.7).
 */

export const BREACHED_PASSWORD_MESSAGE =
  'This password has appeared in a data breach. Please choose a different one.';

const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
type Fields = Record<string, unknown>;

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

async function rejectBreached(password: unknown, path: string) {
  // Length is reported by Better Auth itself, so only plausible passwords are looked up.
  if (typeof password !== 'string') return;
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return;
  const result = await checkPasswordBreach(password);
  if (result === 'breached') {
    throw APIError.from('BAD_REQUEST', {
      code: 'PASSWORD_COMPROMISED',
      message: BREACHED_PASSWORD_MESSAGE,
    });
  }
  if (result === 'unknown') await noteBreachCheckSkipped(path);
}

function withParams(path: string, params: Record<string, string>) {
  const url = new URL(path, 'http://site.invalid');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

/** The error page for Google sign-in: our sign-in or sign-up page, keeping a safe return path. */
function socialErrorLanding(raw: unknown) {
  if (typeof raw === 'string') {
    try {
      const url = new URL(raw, 'http://site.invalid');
      if (
        url.origin === 'http://site.invalid' &&
        (url.pathname === '/sign-in' || url.pathname === '/sign-up')
      ) {
        const back = safeRedirectPath(url.searchParams.get('callbackUrl'));
        return back === '/' ? url.pathname : withParams(url.pathname, { callbackUrl: back });
      }
    } catch {
      // Falls through to the default.
    }
  }
  return '/sign-in';
}

interface LinkPayload {
  email?: unknown;
  userId?: unknown;
  updateTo?: unknown;
  requestType?: unknown;
  iat?: unknown;
}

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function readLink(ctx: Ctx): Promise<LinkPayload | null> {
  const query: Fields = isRecord(ctx.query) ? ctx.query : {};
  const token = typeof query.token === 'string' ? query.token : '';
  return token ? verifyJWT(token, ctx.context.secret) : null;
}

/** GET /verify-email: refuse superseded links and tell the landing page what happened. */
async function beforeVerifyEmail(ctx: Ctx) {
  const query: Fields = isRecord(ctx.query) ? ctx.query : {};
  const landing = landingFor('/verify-email', query.callbackURL);
  const payload = await readLink(ctx);
  const params: Record<string, string> = {};

  if (payload && typeof payload.userId === 'string') {
    const user = await ctx.context.internalAdapter.findUserById(payload.userId);
    const cutOff: unknown = user ? Reflect.get(user, 'emailLinksValidAfter') : null;
    const validAfter =
      cutOff instanceof Date || typeof cutOff === 'string' ? new Date(cutOff).getTime() : 0;
    const issuedAt = typeof payload.iat === 'number' ? payload.iat * 1000 : 0;
    // Links sent before an email change stop working (S3.6). Shown as the "expired" page.
    if (user && validAfter && issuedAt < validAfter) {
      throw ctx.redirect(withParams(landing, { error: 'TOKEN_EXPIRED' }));
    }
    const isChange = typeof payload.updateTo === 'string';
    const alreadyConfirmed =
      !isChange && Boolean(user?.emailVerified) && user?.email === payload.email;
    params.status = alreadyConfirmed ? 'already-confirmed' : 'confirmed';
    if (!alreadyConfirmed) {
      const session = await getSessionFromCtx(ctx);
      if (!session || session.user.id !== user?.id) {
        // A first confirmation signs this browser in; an email change does not.
        params.via = isChange ? 'other-browser' : 'new-session';
      }
    }
  }
  return { context: { query: { ...query, callbackURL: withParams(landing, params) } } };
}

/** After a successful confirmation: the flash for the same browser, and email changes confirmed. */
async function afterVerifyEmail(ctx: Ctx) {
  const returned = ctx.context.returned;
  if (!isAPIError(returned) || returned.statusCode !== 302) return;
  const location = new Headers(returned.headers ?? undefined).get('location') ?? '';
  if (location.includes('error=')) return;

  const payload = await readLink(ctx);
  if (!payload || typeof payload.userId !== 'string') return;
  // A change of email is confirmed by the link sent to the new address (S3.6).
  if (payload.requestType === 'change-email-verification') {
    await ctx.context.internalAdapter.updateUser(payload.userId, { emailVerified: true });
  }
  if (location.includes('status=confirmed') && !location.includes('via=')) {
    ctx.setCookie(NOTICE_COOKIES.flash, 'email-confirmed', {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: ctx.context.baseURL.startsWith('https://'),
      maxAge: 300,
    });
  }
}

export const beforeHook = createAuthMiddleware(async (ctx) => {
  const body: Fields = isRecord(ctx.body) ? ctx.body : {};
  switch (ctx.path) {
    case '/sign-up/email':
      await rejectBreached(body.password, ctx.path);
      return {
        context: {
          body: {
            ...body,
            email: normalizeEmail(body.email),
            callbackURL: landingFor('/verify-email', body.callbackURL),
          },
        },
      };
    case '/sign-in/email':
      return { context: { body: { ...body, email: normalizeEmail(body.email) } } };
    case '/request-password-reset':
      return {
        context: {
          body: {
            ...body,
            email: normalizeEmail(body.email),
            redirectTo: landingFor('/reset-password', body.redirectTo),
          },
        },
      };
    case '/reset-password':
    case '/change-password':
      await rejectBreached(body.newPassword, ctx.path);
      return undefined;
    case '/send-verification-email':
    case '/change-email':
      return {
        context: {
          body: {
            ...body,
            ...(body.email !== undefined && { email: normalizeEmail(body.email) }),
            ...(body.newEmail !== undefined && { newEmail: normalizeEmail(body.newEmail) }),
            callbackURL: landingFor('/verify-email', body.callbackURL),
          },
        },
      };
    case '/sign-in/social':
      return {
        context: {
          body: {
            ...body,
            callbackURL: safeRedirectPath(body.callbackURL),
            newUserCallbackURL: safeRedirectPath(body.newUserCallbackURL ?? body.callbackURL),
            errorCallbackURL: socialErrorLanding(body.errorCallbackURL),
          },
        },
      };
    case '/reset-password/:token': {
      const query: Fields = isRecord(ctx.query) ? ctx.query : {};
      return {
        context: {
          query: { ...query, callbackURL: landingFor('/reset-password', query.callbackURL) },
        },
      };
    }
    case '/verify-email':
      return beforeVerifyEmail(ctx);
    default:
      return undefined;
  }
});

export const afterHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === '/verify-email') await afterVerifyEmail(ctx);
});
