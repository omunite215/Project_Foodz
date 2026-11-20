import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/*
 * Site pages are public: content_pages and content_versions have no row-level security and are
 * read as the anonymous visitor. Only the published version is ever returned.
 */

export function findPublishedPage(ctx: DbContext, slug: string) {
  return db(ctx).contentPage.findUnique({
    where: { slug },
    select: {
      slug: true,
      publishedVersion: {
        select: { version: true, title: true, content: true, publishedAt: true },
      },
    },
  });
}

export async function findPublishedVersion(ctx: DbContext, slug: string) {
  const page = await db(ctx).contentPage.findUnique({
    where: { slug },
    select: { publishedVersion: { select: { version: true } } },
  });
  return page?.publishedVersion?.version ?? null;
}
