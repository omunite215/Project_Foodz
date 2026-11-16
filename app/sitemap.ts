import type { MetadataRoute } from 'next';
import { dishHref } from '@/server/modules/menu/urls';
import { listMenu } from '@/server/modules/menu/service';
import { readOrNull } from '@/lib/storefront-data';

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3456';

// The dish list comes from the database, so the sitemap is built per request.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = ['', '/menu', '/blog', '/contact'].map((path) => ({
    url: `${site}${path}`,
    lastModified: now,
    changeFrequency: path === '/menu' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
  const dishes = (await readOrNull('sitemap dishes', () => listMenu())) ?? [];

  return [
    ...pages,
    ...dishes.map((dish) => ({
      url: `${site}${dishHref(dish.slug)}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
