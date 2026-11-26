import 'server-only';
import { isStaff, type Permission } from '@/server/auth/roles';
import { requirePermission, type UserActor } from '@/server/auth/session';
import { type DbContext, runAs, runAsSystem } from '@/server/db/context';
import { AppError, invalidInput, unauthenticated } from '@/server/errors';
import { inngest } from '@/server/jobs/client';
import { ratingSettled } from '@/server/jobs/earnings-events';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { firstNameOf, shortName } from '@/server/modules/delivery/text';
import { expireMenuCache } from '@/server/modules/menu/cache';
import { notify } from '@/server/modules/notifications/service';
import { getStoreStatus } from '@/server/modules/menu/service';
import { PRACTICE_RATINGS } from '@/server/modules/earnings/rules';
import * as repo from './repo';
import {
  courierShown,
  decodeCursor,
  encodeCursor,
  feedbackState,
  ratingCardState,
  ratingTimings,
  reminderBody,
  splitCourierTags,
} from './rules';
import {
  excludeRatingInput,
  includeRatingInput,
  isCourierTag,
  isDishTag,
  isExcludeReason,
  isStars,
  isTag,
  type ModerationResult,
  type OrderRatingFlag,
  type OrderRatingView,
  type PartnerRatingsPage,
  partnerRatingsInput,
  type PartnerRatingsSummary,
  RATING_ERRORS,
  RATING_RULES,
  rateOrderInput,
  skipRatingInput,
  type StaffOrderFeedback,
  type StaffRatingRow,
  type Stars,
  TAG_WORDS,
} from './schema';

/*
 * F9's ratings (contract §6, §7): the customer's card on the order page, the Orders list flag,
 * rating and skipping, the averages over the seeded baselines, staff moderation and feedback,
 * the partner's own day-behind summary, the one reminder, and account deletion and export.
 */

const MODERATE: Permission = { review: ['moderate'] };
const CREATE: Permission = { review: ['create'] };
const DEMO_READ_ONLY = 'Read-only in the demo';
const SPREAD = [5, 4, 3, 2, 1] as const;
const asStars = (value: number | null | undefined): Stars | null => (isStars(value) ? value : null);

const orderNotFound = () => new AppError('NOT_FOUND', 'Order not found.', 404);
const notACustomer = () => new AppError('NOT_A_CUSTOMER', "Staff accounts can't rate orders.", 403);
const ratingNotFound = () => new AppError('NOT_FOUND', 'Rating not found.', 404);

const shortDay = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
const monthDay = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(date);

const timings = () => ratingTimings(process.env);

async function storeZone(now: Date) {
  return (await getStoreStatus(now)).timeZone;
}

// ------------------------------------------------------------------ the customer's card (S1–S9)

interface ViewDraft {
  view: OrderRatingView;
  courierId: string | null;
  courierRating: Awaited<ReturnType<typeof repo.ownCourierRating>>;
}

/** The card from the customer's own rows, in her transaction; the courier is filled after. */
async function draftIn(
  ctx: DbContext,
  order: repo.OrderForRating,
  isDemo: boolean,
  now: Date,
  timeZone: string,
): Promise<ViewDraft> {
  const dishes = await repo.orderDishes(ctx, order.id);
  const ratings = await repo.ownDishRatings(ctx, order.id);
  const courierRating = await repo.ownCourierRating(ctx, order.id);
  const courierId = await repo.rateableCourier(ctx, order.id);
  const ratedAny = ratings.length > 0 || Boolean(courierRating);
  const card = ratingCardState(
    {
      status: order.status,
      deliveredAt: order.deliveredAt,
      skippedAt: order.ratingSkippedAt,
      ratedAny,
    },
    now,
    timings().windowDays,
  );
  const byDish = new Map(ratings.map((rating) => [rating.menuItemId, rating]));
  const view: OrderRatingView = {
    state: card.state,
    editable: card.editable,
    closesAt: card.closesAt?.toISOString() ?? null,
    closesOnWords: card.closesAt ? shortDay(card.closesAt, timeZone) : null,
    closedOnWords: card.closesAt ? monthDay(card.closesAt, timeZone) : null,
    demo: isDemo,
    dishes:
      card.state === 'none'
        ? []
        : dishes.map((dish) => {
            const rating = byDish.get(dish.menuItemId);
            return {
              menuItemId: dish.menuItemId,
              title: dish.title,
              quantity: dish.quantity,
              imageUrl: dish.image,
              stars: asStars(rating?.rating),
              tags: (rating?.tags ?? []).filter(isDishTag),
              comment: rating?.comment ?? null,
              editedAt: rating?.editedAt?.toISOString() ?? null,
            };
          }),
    courier: null,
  };
  return { view, courierId: card.state === 'none' ? null : courierId, courierRating };
}

