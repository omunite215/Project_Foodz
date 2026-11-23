import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { CampaignPlacement, Cuisine } from '@/server/db/enums';

/*
 * The menu, campaigns and store settings are public catalog data: these tables have no
 * row-level security, and the anonymous visitor reads them like anyone else.
 */

const cardFields = {
  id: true,
  slug: true,
  title: true,
  cuisine: true,
  priceCents: true,
  images: true,
  ratingAvg: true,
  ratingCount: true,
  isSpecial: true,
  isAvailable: true,
} as const;

const detailFields = {
  ...cardFields,
  description: true,
  flavors: true,
  prepMinutes: true,
} as const;

const couponFields = {
  code: true,
  description: true,
  type: true,
  value: true,
  minSubtotalCents: true,
  maxDiscountCents: true,
  cuisines: true,
  usageLimit: true,
  usedCount: true,
  ownerUserId: true,
  isStoreCredit: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
} as const;

/** Sold-out dishes after the others; alphabetical within each group. */
const menuOrder = [{ isAvailable: 'desc' as const }, { title: 'asc' as const }];

export function findDishes(
  ctx: DbContext,
  filter: { cuisine?: Cuisine; specialOnly?: boolean; availableOnly?: boolean; ids?: string[] },
) {
  return db(ctx).menuItem.findMany({
    where: {
      cuisine: filter.cuisine,
      isSpecial: filter.specialOnly ? true : undefined,
      isAvailable: filter.availableOnly ? true : undefined,
      id: filter.ids ? { in: filter.ids } : undefined,
    },
    orderBy: filter.cuisine ? menuOrder : [{ cuisine: 'asc' }, ...menuOrder],
    select: cardFields,
  });
}

export function findDishBySlug(ctx: DbContext, slug: string) {
  return db(ctx).menuItem.findUnique({ where: { slug }, select: detailFields });
}

/** Other available dishes of the same cuisine, most ordered first. */
export function findSimilarDishes(
  ctx: DbContext,
  dish: { id: string; cuisine: Cuisine },
  limit: number,
) {
  return db(ctx).menuItem.findMany({
    where: { cuisine: dish.cuisine, isAvailable: true, id: { not: dish.id } },
    orderBy: [{ soldCount: 'desc' }, { title: 'asc' }],
    take: limit,
    select: cardFields,
  });
}

export async function countByCuisine(ctx: DbContext) {
  const groups = await db(ctx).menuItem.groupBy({ by: ['cuisine'], _count: { id: true } });
  return groups.map((group) => ({ cuisine: group.cuisine, count: group._count.id }));
}

