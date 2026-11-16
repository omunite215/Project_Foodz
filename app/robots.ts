import type { MetadataRoute } from 'next';

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3456';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin', '/partner', '/account', '/checkout', '/orders'],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
