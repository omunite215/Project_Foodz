import type { NextConfig } from 'next';

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
      ...['/:prefix(api|_next/static|_next/image)/:path*', '/robots.txt', '/sitemap.xml'].map(
        (source) => ({ source, headers: lockedDownHeaders }),
      ),
    ];
  },
  async redirects() {
    return [{ source: '/contact-us', destination: '/contact', permanent: true }];
  },
};

export default nextConfig;
