import { type NextRequest, NextResponse } from 'next/server';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';
import { buildCsp, originOf, permissionsPolicy } from '@/server/security/csp';

// Runs before every page request. Authorization is NOT decided here (that happens in the
// data access layer); this only attaches per-request security headers and a request id.
export function proxy(request: NextRequest) {
  // Next answers a path it cannot percent-decode ("/menu/%ff") with a bare 500 and none of the
  // security headers, so such requests are refused here first.
  if (!isDecodable(request.nextUrl.pathname)) {
    return new NextResponse('Bad Request', {
      status: 400,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'permissions-policy': permissionsPolicy('/'),
      },
    });
  }

  const nonce = btoa(crypto.randomUUID());
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const isDev = process.env.NODE_ENV === 'development';

  const pusherHost = process.env.NEXT_PUBLIC_PUSHER_HOST;
  const socketOrigins = pusherHost
    ? [
        `${process.env.NEXT_PUBLIC_PUSHER_USE_TLS === 'true' ? 'wss' : 'ws'}://${pusherHost}:${process.env.NEXT_PUBLIC_PUSHER_PORT ?? 443}`,
      ]
    : ['wss://*.pusher.com'];

  const csp = buildCsp({
    nonce,
    isDev,
    isHttps: process.env.NEXT_PUBLIC_SITE_URL?.startsWith('https://') ?? false,
    imageOrigins: [originOf(process.env.S3_PUBLIC_URL)].filter((v): v is string => Boolean(v)),
    socketOrigins,
    privateBucketOrigins: [originOf(process.env.S3_ENDPOINT)].filter((v): v is string =>
      Boolean(v),
    ),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('content-security-policy', csp);
  // The page asked for, so a signed-out visit to /account… can return there after sign-in.
  requestHeaders.set(REQUEST_PATH_HEADER, requestedPath(request.nextUrl));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('permissions-policy', permissionsPolicy(request.nextUrl.pathname));
  response.headers.set('x-request-id', requestId);
  return response;
}

/** The requested path and query, without the router's own cache-busting parameter. */
function requestedPath(url: URL) {
  const search = new URLSearchParams(url.search);
  search.delete('_rsc');
  const query = search.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

function isDecodable(pathname: string) {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.well-known).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
