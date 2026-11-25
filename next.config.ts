import type { NextConfig } from 'next';
// Relative import: path aliases do not resolve in next.config.
import { legacyMenuRedirects } from './server/modules/menu/urls';

const isProd = process.env.NODE_ENV === 'production';

// Headers that apply to every response, API routes included. The CSP and Permissions-Policy
// are per-request and set in proxy.ts.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

// Non-page responses never render HTML, so they get a policy that allows nothing.
// Pages receive their nonce-based policy from proxy.ts.
const lockedDownHeaders = [
  { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
  { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
];

// Staff tools (F5 A1.9): never indexed, never kept by the browser, so Back after signing out
// shows the sign-in page rather than the board.
const adminHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  typedRoutes: true,
  output: 'standalone',
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ['pino', 'pino-pretty'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      ...[
        '/:prefix(api|_next/static|_next/image)/:path*',
        '/robots.txt',
        '/sitemap.xml',
        '/.well-known/:path*',
      ].map((source) => ({ source, headers: lockedDownHeaders })),
      { source: '/admin/:path*', headers: adminHeaders },
      // The partner app and its API (F6 B15): never indexed, never cached by the browser.
      { source: '/partner/:path*', headers: adminHeaders },
      { source: '/api/v1/partner/:path*', headers: adminHeaders },
      // The worker lives under /partner/ but controls /partner itself, the start page (B14).
      { source: '/partner/sw.js', headers: [{ key: 'Service-Worker-Allowed', value: '/partner' }] },
    ];
  },
  async redirects() {
    return [
      { source: '/contact-us', destination: '/contact', permanent: true },
      // Old dish pages move permanently to their new address. The temporary catch-all (unknown
      // old ids to /menu) is left out: an id that never existed shows the dish-not-found page.
      ...legacyMenuRedirects().filter((redirect) => redirect.permanent),
      // A cuisine typed as a path opens its tab.
      {
        source: '/menu/:cuisine(korean|thai|vietnamese)',
        destination: '/menu?cuisine=:cuisine',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