/** The courier's first name and photo flag, read as the platform outside her transaction. */
async function finish(draft: ViewDraft): Promise<OrderRatingView> {
  const { courierId, courierRating } = draft;
  if (!courierId) return draft.view;
  const facts = await runAsSystem('rating courier', (system) =>
    repo.courierFacts(system, courierId),
  );
  if (!facts) return draft.view;
  return {
    ...draft.view,
    courier: {
      firstName: firstNameOf(facts.user.name),
      hasPhoto: Boolean(facts.photoUploadId),
      stars: asStars(courierRating?.rating),
      tags: (courierRating?.tags ?? []).filter(isCourierTag),
      comment: courierRating?.comment ?? null,
      editedAt: courierRating?.editedAt?.toISOString() ?? null,
    },
  };
}

/** `OrderProgress.rating` (B4): null for anyone but the order's customer. */
export async function getOrderRatingView(
  actor: UserActor,
  orderId: string,
  now = new Date(),
): Promise<OrderRatingView | null> {
  if (isStaff(actor.role)) return null;
  const timeZone = await storeZone(now);
  const draft = await runAs(actor, async (ctx) => {
    const order = await repo.findOwnOrder(ctx, orderId, actor.userId);
    return order ? draftIn(ctx, order, actor.isDemo, now, timeZone) : null;
  });
  return draft ? finish(draft) : null;
}

/** `OrderSummary.rating` for a page of the Orders list (S6.1). */
export async function orderListFlags(
  actor: UserActor,
  orders: readonly {
    id: string;
    status: string;
    deliveredAt: Date | null;
    ratingSkippedAt: Date | null;
  }[],
  now = new Date(),
): Promise<Map<string, OrderRatingFlag>> {
  const delivered = orders.filter((order) => order.deliveredAt);
  const rated = await runAs(actor, (ctx) =>
    repo.ratedOrderIds(
      ctx,
      delivered.map((order) => order.id),
    ),
  );
  const flags = new Map<string, OrderRatingFlag>();
  for (const order of orders) {
    const { state } = ratingCardState(
      {
        status: order.status,
        deliveredAt: order.deliveredAt,
        skippedAt: order.ratingSkippedAt,
        ratedAny: rated.has(order.id),
      },
      now,
      timings().windowDays,
    );
    flags.set(order.id, state === 'rated' ? 'rated' : state === 'open' ? 'rate' : null);
  }
  return flags;
}

function notOpen(
  why: 'not-delivered' | 'cancelled' | 'closed',
  closedOnWords: string | null,
): AppError {
  const message =
    why === 'closed'
      ? `Ratings for this order closed on ${closedOnWords ?? 'its last day'}.`
      : why === 'cancelled'
        ? 'There are no ratings for cancelled orders.'
        : "You can rate this order once it's delivered.";
  return new AppError('RATING_NOT_OPEN', message, 409, { details: { why, closedOnWords } });
}

async function requireCustomer(actor: UserActor) {
  if (isStaff(actor.role)) throw notACustomer();
  const checked = await requirePermission(CREATE, { write: false });
  if (checked.userId !== actor.userId) throw unauthenticated();
}

function openOrThrow(order: repo.OrderForRating, now: Date, timeZone: string) {
  if (order.status === 'CANCELLED') throw notOpen('cancelled', null);
  if (!order.deliveredAt) throw notOpen('not-delivered', null);
  const card = ratingCardState(
    { status: order.status, deliveredAt: order.deliveredAt, skippedAt: null, ratedAny: false },
    now,
    timings().windowDays,
  );
  if (!card.editable)
    throw notOpen('closed', card.closesAt ? monthDay(card.closesAt, timeZone) : null);
}

const isRlsRefusal = (error: unknown) =>
  error instanceof Error && /row-level security|permission denied|42501/i.test(error.message);

