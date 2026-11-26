import { z } from 'zod';

/*
 * F9's ratings contract (docs contract §6): tags per star band, the customer's inputs, staff
 * moderation, and the answers for the order page, the Orders list, staff screens and the
 * partner's own summary. Shared with the browser.
 */

export const DISH_TAGS = {
  good: ['tasty', 'fresh', 'good-portion', 'well-packed', 'arrived-hot'],
  bad: ['cold', 'too-salty', 'too-spicy', 'small-portion', 'not-as-described', 'badly-packed'],
} as const;
export const COURIER_TAGS = {
  good: ['friendly', 'on-time', 'careful-with-food', 'followed-instructions'],
  bad: ['late', 'food-damaged', 'ignored-instructions', 'unfriendly'],
} as const;
export type DishTag = (typeof DISH_TAGS)['good' | 'bad'][number];
export type CourierTag = (typeof COURIER_TAGS)['good' | 'bad'][number];

export const TAG_WORDS: Record<DishTag | CourierTag, string> = {
  tasty: 'Tasty',
  fresh: 'Fresh',
  'good-portion': 'Good portion',
  'well-packed': 'Well packed',
  'arrived-hot': 'Arrived hot',
  cold: 'Cold',
  'too-salty': 'Too salty',
  'too-spicy': 'Too spicy',
  'small-portion': 'Small portion',
  'not-as-described': 'Not as described',
  'badly-packed': 'Badly packed',
  friendly: 'Friendly',
  'on-time': 'On time',
  'careful-with-food': 'Careful with the food',
  'followed-instructions': 'Followed my instructions',
  late: 'Late',
  'food-damaged': 'Food spilled or damaged',
  'ignored-instructions': "Didn't follow my instructions",
  unfriendly: 'Unfriendly',
};

export const STAR_WORDS = { 1: 'Bad', 2: 'Poor', 3: 'OK', 4: 'Good', 5: 'Great' } as const;
export type Stars = keyof typeof STAR_WORDS;

export const RATING_RULES = {
  windowDays: 7,
  reminderMinutes: 60,
  commentMax: 500,
  courierShownAt: 5,
  partnerTagDays: 30,
  partnerTagMinRatings: 5,
  partnerLagDays: 1,
  staffPageSize: 20,
} as const;

export const RATING_ERRORS = {
  nothingPicked: 'Pick at least one star rating first.',
  demoComment: 'Comments are turned off in the demo.',
  noCourier: 'This order had no courier to rate.',
  tags: 'Pick tags from the list for these stars.',
  dish: 'That dish is not on this order.',
  note: 'Add a note about why.',
  reason: 'Choose a reason.',
} as const;

/** V2.1: line breaks kept as LF, other control characters removed, trimmed; empty is none. */
export function cleanComment(value: string): string | null {
  const cleaned = value
    .replaceAll(/\r\n?/g, '\n')
    // oxlint-disable-next-line no-control-regex -- removing control characters is the point
    .replaceAll(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
  return cleaned === '' ? null : cleaned;
}

/** The tag set for a row and its stars: 4–5 "What was good?", 1–3 "What could be better?". */
export function tagsFor(row: 'dish' | 'courier', stars: number): readonly string[] {
  const sets = row === 'dish' ? DISH_TAGS : COURIER_TAGS;
  return stars >= 4 ? sets.good : sets.bad;
}

const stars = z.int().min(1).max(5);
const comment = z
  .string()
  .max(2_000)
  .transform(cleanComment)
  .pipe(z.string().max(RATING_RULES.commentMax).nullable())
  .nullable()
  .optional();

function checkTags(row: 'dish' | 'courier') {
  return (value: { stars: number; tags: string[] }, ctx: z.RefinementCtx) => {
    const allowed = tagsFor(row, value.stars);
    if (
      new Set(value.tags).size !== value.tags.length ||
      value.tags.some((tag) => !allowed.includes(tag))
    ) {
      ctx.addIssue({ code: 'custom', path: ['tags'], message: RATING_ERRORS.tags });
    }
  };
}

const dishRating = z
  .object({
    menuItemId: z.uuid(),
    stars,
    tags: z.array(z.string().max(40)).max(11).default([]),
    comment,
  })
  .strict()
  .superRefine(checkTags('dish'));

const courierRating = z
  .object({ stars, tags: z.array(z.string().max(40)).max(8).default([]), comment })
  .strict()
  .superRefine(checkTags('courier'));

export const rateOrderInput = z
  .object({
    orderId: z.uuid(),
    dishes: z.array(dishRating).max(50).default([]),
    courier: courierRating.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dishes.length === 0 && !value.courier) {
      ctx.addIssue({ code: 'custom', path: ['dishes'], message: RATING_ERRORS.nothingPicked });
    }
    const ids = value.dishes.map((dish) => dish.menuItemId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['dishes'], message: RATING_ERRORS.dish });
    }
  });