/** The most ordered dish of each cuisine (ties go to the first by name). */
export async function findBestSellerIds(ctx: DbContext): Promise<string[]> {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT DISTINCT ON (cuisine) id::text AS id
    FROM menu_items
    WHERE sold_count > 0
    ORDER BY cuisine, sold_count DESC, title ASC`;
  return rows.map((row) => row.id);
}

/** Campaigns switched on whose schedule includes the instant, highest priority first. */
export function findActiveCampaigns(ctx: DbContext, placement: CampaignPlacement, at: Date) {
  return db(ctx).campaign.findMany({
    where: { placement, isActive: true, startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: [{ priority: 'desc' }, { endsAt: 'asc' }, { id: 'asc' }],
    take: 10,
    select: {
      id: true,
      placement: true,
      title: true,
      subtitle: true,
      imageKey: true,
      ctaLabel: true,
      ctaHref: true,
      startsAt: true,
      endsAt: true,
      couponId: true,
      coupon: { select: couponFields },
      menuItems: {
        where: { isAvailable: true },
        orderBy: { title: 'asc' },
        select: cardFields,
      },
    },
  });
}

/** Running campaigns that carry a coupon, with the dishes they feature, soonest to end first. */
export function findCouponCampaigns(ctx: DbContext, at: Date) {
  return db(ctx).campaign.findMany({
    where: { isActive: true, startsAt: { lte: at }, endsAt: { gt: at }, couponId: { not: null } },
    orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
    take: 50,
    select: {
      id: true,
      title: true,
      endsAt: true,
      coupon: { select: couponFields },
      menuItems: { select: { id: true } },
    },
  });
}

// ------------------------------------------------------------------ search (F3 S6)

/*
 * Search runs only on Postgres full-text and trigram matching. What the customer typed is
 * passed as a bound parameter to websearch_to_tsquery (which accepts any text) and to the
 * trigram functions; the prefix term is letters and digits only (see search.ts). The text
 * search configuration foodz_search ignores accents, case and English stop words.
 */

export interface SearchMatch {
  id: string;
  title: string;
}

interface SearchTermsInput {
  query: string;
  head: string;
  prefix: string | null;
}

/** How many terms each form of the query holds; 0 and 0 means there is nothing to search for. */
export async function countSearchTerms(ctx: DbContext, terms: SearchTermsInput) {
  const rows = await db(ctx).$queryRaw<{ full_nodes: number; prefix_nodes: number }[]>`
    SELECT
      numnode(websearch_to_tsquery('public.foodz_search', ${terms.query}))::int AS full_nodes,
      CASE WHEN ${terms.prefix}::text IS NULL THEN 0
        ELSE numnode(to_tsquery('public.foodz_search', ${terms.prefix}::text))::int
      END AS prefix_nodes`;
  return rows[0] ?? { full_nodes: 0, prefix_nodes: 0 };
}

/**
 * Full-text matches: the whole query, or every word but the last plus the last as the start of
 * a word. Available dishes first, then dishes whose name matches, then by rank and name.
 */
export function findSearchMatches(ctx: DbContext, terms: SearchTermsInput, limit: number) {
  return db(ctx).$queryRaw<SearchMatch[]>`
    WITH q AS (
      SELECT
        websearch_to_tsquery('public.foodz_search', ${terms.query}) AS whole,
        CASE WHEN ${terms.prefix}::text IS NULL THEN ''::tsquery
          ELSE websearch_to_tsquery('public.foodz_search', ${terms.head})
            && to_tsquery('public.foodz_search', ${terms.prefix}::text)
        END AS started
    ),
    hits AS (
      SELECT
        m.id,
        m.title,
        m.is_available,
        m.search_vector AS doc,
        q.whole,
        q.started,
        CASE WHEN numnode(q.whole) > 0 THEN m.search_vector @@ q.whole ELSE false END AS whole_hit,
        CASE WHEN numnode(q.started) > 0 THEN m.search_vector @@ q.started ELSE false END AS started_hit
      FROM menu_items m, q
    )
    SELECT id::text AS id, title
    FROM hits
    WHERE whole_hit OR started_hit
    ORDER BY
      is_available DESC,
      (
        CASE WHEN whole_hit THEN ts_filter(doc, '{a}') @@ whole ELSE false END
        OR CASE WHEN started_hit THEN ts_filter(doc, '{a}') @@ started ELSE false END
      ) DESC,
      ts_rank(doc, CASE WHEN whole_hit THEN whole ELSE started END) DESC,
      title ASC
    LIMIT ${limit}`;
}

/**
 * Close dish names for a query with no full-text match ("bulgogy", "pad tai"), compared without
 * accents. Best first.
 */
export async function findSimilarTitles(
  ctx: DbContext,
  query: string,
  minScore: number,
  limit: number,
) {
  await db(ctx)
    .$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(minScore)}, true)`;
  return db(ctx).$queryRaw<(SearchMatch & { score: number })[]>`
    SELECT
      id::text AS id,
      title,
      word_similarity(foodz_unaccent(${query}), foodz_unaccent(title)) AS score
    FROM menu_items
    WHERE foodz_unaccent(${query}) <% foodz_unaccent(title)
    ORDER BY score DESC, is_available DESC, title ASC
    LIMIT ${limit}`;
}

export function findStoreSettings(ctx: DbContext) {
  return db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: {
      storeName: true,
      addressText: true,
      contactPhone: true,
      contactEmail: true,
      footerLinks: true,
      timezone: true,
      openingHours: true,
      deliveryRadiusKm: true,
      baseDeliveryFeeCents: true,
      perKmFeeCents: true,
    },
  });
}
