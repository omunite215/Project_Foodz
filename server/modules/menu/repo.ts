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
