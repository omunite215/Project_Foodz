import 'server-only';
import { z } from 'zod';
import { type DbContext, runAs } from '@/server/db/context';
import type { CampaignPlacement, Cuisine } from '@/server/db/enums';
import { logger } from '@/server/logger';
import { isValidTimeZone, openState, weekdayAt } from './hours';
import {
  countByCuisine,
  countSearchTerms,
  findActiveCampaigns,
  findBestSellerIds,
  findCouponCampaigns,
  findDishBySlug,
  findDishes,
  findSearchMatches,
  findSimilarDishes,
  findSimilarTitles,
  findStoreSettings,
} from './repo';
import {
  type CampaignBanner,
  type CampaignCoupon,
  type CuisineCounts,
  cuisineSchema,
  type DishCard,
  type DishDetail,
  type DishIdsInput,
  dishIdsInput,
  type DishOffer,
  dishSlugSchema,
  type DishSuggestionsInput,
  dishSuggestionsInput,
  type FooterLinkGroup,
  footerLinkGroupSchema,
  menuSearchInput,
  type MenuSearchResult,
  openingHoursSchema,
  placementSchema,
  type StoreStatus,
  WEEKDAYS,
} from './schema';
import { searchTerms } from './search';

/** Shown everywhere until it becomes a store setting. */
export const DELIVERY_PROMISE_MINUTES = 45;

const FALLBACK_TIME_ZONE = 'America/New_York';

/** The catalog is public and the same for everyone, so it is always read as an anonymous visitor. */
function readCatalog<T>(work: (ctx: DbContext) => Promise<T>) {
  return runAs({ kind: 'anonymous' }, work);
}

const SITE_PATH = /^\/(?![/\\])\S*$/;
const HTTPS_URL = /^https:\/\/\S+$/;

/** A path on this site, or an https URL (uploaded images, outside links in the footer). */
const isSafeLink = (value: string) => SITE_PATH.test(value) || HTTPS_URL.test(value);

// ------------------------------------------------------------------ coupons and offers

type CouponRow = NonNullable<Awaited<ReturnType<typeof findActiveCampaigns>>[number]['coupon']>;

/**
 * A campaign's code is only shown while it can be used. Personal codes (store credit) are never
 * advertised.
 */
function isCouponLive(coupon: CouponRow, at: Date) {
  return (
    coupon.isActive &&
    !coupon.isStoreCredit &&
    coupon.ownerUserId === null &&
    coupon.startsAt <= at &&
    (coupon.endsAt === null || coupon.endsAt > at) &&
    (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit)
  );
}

function toCoupon(coupon: CouponRow): CampaignCoupon {
  return {
    code: coupon.code,
    description: coupon.description,
    type: coupon.type,
    percentOff: coupon.type === 'PERCENT' ? coupon.value : null,
    amountOffCents: coupon.type === 'FIXED' ? coupon.value : null,
    minSubtotalCents: coupon.minSubtotalCents,
    maxDiscountCents: coupon.maxDiscountCents,
    cuisines: coupon.cuisines,
    endsAt: coupon.endsAt?.toISOString() ?? null,
  };
}

/** For each featured dish, the soonest-ending running campaign whose coupon can be used. */
async function offersByDish(ctx: DbContext, at: Date) {
  const offers = new Map<string, DishOffer>();
  for (const campaign of await findCouponCampaigns(ctx, at)) {
    if (!campaign.coupon || !isCouponLive(campaign.coupon, at)) continue;
    const offer = {
      campaignId: campaign.id,
      title: campaign.title,
      endsAt: campaign.endsAt.toISOString(),
    };
    // Campaigns come soonest-ending first, so the first one found for a dish wins.
    for (const { id } of campaign.menuItems) if (!offers.has(id)) offers.set(id, offer);
  }
  return offers;
}

// ------------------------------------------------------------------ dishes

type CardRow = Awaited<ReturnType<typeof findDishes>>[number];

interface CardContext {
  bestSellers: ReadonlySet<string>;
  offers: ReadonlyMap<string, DishOffer>;
}

async function cardContext(ctx: DbContext, at: Date): Promise<CardContext> {
  return {
    bestSellers: new Set(await findBestSellerIds(ctx)),
    offers: await offersByDish(ctx, at),
  };
}

const imagesOf = (images: string[]) => images.filter(isSafeLink);

function toCard(row: CardRow, context: CardContext): DishCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    cuisine: row.cuisine,
    priceCents: row.priceCents,
    image: imagesOf(row.images)[0] ?? null,
    ratingAvg:
      row.ratingCount > 0 ? Math.min(5, Math.max(0, Math.round(row.ratingAvg * 10) / 10)) : 0,
    ratingCount: row.ratingCount,
    isSpecial: row.isSpecial,
    isAvailable: row.isAvailable,
    isBestSeller: context.bestSellers.has(row.id),
    offer: context.offers.get(row.id) ?? null,
  };
}

