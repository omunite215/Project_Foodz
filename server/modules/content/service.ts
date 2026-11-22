import 'server-only';
import { runAs } from '@/server/db/context';
import { findPublishedPage, findPublishedVersion } from './repo';
import { type LegalPage, legalSlugSchema, toContentBlocks } from './schema';

const anonymous = { kind: 'anonymous' } as const;

/** The published Terms or Privacy Policy, or null when it is missing or not published. */
export async function getLegalPage(slug: string): Promise<LegalPage | null> {
  const parsed = legalSlugSchema.safeParse(slug);
  if (!parsed.success) return null;

  const page = await runAs(anonymous, (ctx) => findPublishedPage(ctx, parsed.data));
  const published = page?.publishedVersion;
  if (!published) return null;
  return {
    slug: parsed.data,
    title: published.title,
    version: published.version,
    publishedAt: published.publishedAt.toISOString(),
    blocks: toContentBlocks(published.content),
  };
}

/** The Terms version a new account accepts by signing up. */
export async function currentTermsVersion(): Promise<number | null> {
  return runAs(anonymous, (ctx) => findPublishedVersion(ctx, 'terms'));
}
