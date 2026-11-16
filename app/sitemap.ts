import type { MetadataRoute } from 'next';

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ['', '/menu', '/blog', '/contact'].map((path) => ({
    url: `${site}${path}`,
    lastModified: now,
    changeFrequency: path === '/menu' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
}