/** S1–S5, V2: rates or edits the dishes and the courier; a repeat changes nothing. */
export async function rateOrder(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<OrderRatingView> {
  const values = rateOrderInput.parse(input);
  await requireCustomer(actor);
  const timeZone = await storeZone(now);
  const pool = actor.isDemo ? 'DEMO' : 'REAL';
  if (
    actor.isDemo &&
    [...values.dishes, ...(values.courier ? [values.courier] : [])].some((row) => row.comment)
  ) {
    throw invalidInput(RATING_ERRORS.demoComment, { comment: [RATING_ERRORS.demoComment] });
  }
  let dishesMoved = false;
  let draft: ViewDraft;
  try {
    draft = await runAs(actor, async (ctx) => {
      const order = await repo.findOwnOrder(ctx, values.orderId, actor.userId);
      if (!order) throw orderNotFound();
      openOrThrow(order, now, timeZone);
      const onOrder = new Set(
        (await repo.orderDishes(ctx, order.id)).map((dish) => dish.menuItemId),
      );
      if (values.dishes.some((dish) => !onOrder.has(dish.menuItemId))) {
        throw invalidInput(RATING_ERRORS.dish, { dishes: [RATING_ERRORS.dish] });
      }
      const courierId = values.courier ? await repo.rateableCourier(ctx, order.id) : null;
      if (values.courier && !courierId) {
        throw invalidInput(RATING_ERRORS.noCourier, { courier: [RATING_ERRORS.noCourier] });
      }
      // One at a time on the transaction, in a fixed order so dish row locks never cross.
      const sorted = values.dishes.toSorted((x, y) => x.menuItemId.localeCompare(y.menuItemId));
      const changedDishes = await sorted.reduce<Promise<string[]>>(async (previous, dish) => {
        const changed = await previous;
        const saved = await repo.upsertDishRating(ctx, {
          orderId: order.id,
          userId: actor.userId,
          menuItemId: dish.menuItemId,
          stars: dish.stars,
          tags: dish.tags,
          comment: dish.comment ?? null,
          pool,
        });
        return saved.changed ? [...changed, dish.menuItemId] : changed;
      }, Promise.resolve([]));
      await changedDishes.reduce(
        (previous, menuItemId) => previous.then(() => repo.recalcDish(ctx, menuItemId)),
        Promise.resolve(),
      );
      dishesMoved = changedDishes.length > 0 && pool === 'REAL';
      if (values.courier && courierId) {
        const saved = await repo.upsertCourierRating(ctx, {
          orderId: order.id,
          userId: actor.userId,
          partnerId: courierId,
          stars: values.courier.stars,
          tags: values.courier.tags,
          comment: values.courier.comment ?? null,
          pool,
        });
        if (saved.changed) await repo.recalcPartner(ctx, courierId);
      }
      return draftIn(ctx, order, actor.isDemo, now, timeZone);
    });
  } catch (error) {
    if (isRlsRefusal(error)) throw notOpen('closed', null);
    throw error;
  }
  if (dishesMoved) expireMenuCache();
  await settle(values.orderId, 'rated');
  return finish(draft);
}

/** S3, V2.2: no reminder for this order; rating later is still allowed. */
export async function skipRating(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<OrderRatingView> {
  const { orderId } = skipRatingInput.parse(input);
  await requireCustomer(actor);
  const timeZone = await storeZone(now);
  const draft = await runAs(actor, async (ctx) => {
    const result = await repo.skipRating(ctx, orderId);
    if (result.outcome === 'not-found') throw orderNotFound();
    if (result.outcome === 'cancelled') throw notOpen('cancelled', null);
    if (result.outcome === 'not-delivered') throw notOpen('not-delivered', null);
    const order = await repo.findOwnOrder(ctx, orderId, actor.userId);
    if (!order) throw orderNotFound();
    if (result.outcome === 'closed') openOrThrow(order, now, timeZone);
    return draftIn(ctx, order, actor.isDemo, now, timeZone);
  });
  await settle(orderId, 'skipped');
  return finish(draft);
}

async function settle(orderId: string, how: 'rated' | 'skipped') {
  try {
    await inngest.send(
      ratingSettled.create(
        { orderId, how, at: new Date().toISOString() },
        { id: `rating-settled-${orderId}-${how}` },
      ),
    );
  } catch (error) {
    // The reminder re-checks the order before it sends, so a lost event only costs a no-op run.
    logger.warn({ err: error, orderId }, 'rating.settled not sent');
  }
}

// ------------------------------------------------------------------ staff (A58, A65)

interface Viewer {
  userId: string;
  isDemo: boolean;
}

async function moderator(actor: UserActor, write: boolean): Promise<Viewer> {
  const checked = await requirePermission(MODERATE, { write, demoMessage: DEMO_READ_ONLY });
  if (checked.userId !== actor.userId) throw unauthenticated();
  return { userId: checked.userId, isDemo: checked.isDemo };
}

const maskName = (name: string) => `${name.trim().charAt(0)}•••`;

function staffRow(record: repo.StaffRatingRecord, viewer: Viewer): StaffRatingRow {
  const excluded = record.status === 'HIDDEN';
  const customer =
    record.customerDeleted || !record.customerName
      ? 'Deleted customer'
      : viewer.isDemo && record.pool === 'REAL'
        ? maskName(record.customerName)
        : shortName(record.customerName);
  return {
    kind: record.kind,
    id: record.id,
    at: record.at.toISOString(),
    editedAt: record.editedAt?.toISOString() ?? null,
    orderId: record.orderId,
    orderNumber: record.orderNumber,
    customerShort: customer,
    subject: record.subject,
    stars: record.stars,
    tags: record.tags,
    comment: viewer.isDemo && record.pool === 'REAL' ? null : record.comment,
    excluded: excluded
      ? {
          reason: isExcludeReason(record.excludedReason) ? record.excludedReason : 'other',
          note: record.excludedNote,
          byName: record.moderatedByName ?? 'Staff member',
          at: (record.moderatedAt ?? record.at).toISOString(),
        }
      : null,
    actions: {
      exclude: !excluded && !viewer.isDemo,
      include: excluded && !viewer.isDemo,
      readOnlyDemo: viewer.isDemo,
    },
  };
}

/** A58.2–A58.4: exclude or include, audited; a race answers who moved it first. */
async function setCounted(
  actor: UserActor,
  input: unknown,
  exclude: boolean,
): Promise<ModerationResult> {
  const values = exclude
    ? excludeRatingInput.parse(input)
    : { ...includeRatingInput.parse(input), reason: null, note: null };
  const viewer = await moderator(actor, true);
  const outcome = await runAs(actor, async (ctx) => {
    const record = await repo.findStaffRating(ctx, values.kind, values.ratingId);
    if (!record) throw ratingNotFound();
    const moved = await repo.moderate(ctx, values.kind, values.ratingId, {
      exclude,
      reason: exclude ? values.reason : null,
      note: exclude ? (values.note ?? null) : null,
      by: viewer.userId,
    });
    if (!moved) {
      const now = await repo.findStaffRating(ctx, values.kind, values.ratingId);
      return { moved: false as const, record: now ?? record };
    }
    if (values.kind === 'dish') await repo.recalcDish(ctx, record.subjectId);
    else await repo.recalcPartner(ctx, record.subjectId);
    await audit(ctx, {
      action: exclude ? 'rating.excluded' : 'rating.included',
      targetType: values.kind === 'dish' ? 'review' : 'partner-rating',
      targetId: record.id,
      data: {
        kind: values.kind,
        orderId: record.orderId,
        subjectId: record.subjectId,
        reason: exclude ? values.reason : null,
        hasNote: Boolean(exclude && values.note),
      },
    });
    return { moved: true as const, record };
  });
  const { record } = outcome;
  if (!outcome.moved) {
    const by = record.moderatedByName ?? 'Someone';
    const message = exclude
      ? `${by} excluded this rating a moment ago.`
      : `${by} included this rating again a moment ago.`;
    throw new AppError('RATING_CHANGED', message, 409, {
      details: {
        byName: by,
        at: record.moderatedAt?.toISOString() ?? null,
        status: record.status === 'HIDDEN' ? 'excluded' : 'counted',
      },
    });
  }
  if (values.kind === 'dish') expireMenuCache();
  const subject = values.kind === 'dish' ? record.subject : shortName(record.subject);
  return {
    id: record.id,
    kind: values.kind,
    status: exclude ? 'excluded' : 'counted',
    boardNotice: exclude
      ? `Rating excluded from ${subject}'s average.`
      : `Rating counts toward ${subject}'s average again.`,
  };
}

export const excludeRating = (actor: UserActor, input: unknown) => setCounted(actor, input, true);
export const includeRating = (actor: UserActor, input: unknown) => setCounted(actor, input, false);

/** The partner page's Ratings section (A58.1). */
export async function getPartnerRatings(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<PartnerRatingsPage | null> {
  const { partnerId, cursor } = partnerRatingsInput.parse(input);
  const viewer = await moderator(actor, false);
  // The demo admin can't read partner rows: a demo partner's figures come from the platform.
  const [demoFigures] = viewer.isDemo
    ? await runAsSystem('demo partner ratings', (system) => repo.partnerFigures(system, partnerId))
    : [];
  return runAs(actor, async (ctx) => {
    const [figures] = await repo.partnerFigures(ctx, partnerId);
    if (!figures) return null;
    const empty: PartnerRatingsPage = {
      partnerId,
      hiddenForDemo: true,
      summary: { average: null, count: 0, shownToCustomers: false, baselineCount: 0 },
      spread: SPREAD.map((stars) => ({ stars, count: 0 })),
      tags30d: { liked: [], mentioned: [] },
      rows: [],
      total: 0,
      nextCursor: null,
    };
    if (viewer.isDemo && !figures.isDemo) return empty;
    const average = demoFigures?.ratingAvg ?? figures.ratingAvg;
    const count = demoFigures?.ratingCount ?? figures.ratingCount;
    const stats = await repo.partnerRatingStats(
      ctx,
      partnerId,
      new Date(now.getTime() - RATING_RULES.partnerTagDays * 86_400_000),
    );
    const records = await repo.partnerRatingRows(
      ctx,
      partnerId,
      decodeCursor(cursor),
      RATING_RULES.staffPageSize + 1,
    );
    const page = records.slice(0, RATING_RULES.staffPageSize);
    const last = page.at(-1);
    return {
      partnerId,
      hiddenForDemo: false,
      summary: {
        average: count > 0 ? average : null,
        count,
        shownToCustomers: courierShown(count),
        baselineCount: figures.baseCount,
      },
      spread: SPREAD.map((stars) => ({
        stars,
        count: stats.spread.find((entry) => entry.stars === stars)?.count ?? 0,
      })),
      tags30d: splitCourierTags(stats.tags),
      rows: page.map((record) => staffRow(record, viewer)),
      total: stats.total,
      nextCursor: records.length > page.length && last ? encodeCursor(last.at, last.id) : null,
    };
  });
}

/**
 * The order detail's "Customer feedback" (A65) for SUPPORT and ADMIN, in the board's own
 * transaction; the demo admin sees demo orders only. Never called for the kitchen.
 */
export async function staffOrderFeedbackIn(
  ctx: DbContext,
  viewer: { isDemo: boolean },
  orderId: string,
  now: Date,
): Promise<StaffOrderFeedback | null> {
  const order = await repo.findOrderForStaff(ctx, orderId);
  if (!order || (viewer.isDemo && !order.user.isDemo)) return null;
  const records = await repo.orderRatingRecords(ctx, orderId);
  const dishes = await repo.orderDishes(ctx, orderId);
  const courier = await repo.deliveredCourier(ctx, orderId);
  const asViewer: Viewer = { userId: '', isDemo: viewer.isDemo };
  const state = feedbackState(
    {
      status: order.status,
      deliveredAt: order.deliveredAt,
      skippedAt: order.ratingSkippedAt,
      ratedAny: records.length > 0,
    },
    now,
    timings().windowDays,
  );
  const closesAt = order.deliveredAt
    ? new Date(order.deliveredAt.getTime() + timings().windowDays * 86_400_000).toISOString()
    : null;
  return {
    state,
    closesAt,
    dishes: dishes.map((dish) => {
      const record = records.find(
        (entry) => entry.kind === 'dish' && entry.subjectId === dish.menuItemId,
      );
      return {
        menuItemId: dish.menuItemId,
        title: dish.title,
        quantity: dish.quantity,
        rating: record ? staffRow(record, asViewer) : null,
      };
    }),
    courier: courier
      ? {
          partnerId: courier.partnerId,
          name: courier.name,
          rating: (() => {
            const record = records.find((entry) => entry.kind === 'courier');
            return record ? staffRow(record, asViewer) : null;
          })(),
        }
      : null,
  };
}

// ------------------------------------------------------------------ the partner (P58, V8)

/** `GET /api/v1/partner/ratings/summary`: up to the end of yesterday, never one rating. */
export async function getMyRatingsSummary(
  actor: UserActor,
  now = new Date(),
): Promise<PartnerRatingsSummary> {
  return runAs(actor, async (ctx) => {
    const lagDays = timings().partnerLagDays;
    const startOfToday = await repo.startOfToday(ctx);
    const before =
      lagDays === 0 ? now : new Date(startOfToday.getTime() - (lagDays - 1) * 86_400_000);
    const tagsSince = new Date(before.getTime() - RATING_RULES.partnerTagDays * 86_400_000);
    if (actor.isDemo) {
      return {
        asOf: now.toISOString(),
        through: before.toISOString(),
        practice: true,
        average: PRACTICE_RATINGS.average,
        count: PRACTICE_RATINGS.count,
        shownToCustomers: true,
        tagsShown: true,
        liked: [...PRACTICE_RATINGS.liked],
        mentioned: [...PRACTICE_RATINGS.mentioned],
      };
    }
    const summary = await repo.mySummary(ctx, before, tagsSince);
    if (!summary)
      throw new AppError('NOT_APPROVED', 'Your partner account is not approved to deliver.', 403);
    const tags = splitCourierTags(summary.tags);
    return {
      asOf: now.toISOString(),
      through: before.toISOString(),
      practice: false,
      average: summary.average,
      count: summary.count,
      shownToCustomers: courierShown(summary.count),
      tagsShown: summary.tagsShown,
      liked: tags.liked,
      mentioned: tags.mentioned,
    };
  });
}

/** The day-behind figure for F6's home and Profile (V8): null means "New partner". */
export async function partnerRatingLineIn(
  ctx: DbContext,
  now: Date,
): Promise<{ average: number; count: number } | null> {
  const startOfToday = await repo.startOfToday(ctx);
  const lagDays = timings().partnerLagDays;
  const before =
    lagDays === 0 ? now : new Date(startOfToday.getTime() - (lagDays - 1) * 86_400_000);
  const summary = await repo.mySummary(ctx, before, before);
  if (!summary || summary.count === 0 || summary.average === null) return null;
  return { average: summary.average, count: summary.count };
}

// ------------------------------------------------------------------ the reminder (S4, V6)

/** Run by the job 60 minutes after delivery: one in-app notice when every S4.2 rule holds. */
export async function sendRatingReminder(orderId: string): Promise<'sent' | 'skipped'> {
  const claimed = await runAsSystem('rating reminder', async (ctx) => {
    const order = await repo.claimReminder(ctx, orderId, timings().windowDays);
    if (!order) return null;
    const dishes = await repo.orderDishes(ctx, orderId);
    const courierName = await repo.courierFirstNameForOrder(ctx, orderId);
    return {
      ...order,
      dishes: dishes.map((dish) => dish.title),
      courier: courierName ? firstNameOf(courierName) : null,
    };
  });
  if (!claimed) return 'skipped';
  await notify({
    userId: claimed.userId,
    type: 'order.rate-reminder',
    title: `How was order ${claimed.number}?`,
    body: reminderBody(claimed.dishes, claimed.courier),
    link: `/orders/${orderId}#rate`,
    order: { orderId, orderNumber: claimed.number, status: 'rate' },
  });
  return 'sent';
}

// ------------------------------------------------------------------ account data (V9)

/** F2 deletion: stars stay in the averages, unlinked; comments go. In the deletion's transaction. */
export function unlinkRatingsIn(ctx: DbContext): Promise<number> {
  return repo.unlinkOwnRatings(ctx);
}

/** F2 "Download my data": her own ratings with their words. */
export async function ratingsExportIn(ctx: DbContext, userId: string) {
  return (await repo.ratingsForExport(ctx, userId)).map((row) => ({
    orderNumber: row.orderNumber,
    about: row.kind === 'dish' ? row.subject : 'Courier',
    stars: row.stars,
    tags: row.tags.map((tag) => (isTag(tag) ? TAG_WORDS[tag] : tag)),
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  }));
}
