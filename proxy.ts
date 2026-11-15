import { type NextRequest, NextResponse } from 'next/server';
import { buildCsp, originOf, permissionsPolicy } from '@/server/security/csp';

// Runs before every page request. Authorization is NOT decided here (that happens in the
// data access layer); this only attaches per-request security headers and a request id.
export function proxy(request: NextRequest) {
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
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('permissions-policy', permissionsPolicy(request.nextUrl.pathname));
  response.headers.set('x-request-id', requestId);
  return response;
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
