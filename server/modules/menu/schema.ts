import { z } from 'zod';
import { CampaignPlacement, CouponType, Cuisine } from '@/server/db/enums';
import { DISH_SLUG_MAX_LENGTH, DISH_SLUG_PATTERN } from './urls';

/*
 * What the storefront reads: dish cards, dish pages, campaign banners and the store status.
 *
 * Money is always integer cents (1299 is $12.99); the UI formats it. Instants are ISO 8601
 * strings in UTC. Clock times ("HH:MM", 24-hour) are the store's local time.
 */

const cents = z.int().min(0);
const instant = z.iso.datetime();

export const cuisineSchema = z.enum(Cuisine);
export const placementSchema = z.enum(CampaignPlacement);

export const dishSlugSchema = z.string().max(DISH_SLUG_MAX_LENGTH).regex(DISH_SLUG_PATTERN);

// ------------------------------------------------------------------ dishes

/**
 * A running deal on a dish, for the "Ends in ..." badge: the soonest-ending active campaign that
 * features the dish and has a usable coupon. Campaigns without a coupon never set it.
 */
export const dishOfferSchema = z.object({
  campaignId: z.uuid(),
  title: z.string(),
  endsAt: instant,
});
export type DishOffer = z.infer<typeof dishOfferSchema>;

export const dishCardSchema = z.object({
  id: z.uuid(),
  slug: dishSlugSchema,
  title: z.string(),
  cuisine: cuisineSchema,
  priceCents: cents,
  /** The first photo (a path on this site), or null: show the placeholder plate. */
  image: z.string().nullable(),
  /** 0 to 5, one decimal. 0 when there are no reviews yet. */
  ratingAvg: z.number().min(0).max(5),
  ratingCount: z.int().min(0),
  isSpecial: z.boolean(),
  /** False: sold out today. Still listed (after the available dishes) but not orderable. */
  isAvailable: z.boolean(),
  /** The most ordered dish of its cuisine. */
  isBestSeller: z.boolean(),
  offer: dishOfferSchema.nullable(),
});
export type DishCard = z.infer<typeof dishCardSchema>;

export const dishDetailSchema = dishCardSchema.extend({
  description: z.string(),
  /** Every photo, in order. Empty: show the placeholder plate. */
  images: z.array(z.string()),
  /** The flavors this dish can be adjusted with. */
  flavors: z.array(z.string()),
  prepMinutes: z.int().min(0),
});
export type DishDetail = z.infer<typeof dishDetailSchema>;

export const cuisineCountsSchema = z.record(cuisineSchema, z.int().min(0));
export type CuisineCounts = z.infer<typeof cuisineCountsSchema>;

/** Dishes already in the browser's cart, checked again before adding or showing them. */
export const dishIdsInput = z.object({ ids: z.array(z.uuid()).min(1).max(50) }).strict();
export type DishIdsInput = z.input<typeof dishIdsInput>;

export const dishSuggestionsInput = z
  .object({
    id: z.uuid(),
    cuisine: cuisineSchema,
    limit: z.int().min(1).max(6).default(3),
  })
  .strict();
export type DishSuggestionsInput = z.input<typeof dishSuggestionsInput>;

// ------------------------------------------------------------------ search (F3 S6)

/** Longer queries are cut to this many characters (S6.8). */
export const SEARCH_MAX_LENGTH = 100;

/**
 * What the customer typed. Anything up to 1000 characters is accepted and cut to 100 on the
 * server; control characters are ignored (S6.14). It is only ever used as Postgres full-text
 * and trigram input, never as a pattern.
 */
export const menuSearchInput = z.object({ q: z.string().max(1000) }).strict();
export type MenuSearchInput = z.input<typeof menuSearchInput>;

export const menuSearchResultSchema = z.object({
  /** The query as searched: cleaned, spaces collapsed, at most 100 characters. Render as text. */
  query: z.string(),
  /**
   * all: nothing to search for (empty, only stop words such as "the", or only punctuation):
   * show the whole menu. matches: `ids` hold the matches. suggestions: no exact match, `ids`
   * hold close matches and `didYouMean` the best one (S6.5). none: nothing matches (S6.7).
   */
  kind: z.enum(['all', 'matches', 'suggestions', 'none']),
  /**
   * Dish ids in result order: dishes whose name matches first, sold-out dishes last (S6.2).
   * Price and cuisine filters apply to these in the browser (B10).
   */
  ids: z.array(z.uuid()),
  /** With kind suggestions: the closest dish name, e.g. "Bulgogi". */
  didYouMean: z.string().nullable(),
});
export type MenuSearchResult = z.infer<typeof menuSearchResultSchema>;

