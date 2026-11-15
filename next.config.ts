import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  typedRoutes: true,
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [{ source: '/contact-us', destination: '/contact', permanent: true }];
  },
};

export default nextConfig;
