import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/*
 * Reads for a price breakdown, made as the caller:
 *   - the menu, campaigns and store settings are public catalog data (no row-level security);
 *   - coupons have row-level security: a personal or store-credit code is visible only to its
 *     owner (and staff), so for anyone else it is simply not there;
 *   - redemptions and orders are the caller's own rows only.
 */

export function findPricingSettings(ctx: DbContext) {
  return db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: {
      taxRateBps: true,
      baseDeliveryFeeCents: true,
      perKmFeeCents: true,
      deliveryRadiusKm: true,
      contactPhone: true,
    },
  });
}

export function findDishes(ctx: DbContext, ids: string[]) {
  return db(ctx).menuItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slug: true,
      title: true,
      cuisine: true,
      priceCents: true,
      images: true,
      flavors: true,
      isAvailable: true,
    },
  });
}

const couponFields = {
  id: true,
  code: true,
  description: true,
  type: true,
  value: true,
  minSubtotalCents: true,
  maxDiscountCents: true,
  usageLimit: true,
  usedCount: true,
  perUserLimit: true,
  cuisines: true,
  ownerUserId: true,
  isStoreCredit: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
} as const;

export function findCouponByCode(ctx: DbContext, code: string) {
  return db(ctx).coupon.findUnique({ where: { code }, select: couponFields });
}

/** Running campaigns that promote a code, with that code (S4.10). */
export function findOfferCampaigns(ctx: DbContext, at: Date) {
  return db(ctx).campaign.findMany({
    where: { isActive: true, startsAt: { lte: at }, endsAt: { gt: at }, couponId: { not: null } },
    orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
    take: 20,
    select: { title: true, endsAt: true, coupon: { select: couponFields } },
  });
}

/** The caller's uses of these codes: completed ones and those held by an unpaid order. */
export function findRedemptions(ctx: DbContext, userId: string, couponIds: string[]) {
  return db(ctx).couponRedemption.findMany({
    where: { userId, couponId: { in: couponIds }, status: { in: ['REDEEMED', 'RESERVED'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      couponId: true,
      status: true,
      order: { select: { number: true, status: true } },
    },
  });
}