async function toCards(ctx: DbContext, rows: CardRow[], at: Date) {
  const context = await cardContext(ctx, at);
  return rows.map((row) => toCard(row, context));
}

/** Every dish of a cuisine, sold-out ones last (flagged, not hidden). */
export async function listDishesByCuisine(cuisine: Cuisine, at = new Date()): Promise<DishCard[]> {
  const parsed = cuisineSchema.parse(cuisine);
  return readCatalog(async (ctx) => toCards(ctx, await findDishes(ctx, { cuisine: parsed }), at));
}

/**
 * The whole menu for one render of the menu page: Korean, Thai, then Vietnamese; within each,
 * available dishes first, then sold-out ones.
 */
export async function listMenu(at = new Date()): Promise<DishCard[]> {
  return readCatalog(async (ctx) => toCards(ctx, await findDishes(ctx, {}), at));
}

/** How many dishes each cuisine tab holds, sold-out ones included. */
export async function countDishesByCuisine(): Promise<CuisineCounts> {
  const groups = await readCatalog(countByCuisine);
  const counts: CuisineCounts = { KOREAN: 0, THAI: 0, VIETNAMESE: 0 };
  for (const group of groups) counts[group.cuisine] = group.count;
  return counts;
}

/** Dishes that can be ordered now, grouped by cuisine (Korean, Thai, Vietnamese). */
export async function listAvailableDishes(at = new Date()): Promise<DishCard[]> {
  return readCatalog(async (ctx) =>
    toCards(ctx, await findDishes(ctx, { availableOnly: true }), at),
  );
}

/**
 * The featured dish leads: the one whose offer ends soonest, otherwise the best seller,
 * otherwise the first by name.
 */
function featuredFirst(dishes: DishCard[]) {
  const soonest = dishes.reduce<DishCard | undefined>((best, dish) => {
    if (!dish.offer) return best;
    return best?.offer && best.offer.endsAt <= dish.offer.endsAt ? best : dish;
  }, undefined);
  const featured = soonest ?? dishes.find((dish) => dish.isBestSeller) ?? dishes[0];
  return featured ? [featured, ...dishes.filter((dish) => dish !== featured)] : dishes;
}

/** Special dishes that can be ordered now, the featured one first and the rest by name. */
export async function listSpecials(at = new Date()): Promise<DishCard[]> {
  const specials = await readCatalog(async (ctx) =>
    toCards(ctx, await findDishes(ctx, { specialOnly: true, availableOnly: true }), at),
  );
  return featuredFirst(specials);
}

/** A dish page, or null for a slug that is unknown or not in canonical form. */
export async function getDishBySlug(slug: string, at = new Date()): Promise<DishDetail | null> {
  const parsed = dishSlugSchema.safeParse(slug);
  if (!parsed.success) return null;

  return readCatalog(async (ctx) => {
    const row = await findDishBySlug(ctx, parsed.data);
    if (!row) return null;
    return {
      ...toCard(row, await cardContext(ctx, at)),
      description: row.description,
      images: imagesOf(row.images),
      flavors: row.flavors,
      prepMinutes: row.prepMinutes,
    };
  });
}

/** Other available dishes of the same cuisine to suggest, for example when one is sold out. */
export async function listDishSuggestions(
  input: DishSuggestionsInput,
  at = new Date(),
): Promise<DishCard[]> {
  const { id, cuisine, limit } = dishSuggestionsInput.parse(input);
  return readCatalog(async (ctx) =>
    toCards(ctx, await findSimilarDishes(ctx, { id, cuisine }, limit), at),
  );
}

/** Current price and availability of the given dishes. Ids that match no dish are left out. */
export async function listDishesByIds(input: DishIdsInput, at = new Date()): Promise<DishCard[]> {
  const { ids } = dishIdsInput.parse(input);
  return readCatalog(async (ctx) =>
    toCards(ctx, await findDishes(ctx, { ids: [...new Set(ids)] }), at),
  );
}

/**
 * Dish cards for ids the server already holds (a customer's favorites), without the 50-id cap
 * of the browser-facing check. Unknown ids are left out; the caller orders the result.
 */
export async function listDishCards(ids: readonly string[], at = new Date()): Promise<DishCard[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return readCatalog(async (ctx) => toCards(ctx, await findDishes(ctx, { ids: unique }), at));
}

// ------------------------------------------------------------------ search (F3 S6)

const SEARCH_LIMIT = 50;
const SUGGESTION_LIMIT = 5;
/** word_similarity from which a dish name counts as close (bulgogy and Bulgogi score 0.75). */
const SUGGESTION_SCORE = 0.5;
const SUGGESTION_MIN_LETTERS = 3;

/**
 * Menu search across every cuisine: dish names, descriptions and cuisine names, without accents
 * or case, the last word matching as the start of a word, and close names when nothing matches
 * (S6.2 to S6.8). Called by the search action, and directly by the server render of
 * `/menu?q=...` (S6.13).
 */