export type RateOrderInput = z.input<typeof rateOrderInput>;
export type RateOrderValues = z.output<typeof rateOrderInput>;

export const skipRatingInput = z.object({ orderId: z.uuid() }).strict();

export const EXCLUDE_REASONS = ['abusive', 'wrong-subject', 'test-or-duplicate', 'other'] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];

export const excludeRatingInput = z
  .object({
    kind: z.enum(['dish', 'courier']),
    ratingId: z.uuid(),
    reason: z.enum(EXCLUDE_REASONS, { error: RATING_ERRORS.reason }),
    note: z
      .string()
      .max(2_000)
      .transform(cleanComment)
      .pipe(z.string().max(500).nullable())
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'other' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: RATING_ERRORS.note });
    }
  });
export type ExcludeRatingInput = z.input<typeof excludeRatingInput>;

export const includeRatingInput = z
  .object({ kind: z.enum(['dish', 'courier']), ratingId: z.uuid() })
  .strict();

export const partnerRatingsInput = z
  .object({ partnerId: z.uuid(), cursor: z.string().max(100).nullable().catch(null) })
  .strict();

// ------------------------------------------------------------------ answers

export type RatingCardState = 'open' | 'rated' | 'skipped' | 'closed' | 'none';

export interface RatingDishRow {
  menuItemId: string;
  title: string;
  quantity: number;
  imageUrl: string | null;
  stars: Stars | null;
  tags: DishTag[];
  comment: string | null;
  editedAt: string | null;
}

export interface RatingCourierRow {
  firstName: string;
  hasPhoto: boolean;
  stars: Stars | null;
  tags: CourierTag[];
  comment: string | null;
  editedAt: string | null;
}

/** `OrderProgress.rating` (B4). */
export interface OrderRatingView {
  state: RatingCardState;
  editable: boolean;
  closesAt: string | null;
  /** "Fri, Nov 27". */
  closesOnWords: string | null;
  /** "Nov 27". */
  closedOnWords: string | null;
  demo: boolean;
  dishes: RatingDishRow[];
  courier: RatingCourierRow | null;
}

/** `OrderSummary.rating` on the Orders list (S6.1). */
export type OrderRatingFlag = 'rate' | 'rated' | null;

export interface StaffRatingRow {
  kind: 'dish' | 'courier';
  id: string;
  at: string;
  editedAt: string | null;
  orderId: string;
  orderNumber: string;
  customerShort: string;
  subject: string;
  stars: number;
  tags: string[];
  comment: string | null;
  excluded: { reason: ExcludeReason; note: string | null; byName: string; at: string } | null;
  actions: { exclude: boolean; include: boolean; readOnlyDemo: boolean };
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface PartnerRatingsPage {
  partnerId: string;
  hiddenForDemo: boolean;
  summary: {
    average: number | null;
    count: number;
    shownToCustomers: boolean;
    baselineCount: number;
  };
  spread: { stars: 5 | 4 | 3 | 2 | 1; count: number }[];
  tags30d: { liked: TagCount[]; mentioned: TagCount[] };
  rows: StaffRatingRow[];
  total: number;
  nextCursor: string | null;
}

export interface StaffOrderFeedback {
  state: 'open' | 'skipped' | 'closed' | 'cancelled' | 'rated' | 'none';
  closesAt: string | null;
  dishes: { menuItemId: string; title: string; quantity: number; rating: StaffRatingRow | null }[];
  courier: { partnerId: string; name: string; rating: StaffRatingRow | null } | null;
}

export interface PartnerRatingsSummary {
  asOf: string;
  through: string;
  practice: boolean;
  average: number | null;
  count: number;
  shownToCustomers: boolean;
  tagsShown: boolean;
  liked: TagCount[];
  mentioned: TagCount[];
}

export interface ModerationResult {
  id: string;
  kind: 'dish' | 'courier';
  status: 'counted' | 'excluded';
  boardNotice: string;
}