// ------------------------------------------------------------------ campaigns

export const campaignCouponSchema = z.object({
  code: z.string(),
  description: z.string().nullable(),
  type: z.enum(CouponType),
  /** PERCENT coupons only. */
  percentOff: z.int().min(1).max(100).nullable(),
  /** FIXED coupons only. */
  amountOffCents: cents.nullable(),
  minSubtotalCents: cents,
  maxDiscountCents: cents.nullable(),
  /** Empty: valid on every cuisine. */
  cuisines: z.array(cuisineSchema),
  endsAt: instant.nullable(),
});
export type CampaignCoupon = z.infer<typeof campaignCouponSchema>;

export const campaignBannerSchema = z.object({
  id: z.uuid(),
  placement: placementSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  /** A path on this site, or null. */
  image: z.string().nullable(),
  /** Null: no button. The href is always a path on this site. */
  cta: z.object({ label: z.string(), href: z.string() }).nullable(),
  startsAt: instant,
  endsAt: instant,
  coupon: campaignCouponSchema.nullable(),
  /** Featured dishes that can be ordered now; sold-out ones are left out. */
  dishes: z.array(dishCardSchema),
});
export type CampaignBanner = z.infer<typeof campaignBannerSchema>;

// ------------------------------------------------------------------ store

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const weekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof weekdaySchema>;

export const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/** Close at or before open means after midnight: 18:00 to 02:00, or 00:00 to 00:00 (all day). */
export const dayHoursSchema = z.object({ open: clockTimeSchema, close: clockTimeSchema });
export type DayHours = z.infer<typeof dayHoursSchema>;

const dayEntry = dayHoursSchema.nullish();

/** SiteSettings.openingHours: one range per weekday in the store's time zone; missing or null is closed. */
export const openingHoursSchema = z.object({
  mon: dayEntry,
  tue: dayEntry,
  wed: dayEntry,
  thu: dayEntry,
  fri: dayEntry,
  sat: dayEntry,
  sun: dayEntry,
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

/** A moment in the store's day, ready to word: "until 9 pm", "opens 11 am tomorrow". */
export const storeMomentSchema = z.object({
  at: instant,
  weekday: weekdaySchema,
  time: clockTimeSchema,
  /** Relative to the time the status was computed for, in the store's time zone. */
  day: z.enum(['today', 'tomorrow', 'later']),
});
export type StoreMoment = z.infer<typeof storeMomentSchema>;

export const footerLinkGroupSchema = z.object({
  title: z.string(),
  links: z.array(z.object({ label: z.string(), href: z.string() })),
});
export type FooterLinkGroup = z.infer<typeof footerLinkGroupSchema>;

export const storeStatusSchema = z.object({
  /** IANA name, for example America/New_York. Show every time in this zone. */
  timeZone: z.string(),
  /** The instant this status was computed for. */
  at: instant,
  /** The store's weekday at that instant, for marking today's row in the hours. */
  today: weekdaySchema,
  isOpen: z.boolean(),
  /** When open: the end of this opening. Null when open around the clock. */
  closesAt: storeMomentSchema.nullable(),
  /** When closed: the next opening. Null when no hours are set. */
  opensAt: storeMomentSchema.nullable(),
  /** Monday first. Null hours: closed that day. */
  weeklyHours: z.array(z.object({ weekday: weekdaySchema, hours: dayHoursSchema.nullable() })),
  store: z.object({
    name: z.string(),
    addressText: z.string(),
    phone: z.string(),
    email: z.string(),
  }),
  /** Footer link groups. Every href is a path on this site or an https URL. */
  footerLinks: z.array(footerLinkGroupSchema),
  delivery: z.object({
    /** The promise shown everywhere: "delivered within 45 minutes". */
    promiseMinutes: z.int().min(1),
    radiusKm: z.number().min(0),
    /** The fee is baseFeeCents + perKmFeeCents per km; "Delivery from" uses baseFeeCents. */
    baseFeeCents: cents,
    perKmFeeCents: cents,
  }),
});
export type StoreStatus = z.infer<typeof storeStatusSchema>;
