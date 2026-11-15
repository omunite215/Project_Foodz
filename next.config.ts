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
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [{ source: '/contact-us', destination: '/contact', permanent: true }];
  },
};

export default nextConfig;