export async function searchMenu(input: unknown): Promise<MenuSearchResult> {
  const { q } = menuSearchInput.parse(input);
  const terms = searchTerms(q);
  const { query } = terms;
  return readCatalog(async (ctx): Promise<MenuSearchResult> => {
    const counts = query ? await countSearchTerms(ctx, terms) : null;
    if (!counts || (counts.full_nodes === 0 && counts.prefix_nodes === 0)) {
      return { query, kind: 'all', ids: [], didYouMean: null };
    }
    const matches = await findSearchMatches(ctx, terms, SEARCH_LIMIT);
    if (matches.length > 0) {
      return { query, kind: 'matches', ids: matches.map((match) => match.id), didYouMean: null };
    }
    if (terms.letters >= SUGGESTION_MIN_LETTERS) {
      const similar = await findSimilarTitles(ctx, query, SUGGESTION_SCORE, SUGGESTION_LIMIT);
      const [best] = similar;
      if (best) {
        return {
          query,
          kind: 'suggestions',
          ids: similar.map((match) => match.id),
          didYouMean: best.title,
        };
      }
    }
    return { query, kind: 'none', ids: [], didYouMean: null };
  });
}

// ------------------------------------------------------------------ campaigns

/**
 * Campaigns to show in a placement at an instant: switched on, inside their schedule, and, when
 * they promote a coupon, only while that coupon can be used.
 */
export async function listActiveCampaigns(
  placement: CampaignPlacement,
  at = new Date(),
): Promise<CampaignBanner[]> {
  const parsed = placementSchema.parse(placement);

  return readCatalog(async (ctx) => {
    const rows = await findActiveCampaigns(ctx, parsed, at);
    const context = await cardContext(ctx, at);

    return (
      rows
        // A campaign's code may be hidden from this reader by row-level security (a personal
        // code): then the campaign is hidden too, never shown without its code.
        .filter((row) =>
          row.couponId === null ? true : row.coupon !== null && isCouponLive(row.coupon, at),
        )
        .map((row) => {
          const cta =
            row.ctaLabel && row.ctaHref && SITE_PATH.test(row.ctaHref)
              ? { label: row.ctaLabel, href: row.ctaHref }
              : null;
          if (row.ctaHref && !cta) {
            logger.warn({ campaignId: row.id }, 'campaign link is not a path on this site; hidden');
          }
          return {
            id: row.id,
            placement: row.placement,
            title: row.title,
            subtitle: row.subtitle,
            image: row.imageKey && isSafeLink(row.imageKey) ? row.imageKey : null,
            cta,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            coupon: row.coupon ? toCoupon(row.coupon) : null,
            dishes: row.menuItems.map((dish) => toCard(dish, context)),
          };
        })
    );
  });
}

// ------------------------------------------------------------------ store

function footerLinksOf(value: unknown): FooterLinkGroup[] {
  const parsed = z.array(footerLinkGroupSchema).safeParse(value);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, 'footer links are invalid; none shown');
    return [];
  }
  return parsed.data
    .map((group) => ({
      title: group.title,
      links: group.links.filter((link) => isSafeLink(link.href)),
    }))
    .filter((group) => group.links.length > 0);
}

/**
 * Open or closed at an instant (now by default), with the weekly hours, contact details,
 * footer links and delivery basics.
 */
export async function getStoreStatus(at = new Date()): Promise<StoreStatus> {
  const settings = await readCatalog(findStoreSettings);
  if (!settings) throw new Error('Store settings are missing. Run the seed.');

  const parsedHours = openingHoursSchema.safeParse(settings.openingHours);
  if (!parsedHours.success) {
    logger.error(
      { issues: parsedHours.error.issues },
      'opening hours are invalid; store shown as closed',
    );
  }
  const hours = parsedHours.success ? parsedHours.data : {};

  let timeZone = settings.timezone;
  if (!isValidTimeZone(timeZone)) {
    logger.error({ timeZone }, 'store time zone is invalid; using the default');
    timeZone = FALLBACK_TIME_ZONE;
  }

  return {
    timeZone,
    at: at.toISOString(),
    today: weekdayAt(at, timeZone),
    ...openState(hours, timeZone, at),
    weeklyHours: WEEKDAYS.map((weekday) => ({ weekday, hours: hours[weekday] ?? null })),
    store: {
      name: settings.storeName,
      addressText: settings.addressText,
      phone: settings.contactPhone,
      email: settings.contactEmail,
    },
    footerLinks: footerLinksOf(settings.footerLinks),
    delivery: {
      promiseMinutes: DELIVERY_PROMISE_MINUTES,
      radiusKm: settings.deliveryRadiusKm,
      baseFeeCents: settings.baseDeliveryFeeCents,
      perKmFeeCents: settings.perKmFeeCents,
    },
  };
}
