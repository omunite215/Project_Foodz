import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { displayPhone } from '@/lib/phone';
import { can, isStaff, type Permission } from '@/server/auth/roles';
import { requirePermission, type UserActor } from '@/server/auth/session';
import { type DbContext, runAs, runAsSystem } from '@/server/db/context';
import type { DeliveryStatus } from '@/server/db/enums';
import { AppError, forbidden, notFound, unauthenticated } from '@/server/errors';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { redis } from '@/server/redis';
import { presignDownload } from '@/server/storage/s3';
import type { TurnResult } from '@/server/jobs/dispatch-run';
import { type DispatchEffect, runDispatchEffects } from './effects';
import * as repo from './repo';
import type { DeliveryRow, DispatchOrderRow, OfferRowData } from './repo';
import {
  allocateOldestFirst,
  countersAfter,
  courierStateOf,
  customerStateOf,
  dispatchTimings,
  listedEnding,
  offerPay,
  reachesToTry,
  reachMeters,
  searchStep,
} from './rules';
import type {
  AcceptResult,
  AssignableCourier,
  AssignableCouriers,
  BoardCourier,
  CouriersCount,
  CurrentOffer,
  CustomerDispatchView,
  DispatchRefusalDetails,
  DispatchTimings,
  OfferDetail,
  OfferEnding,
  OfferRow,
  PartnerDelivery,
  PartnerDispatchState,
  StaffCourierSection,
  StaffDispatchResult,
} from './schema';
import {
  assignableCouriersInput,
  courierPhotoInput,
  deliveryIdParam,
  giveBackInput,
  MISS_LIMIT,
  OFFER_GONE_WHY,
  offerDeclineInput,
  offerIdParam,
  offerLateAcceptInput,
  REACHES_KM,
  restartSearchInput,
  sendStaffOfferInput,
  takeOffCourierInput,
} from './schema';
import {
  courierLineWords,
  courierVehicle,
  firstNameOf,
  fromKitchenWords,
  km,
  offerWords,
  outcomeWords,
  shortName,
  waitingWords,
} from './text';

/*
 * Dispatch (F7). Partners answer offers through the database's definer functions as
 * themselves; staff act as themselves under row-level security and the guard triggers, with an
 * audit row in the same transaction; the dispatch run and the F5/F6 hooks act as the platform.
 * Every cut-off is the database's clock. Realtime messages and jobs run after commit.
 */

const timings = (): DispatchTimings => dispatchTimings(process.env);
const ACTIVE: ReadonlySet<DeliveryStatus> = new Set(['ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP']);
const BEFORE_PICKUP: ReadonlySet<DeliveryStatus> = new Set(['ASSIGNED', 'AT_RESTAURANT']);
const isActive = (status: DeliveryStatus) => ACTIVE.has(status);
const DEMO_CANNOT = 'Read-only in the demo';
const PHOTO_SECONDS = 300;
const RELEASE_NOTICE_MS = 30 * 60_000;
const GIVE_BACK_ALERT_AT = 10;
const LATE_ACCEPT_ALERT_AT = 5;
const DAY_MS = 24 * 60 * 60_000;
const ASSIGN = { delivery: ['assign'] } as const satisfies Permission;
const ASSIGN_READ = { order: ['read-any'], delivery: ['assign'] } as const satisfies Permission;

// ------------------------------------------------------------------ refusals

function refusal<K extends keyof DispatchRefusalDetails>(
  code: K,
  message: string,
  status: number,
  details: DispatchRefusalDetails[K],
): AppError {
  return new AppError(code, message, status, { details: { ...details } });
}

const GONE_MESSAGES: Record<(typeof OFFER_GONE_WHY)[number], string> = {
  expired: 'This offer ended.',
  withdrawn: 'This offer was withdrawn.',
  taken: 'Another partner took this order.',
  'order-changed': 'This order changed, so the offer was withdrawn.',
};

const offerGone = (why: (typeof OFFER_GONE_WHY)[number]) =>
  refusal('OFFER_GONE', GONE_MESSAGES[why], 409, { why });

const offerNotFound = () => notFound('Offer not found.');
const orderNotFound = () => notFound('Order not found.');

const notApproved = () =>
  new AppError('NOT_APPROVED', 'Your partner account is not approved to deliver.', 403);

const partnerBusy = (orderNumber: string, message?: string) =>
  refusal(
    'PARTNER_BUSY',
    message ?? `You're on order ${orderNumber}. Finish or give it back first.`,
    409,
    { orderNumber },
  );

const invalidState = (message: string, details: Record<string, unknown>) =>
  new AppError('INVALID_STATE', message, 409, { details });

// ------------------------------------------------------------------ outcomes of the definer functions

const goneWhy = z.enum(OFFER_GONE_WHY);
const acceptOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.enum(['accepted', 'replayed']),
    deliveryId: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    version: z.number(),
  }),
  z.object({ outcome: z.literal('gone'), why: goneWhy }),
  z.object({ outcome: z.literal('not-offerable'), why: z.literal('offline') }),
  z.object({ outcome: z.literal('busy'), orderNumber: z.string() }),
  z.object({ outcome: z.literal('not-found') }),
]);
const declineOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('declined'),
    deliveryId: z.string(),
    orderId: z.string(),
    version: z.number(),
  }),
  z.object({ outcome: z.literal('replayed'), deliveryId: z.string(), orderId: z.string() }),
  z.object({ outcome: z.literal('gone'), why: goneWhy }),
  z.object({ outcome: z.literal('not-found') }),
]);
const seenOutcome = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('seen'), seenAt: z.string() }),
  z.object({ outcome: z.literal('not-found') }),
]);
const lateOutcome = z.object({ outcome: z.enum(['recorded', 'ignored', 'not-found']) });
const giveBackOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('gave-back'),
    deliveryId: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    version: z.number(),
    partnerId: z.string(),
  }),
  z.object({
    outcome: z.literal('closed'),
    status: z.enum([
      'SEARCHING',
      'ASSIGNED',
      'AT_RESTAURANT',
      'PICKED_UP',
      'DELIVERED',
      'CANCELLED',
    ]),
  }),
  z.object({ outcome: z.literal('not-assigned') }),
]);

// ------------------------------------------------------------------ the partner

interface Me {
  id: string;
  isDemo: boolean;
  unseenInRow: number;
}

/** The session's partner, approved; the session decides who it is (never the input). */
async function partnerOf(actor: UserActor): Promise<Me> {
  if (isStaff(actor.role))
    throw new AppError('NOT_A_CUSTOMER', "Staff accounts can't use the partner app.", 403);
  const partnerId = await runAs(actor, (ctx) => repo.findPartnerIdOfUser(ctx, actor.userId));
  if (!partnerId) throw notApproved();
  const row = await runAsSystem('partner dispatch state', (ctx) =>
    repo.findPartnerForDispatch(ctx, partnerId),
  );
  if (!row) throw notApproved();
  if (row.status === 'SUSPENDED') {
    throw new AppError('PARTNER_SUSPENDED', 'Your partner account has been suspended.', 403);
  }
  if (row.status !== 'APPROVED' || !can(actor.role, { partner: ['deliver'] })) throw notApproved();
  return { id: row.id, isDemo: row.isDemo, unseenInRow: row.unseenInRow };
}

function detailOf(offer: OfferRowData, order: DispatchOrderRow, seconds: number): OfferDetail {
  const words = offerWords({
    kind: offer.kind,
    payCents: offer.payCents,
    tipCents: offer.tipCents,
    pickupM: offer.pickupM,
    dropoffCity: order.addressCity,
    dropoffM: order.dropoffM,
    items: order.items,
    cashTotalCents: order.paymentMethod === 'CASH' ? order.totalCents : null,
  });
  return {
    offerId: offer.id,
    kind: offer.kind,
    expiresAt: offer.expiresAt.toISOString(),
    totalSeconds: seconds,
    payCents: offer.payCents,
    ...words,
    seen: offer.seenAt !== null,
  };
}

/** The card's data, read by the platform once the partner's own read proved the offer is his. */
async function offerDetailFor(offer: OfferRowData): Promise<OfferDetail | null> {
  const t = timings();
  const order = await runAsSystem('offer detail', async (ctx) => {
    const delivery = await repo.findDelivery(ctx, offer.deliveryId);
    return delivery ? repo.findOrderForDispatch(ctx, delivery.orderId) : null;
  });
  if (!order) return null;
  return detailOf(offer, order, offer.kind === 'staff' ? t.staffOfferSeconds : t.offerSeconds);
}

// ------------------------------------------------------------------ practice offers (P34, W12.2)

const practiceKey = (sessionId: string) => `dispatch:practice:${sessionId}`;
const storedPractice = z.object({
  offerId: z.uuid(),
  expiresAt: z.iso.datetime(),
  seenAt: z.iso.datetime().nullable(),
});
type StoredPractice = z.infer<typeof storedPractice>;

async function readPractice(sessionId: string | null): Promise<StoredPractice | null> {
  if (!sessionId) return null;
  const raw = await redis.get(practiceKey(sessionId));
  if (!raw) return null;
  const parsed = storedPractice.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

function practiceDetail(practice: StoredPractice): OfferDetail {
  const t = timings();
  const words = offerWords({
    kind: 'practice',
    payCents: 564,
    tipCents: 300,
    pickupM: 0,
    dropoffCity: 'Boston, MA 02109',
    dropoffM: 1300,
    items: 3,
    cashTotalCents: null,
  });
  return {
    offerId: practice.offerId,
    kind: 'practice',
    expiresAt: practice.expiresAt,
    totalSeconds: t.offerSeconds,
    payCents: 564,
    ...words,
    seen: practice.seenAt !== null,
  };
}

async function practiceFor(actor: UserActor, me: Me, offerId: string, sessionId: string | null) {
  if (!me.isDemo) return null;
  const practice = await readPractice(sessionId);
  return practice?.offerId === offerId ? practice : null;
}

/** P34: the demo partner tries the offer card. Never in the delivery tables or on private-ops. */
export async function sendPracticeOffer(
  actor: UserActor,
  sessionId: string | null,
  now = new Date(),
): Promise<CurrentOffer> {
  const me = await partnerOf(actor);
  if (!me.isDemo) {
    throw refusal('DEMO_POOL', 'Practice offers are for the demo partner.', 403, { pool: 'REAL' });
  }
  if (!sessionId) throw unauthenticated();
  const open = await readPractice(sessionId);
  if (open && Date.parse(open.expiresAt) > now.getTime()) {
    throw refusal('PRACTICE_OPEN', 'Answer the practice offer on screen first.', 409, {
      offerId: open.offerId,
    });
  }
  const t = timings();
  const practice: StoredPractice = {
    offerId: uuidv7(),
    expiresAt: new Date(now.getTime() + t.offerSeconds * 1000).toISOString(),
    seenAt: null,
  };
  await redis.set(
    practiceKey(sessionId),
    JSON.stringify(practice),
    'EX',
    t.offerSeconds + t.graceSeconds,
  );
  return { offer: practiceDetail(practice), serverTime: now.toISOString() };
}

// ------------------------------------------------------------------ partner routes

/** `GET /api/v1/partner/offers/current` (P28.6). A fetch also proves the app is alive (W7.4). */
export async function getCurrentOffer(
  actor: UserActor,
  sessionId: string | null,
): Promise<CurrentOffer> {
  const me = await partnerOf(actor);
  const serverTime = await runAsSystem('server time', repo.databaseNow);
  if (me.isDemo) {
    const practice = await readPractice(sessionId);
    const live = practice && Date.parse(practice.expiresAt) > serverTime.getTime();
    return { offer: live ? practiceDetail(practice) : null, serverTime: serverTime.toISOString() };
  }
  const offer = await runAs(actor, (ctx) => repo.findOpenOfferOfPartner(ctx, me.id));
  if (me.unseenInRow > 0) {
    await runAsSystem('offers fetch', (ctx) => repo.clearUnseen(ctx, me.id));
  }
  return {
    offer: offer ? await offerDetailFor(offer) : null,
    serverTime: serverTime.toISOString(),
  };
}

/** `GET /api/v1/partner/offers/{id}`: 404 for anything not his and open (P33.1). */
export async function getOffer(
  actor: UserActor,
  rawOfferId: string,
  sessionId: string | null = null,
): Promise<OfferDetail> {
  const { offerId } = offerIdParam.parse({ offerId: rawOfferId });
  const me = await partnerOf(actor);
  const practice = await practiceFor(actor, me, offerId, sessionId);
  if (practice) return practiceDetail(practice);
  const offer = await runAs(actor, (ctx) => repo.findOffer(ctx, offerId));
  if (offer?.partnerId !== me.id || offer.status !== 'PENDING') throw offerNotFound();
  const detail = await offerDetailFor(offer);
  if (!detail) throw offerNotFound();
  return detail;
}

/** `POST /api/v1/partner/offers/{id}/seen` (W7.4). */
export async function markOfferSeen(
  actor: UserActor,
  rawOfferId: string,
  sessionId: string | null = null,
): Promise<{ seenAt: string }> {
  const { offerId } = offerIdParam.parse({ offerId: rawOfferId });
  const me = await partnerOf(actor);
  const practice = await practiceFor(actor, me, offerId, sessionId);
  if (practice) return { seenAt: practice.seenAt ?? new Date().toISOString() };
  const result = seenOutcome.parse(await runAs(actor, (ctx) => repo.markOfferSeen(ctx, offerId)));
  if (result.outcome === 'not-found') throw offerNotFound();
  // The database keeps UTC without a zone (`app_now()`), so its JSON text has none: read it as UTC.
  const zoned = /(?:Z|[+-]\d\d:?\d\d)$/.test(result.seenAt) ? result.seenAt : `${result.seenAt}Z`;
  return { seenAt: new Date(zoned).toISOString() };
}

/** `POST /api/v1/partner/offers/{id}/accept` (P22, W6): atomic in the database. */
export async function acceptOffer(
  actor: UserActor,
  rawOfferId: string,
  sessionId: string | null = null,
): Promise<AcceptResult> {
  const { offerId } = offerIdParam.parse({ offerId: rawOfferId });
  const me = await partnerOf(actor);
  const practice = await practiceFor(actor, me, offerId, sessionId);
  if (practice && sessionId) {
    await redis.del(practiceKey(sessionId));
    return { deliveryId: practice.offerId, orderNumber: 'practice', replayed: false };
  }
  const t = timings();
  const result = acceptOutcome.parse(
    await runAs(actor, (ctx) => repo.acceptOffer(ctx, offerId, t.graceSeconds)),
  );
  switch (result.outcome) {
    case 'not-found':
      throw offerNotFound();
    case 'gone':
      throw offerGone(result.why);
    case 'not-offerable':
      throw refusal('NOT_OFFERABLE', "You're offline. Go online to take orders.", 409, {
        why: 'offline',
      });
    case 'busy':
      throw partnerBusy(result.orderNumber);
    default:
      break;
  }
  if (result.outcome === 'accepted') {
    const at = new Date();
    await runDispatchEffects([
      {
        kind: 'offerEnded',
        offerId,
        deliveryId: result.deliveryId,
        orderId: result.orderId,
        partnerId: me.id,
        ending: 'accepted',
        tellPartner: false,
        at,
      },
      {
        kind: 'changed',
        orderId: result.orderId,
        status: 'ASSIGNED',
        version: result.version,
        partnerIds: [me.id],
        at,
      },
    ]);
    logger.info({ offerId, deliveryId: result.deliveryId, partnerId: me.id }, 'offer accepted');
  }
  return {
    deliveryId: result.deliveryId,
    orderNumber: result.orderNumber,
    replayed: result.outcome === 'replayed',
  };
}

/** `POST /api/v1/partner/offers/{id}/decline` (P23): no reason; not offered this order again. */
export async function declineOffer(
  actor: UserActor,
  rawOfferId: string,
  input: unknown,
  sessionId: string | null = null,
): Promise<{ declined: true }> {
  const { offerId } = offerIdParam.parse({ offerId: rawOfferId });
  const body = offerDeclineInput.parse(input ?? {});
  const me = await partnerOf(actor);
  const practice = await practiceFor(actor, me, offerId, sessionId);
  if (practice && sessionId) {
    await redis.del(practiceKey(sessionId));
    return { declined: true };
  }
  const t = timings();
  const pressedAt = body.pressedAt ? new Date(body.pressedAt) : null;
  const result = declineOutcome.parse(
    await runAs(actor, (ctx) => repo.declineOffer(ctx, offerId, pressedAt, t.graceSeconds)),
  );
  if (result.outcome === 'not-found') throw offerNotFound();
  if (result.outcome === 'gone') throw offerGone(result.why);
  if (result.outcome === 'declined') {
    const at = new Date();
    await runDispatchEffects([
      {
        kind: 'offerEnded',
        offerId,
        deliveryId: result.deliveryId,
        orderId: result.orderId,
        partnerId: me.id,
        ending: 'declined',
        tellPartner: false,
        at,
      },
      {
        kind: 'changed',
        orderId: result.orderId,
        status: 'SEARCHING',
        version: result.version,
        partnerIds: [],
        at,
      },
    ]);
  }
  return { declined: true };
}

/** `POST /api/v1/partner/offers/{id}/late-accept` (P28.2): recorded, never assigns. */
export async function recordLateAccept(
  actor: UserActor,
  rawOfferId: string,
  input: unknown,
): Promise<{ recorded: boolean }> {
  const { offerId } = offerIdParam.parse({ offerId: rawOfferId });
  const { pressedAt } = offerLateAcceptInput.parse(input);
  const me = await partnerOf(actor);
  const result = lateOutcome.parse(
    await runAs(actor, (ctx) => repo.recordLateAccept(ctx, offerId, new Date(pressedAt))),
  );
  if (result.outcome === 'not-found') throw offerNotFound();
  if (result.outcome === 'recorded') {
    const since = new Date(Date.now() - 60 * 60_000);
    const count = await runAsSystem('late accepts', (ctx) =>
      repo.countLateAccepts(ctx, me.id, since),
    );
    if (count === LATE_ACCEPT_ALERT_AT) {
      logger.error(
        { partnerId: me.id, alert: 'partner-late-accepts' },
        'five late accepts by one partner within an hour',
      );
    }
  }
  return { recorded: result.outcome === 'recorded' };
}

/** `GET /api/v1/partner/deliveries/current` (P29): only while he holds the order. */
export async function getCurrentDelivery(actor: UserActor): Promise<PartnerDelivery | null> {
  const me = await partnerOf(actor);
  return runAsSystem('partner delivery', async (ctx) => {
    const active = await repo.findActiveDeliveryOfPartner(ctx, me.id);
    if (!active) return null;
    const delivery = await repo.findDelivery(ctx, active.deliveryId);
    const order = await repo.findOrderForDispatch(ctx, active.orderId);
    const kitchen = await repo.findKitchen(ctx);
    if (!delivery || !order || !kitchen) return null;
    const words = offerWords({
      kind: 'auto',
      payCents: delivery.partnerFeeCents,
      tipCents: delivery.tipCents,
      pickupM: 0,
      dropoffCity: order.addressCity,
      dropoffM: order.dropoffM,
      items: order.items,
      cashTotalCents: order.paymentMethod === 'CASH' ? order.totalCents : null,
    });
    const status =
      active.status === 'PICKED_UP' || active.status === 'AT_RESTAURANT'
        ? active.status
        : 'ASSIGNED';
    return {
      deliveryId: delivery.id,
      status,
      version: delivery.version,
      orderNumber: order.number,
      payText: words.payText,
      tipText: words.tipText,
      payment: words.payment,
      itemsText: words.itemsText,
      dropoffText: `Then: ${words.dropoffText}`,
      kitchen: {
        name: kitchen.storeName,
        addressText: kitchen.addressText,
        point: { lat: kitchen.lat, lng: kitchen.lng },
        phone: kitchen.contactPhone,
      },
      // The customer's details only once the food is in hand (P29.6, U11).
      dropoff:
        status === 'PICKED_UP'
          ? {
              firstName: firstNameOf(order.contactName),
              addressText: order.addressText,
              instructions: order.courierInstructions,
              point: { lat: order.addressLat, lng: order.addressLng },
            }
          : null,
      canGiveBack: BEFORE_PICKUP.has(status),
    } satisfies PartnerDelivery;
  });
}

async function afterGiveBack(
  result: Extract<z.infer<typeof giveBackOutcome>, { outcome: 'gave-back' }>,
) {
  const at = new Date();
  await runDispatchEffects([
    {
      kind: 'changed',
      orderId: result.orderId,
      status: 'SEARCHING',
      version: result.version,
      partnerIds: [result.partnerId],
      at,
    },
    { kind: 'restart', orderId: result.orderId, at },
    {
      kind: 'assignmentEnded',
      deliveryId: result.deliveryId,
      orderId: result.orderId,
      partnerId: result.partnerId,
      how: 'gave-back',
      version: result.version,
      at,
    },
  ]);
  const count = await runAsSystem('give-back count', (ctx) =>
    repo.countGiveBacks(ctx, result.partnerId, new Date(at.getTime() - DAY_MS)),
  );
  if (count === GIVE_BACK_ALERT_AT) {
    logger.error(
      { partnerId: result.partnerId, alert: 'partner-give-backs' },
      'ten orders given back by one partner within a day',
    );
  }
}

/** `POST /api/v1/partner/deliveries/{id}/give-back` (P30). */
export async function giveBack(
  actor: UserActor,
  rawDeliveryId: string,
  input: unknown,
): Promise<{ gaveBack: true }> {
  const { deliveryId } = deliveryIdParam.parse({ deliveryId: rawDeliveryId });
  const { reason } = giveBackInput.parse(input);
  await partnerOf(actor);
  const result = giveBackOutcome.parse(
    await runAs(actor, (ctx) => repo.giveBack(ctx, deliveryId, reason)),
  );
  if (result.outcome === 'not-assigned') {
    throw refusal('NOT_ASSIGNED', "This order isn't yours any more.", 409, { deliveryId });
  }
  if (result.outcome === 'closed') {
    throw refusal(
      'GIVE_BACK_CLOSED',
      "You've picked this order up, so it can't be given back. Call Foodz Kitchen.",
      409,
      { status: result.status },
    );
  }
  await afterGiveBack(result);
  return { gaveBack: true };
}

/**
 * "Give back and go offline" (P30.4): the partner's current order goes back before the partner
 * goes offline. False when there was nothing to give back.
 */
export async function giveBackCurrent(actor: UserActor, partnerId: string): Promise<boolean> {
  const active = await activeDeliveryOf(partnerId);
  if (!active) return false;
  if (!BEFORE_PICKUP.has(active.status)) throw partnerBusy(active.orderNumber);
  const result = giveBackOutcome.parse(
    await runAs(actor, (ctx) => repo.giveBack(ctx, active.deliveryId, 'other')),
  );
  if (result.outcome !== 'gave-back') return false;
  await afterGiveBack(result);
  return true;
}

/** The order a partner holds, if any (F6's offline, delete and suspend checks). */
export async function activeDeliveryOf(partnerId: string) {
  return runAsSystem('partner active delivery', (ctx) =>
    repo.findActiveDeliveryOfPartner(ctx, partnerId),
  );
}

/** F6's home gains the dispatch state (design "[BE] needs"). */
export async function partnerDispatchState(
  partnerId: string,
  now = new Date(),
): Promise<PartnerDispatchState> {
  const t = timings();
  const { partner, active } = await runAsSystem('partner dispatch state', async (ctx) => ({
    partner: await repo.findPartnerForDispatch(ctx, partnerId),
    active: await repo.findActiveDeliveryOfPartner(ctx, partnerId),
  }));
  const staleAt =
    partner?.isOnline && !partner.isDemo && partner.lastPointAt
      ? new Date(partner.lastPointAt.getTime() + t.freshPointSeconds * 1000)
      : null;
  const released =
    partner?.releasedKind &&
    partner.releasedOrderNumber &&
    partner.releasedAt &&
    now.getTime() - partner.releasedAt.getTime() <= RELEASE_NOTICE_MS
      ? {
          kind:
            partner.releasedKind === 'takenOff'
              ? ('takenOff' as const)
              : partner.releasedKind === 'handedOver'
                ? ('handedOver' as const)
                : ('cancelled' as const),
          orderNumber: partner.releasedOrderNumber,
          at: partner.releasedAt.toISOString(),
        }
      : null;
  return {
    missedInRow: partner?.missedInRow ?? 0,
    offersPausedSince: staleAt && staleAt.getTime() <= now.getTime() ? staleAt.toISOString() : null,
    howOffersWork: {
      reachesKm: [...REACHES_KM],
      offerSeconds: t.offerSeconds,
      missLimit: MISS_LIMIT,
    },
    delivery: active
      ? {
          deliveryId: active.deliveryId,
          orderNumber: active.orderNumber,
          status:
            active.status === 'PICKED_UP' || active.status === 'AT_RESTAURANT'
              ? active.status
              : 'ASSIGNED',
        }
      : null,
    notice: active ? null : released,
  };
}

// ------------------------------------------------------------------ staff

interface StaffViewer {
  userId: string;
  role: UserActor['role'];
  isDemo: boolean;
}

async function requireStaff(actor: UserActor, permission: Permission, write: boolean) {
  const checked = await requirePermission(permission, { write, demoMessage: DEMO_CANNOT });
  if (checked.userId !== actor.userId) throw unauthenticated();
  return {
    userId: checked.userId,
    role: checked.role,
    isDemo: checked.isDemo,
  } satisfies StaffViewer;
}

const staffRoleOf = (viewer: StaffViewer): 'support' | 'admin' => {
  if (viewer.role === 'support' || viewer.role === 'admin') return viewer.role;
  throw forbidden();
};

const maskName = (name: string) => `${name.trim().charAt(0)}•••`;
const nameFor = (viewer: { isDemo: boolean }, name: string, shownToDemo: boolean) =>
  viewer.isDemo && !shownToDemo ? maskName(name) : name;

const CHANGE_HOW: Record<string, DispatchRefusalDetails['DELIVERY_CHANGED']['how']> = {
  'courier-offered-by-staff': 'offered',
  'courier-assigned': 'accepted',
  'courier-gave-back': 'gave-back',
  'courier-unassigned': 'taken-off',
  'courier-escalated': 'escalated',
  'courier-search-stopped': 'stopped',
  'courier-search-restarted': 'restarted',
};

const eventData = z
  .object({
    by: z.object({ name: z.string().nullable(), role: z.enum(['support', 'admin']) }).optional(),
    partnerId: z.string().optional(),
  })
  .loose();

/** A42: what changed since the version the person saw, in one sentence. */
async function deliveryChanged(
  ctx: DbContext,
  number: string,
  orderId: string,
  current: { status: DeliveryStatus; version: number },
): Promise<AppError> {
  const last = await repo.findLastCourierEvent(ctx, orderId);
  const data = eventData.safeParse(last?.data).data;
  let by: DispatchRefusalDetails['DELIVERY_CHANGED']['by'] = { kind: 'system' };
  let partnerName: string | null = null;
  if (data?.by) by = { kind: 'staff', name: data.by.name, role: data.by.role };
  else if (data?.partnerId) {
    const [partner] = await repo.listCourierFacts(ctx, [data.partnerId]);
    partnerName = partner ? shortName(partner.name) : null;
    by = { kind: 'partner', shortName: partnerName };
  }
  const how = (last && CHANGE_HOW[last.type]) ?? 'other';
  const message =
    how === 'accepted' && partnerName
      ? `${partnerName} accepted order ${number} a moment ago.`
      : `Order ${number} changed a moment ago. Check the courier line and try again.`;
  return refusal('DELIVERY_CHANGED', message, 409, {
    orderId,
    current,
    how,
    by,
    at: (last?.createdAt ?? new Date()).toISOString(),
  });
}

async function staffBy(ctx: DbContext, viewer: StaffViewer) {
  const name = (await repo.findStaffName(ctx, viewer.userId)) ?? 'Staff member';
  return { name: name.slice(0, 120), role: staffRoleOf(viewer) };
}

/** A37.2: the assign dialog's list, in dispatch order, with tags and disabled reasons. */
export async function listAssignableCouriers(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<AssignableCouriers> {
  const { orderId } = assignableCouriersInput.parse(input);
  const viewer = await requireStaff(actor, ASSIGN_READ, false);
  const t = timings();
  return runAsSystem('assign list', async (ctx) => {
    const order = await repo.findOrderForDispatch(ctx, orderId);
    if (!order) throw orderNotFound();
    const pool = order.customerIsDemo ? 'DEMO' : 'REAL';
    const delivery = await repo.findDeliveryByOrder(ctx, orderId);
    const kitchen = await repo.findKitchen(ctx);
    const rows = await repo.listOnlineForAssign(ctx, pool);
    const offline = await repo.countApprovedOffline(ctx, pool);
    const offers = delivery ? await repo.listOffersOfDelivery(ctx, delivery.id) : [];
    const gaveBack = new Set(delivery?.excludedPartnerIds ?? []);
    const radiusM = (kitchen?.deliveryRadiusKm ?? REACHES_KM.at(-1) ?? 8) * 1000;
    return {
      deliveryVersion: delivery?.version ?? 0,
      offlineCount: offline,
      rows: rows.map((row): AssignableCourier => {
        const declined = offers.findLast(
          (offer) => offer.partnerId === row.partnerId && offer.endedReason === 'declined',
        );
        const name = nameFor(viewer, row.name, row.shownToDemo);
        const staleMs = row.lastPointAt ? now.getTime() - row.lastPointAt.getTime() : null;
        const stale =
          !row.isDemo && (staleMs === null || staleMs > t.freshPointSeconds * 1000)
            ? Math.max(1, Math.round((staleMs ?? 60_000) / 60_000))
            : null;
        const waited = row.waitingSince ? now.getTime() - row.waitingSince.getTime() : 0;
        const distance = row.distanceM === null ? 'no location' : fromKitchenWords(row.distanceM);
        return {
          partnerId: row.partnerId,
          name,
          words: `${name} · ${courierVehicle(row.vehicleType, null)} · ${distance} · ${waitingWords(waited)}`,
          tags: {
            declinedAt: declined?.respondedAt?.toISOString() ?? null,
            gaveBackAt:
              gaveBack.has(row.partnerId) && !declined
                ? (delivery?.assignedAt?.toISOString() ?? null)
                : null,
            staleMinutes: stale,
            outOfRangeKm:
              row.distanceM !== null && row.distanceM > radiusM
                ? Math.round(row.distanceM / 100) / 10
                : null,
          },
          disabledReason: row.busyOrderNumber
            ? `On order ${row.busyOrderNumber}`
            : row.hasOpenOffer
              ? 'Has another offer open'
              : null,
          masked: name !== row.name,
        };
      }),
    };
  });
}

/** A37.3: a 60-second offer from staff to one online partner; an open automatic one goes. */
export async function sendStaffOffer(
  actor: UserActor,
  input: unknown,
): Promise<StaffDispatchResult> {
  const { orderId, partnerId, expectedVersion } = sendStaffOfferInput.parse(input);
  const viewer = await requireStaff(actor, ASSIGN, true);
  const t = timings();
  const outcome = await runAs(actor, async (ctx) => {
    const order = await repo.findOrderForDispatch(ctx, orderId, true);
    if (!order) throw orderNotFound();
    if (order.status !== 'READY') {
      throw invalidState(`Order ${order.number} isn't ready, so it can't be offered.`, {
        orderId,
        number: order.number,
        status: order.status,
      });
    }
    const pool = order.customerIsDemo ? 'DEMO' : 'REAL';
    let delivery = await repo.findDeliveryByOrder(ctx, orderId, true);
    const current = {
      status: delivery?.status ?? ('SEARCHING' as const),
      version: delivery?.version ?? 0,
    };
    if (current.version !== expectedVersion || (delivery && isActive(delivery.status))) {
      throw await deliveryChanged(ctx, order.number, orderId, current);
    }
    const partner = await repo.findPartnerForDispatch(ctx, partnerId);
    const unavailable = (
      why: 'offline' | 'busy' | 'has-offer',
      message: string,
      orderNumber?: string,
    ) =>
      refusal('COURIER_UNAVAILABLE', message, 409, {
        why,
        name: partner ? shortName(partner.name) : null,
        ...(orderNumber && { orderNumber }),
      });
    if (
      !partner ||
      partner.status !== 'APPROVED' ||
      partner.banned ||
      !partner.isOnline ||
      partner.isDemo !== (pool === 'DEMO')
    ) {
      throw unavailable(
        'offline',
        `${partner ? shortName(partner.name) : 'That courier'} went offline a moment ago. Choose another courier.`,
      );
    }
    const busy = await repo.findActiveDeliveryOfPartner(ctx, partnerId);
    if (busy) {
      throw unavailable(
        'busy',
        `${shortName(partner.name)} is on order ${busy.orderNumber}.`,
        busy.orderNumber,
      );
    }
    const theirs = await repo.findOpenOfferOfPartner(ctx, partnerId);
    if (theirs && theirs.deliveryId !== delivery?.id) {
      throw unavailable('has-offer', `${shortName(partner.name)} has another offer open.`);
    }

    if (!delivery) {
      await repo.insertDelivery(ctx, {
        orderId,
        pool,
        readyAt: order.readyAt,
        readyEventId: null,
        tipCents: order.tipCents,
        startSearch: false,
      });
      delivery = await repo.findDeliveryByOrder(ctx, orderId, true);
    } else if (delivery.status !== 'SEARCHING') {
      await repo.clearStop(ctx, delivery.id);
    }
    if (!delivery) throw orderNotFound();
    const withdrawn = await repo.withdrawOffers(
      ctx,
      { deliveryId: delivery.id },
      'withdrawn-staff',
    );
    const pay = offerPay(order);
    const offer = await repo.insertOffer(ctx, {
      deliveryId: delivery.id,
      partnerId,
      kind: 'staff',
      offeredBy: viewer.userId,
      round: (await repo.countOffers(ctx, delivery.id)) + 1,
      reachKm: null,
      pickupM: partner.distanceM ?? 0,
      payCents: pay.payCents,
      tipCents: pay.tipCents,
      seconds: t.staffOfferSeconds,
    });
    const version = await repo.bumpVersion(ctx, delivery.id);
    const by = await staffBy(ctx, viewer);
    await repo.insertOrderEvent(ctx, {
      orderId,
      type: 'courier-offered-by-staff',
      actorId: viewer.userId,
      data: { by, partnerId },
    });
    await audit(ctx, {
      action: 'delivery.offer-sent',
      targetType: 'order',
      targetId: orderId,
      data: { number: order.number, deliveryId: delivery.id, partnerId },
    });
    const at = new Date();
    const effects: DispatchEffect[] = [
      ...withdrawn.map((ended): DispatchEffect => ({
        kind: 'offerEnded',
        offerId: ended.id,
        deliveryId: ended.deliveryId,
        orderId,
        partnerId: ended.partnerId,
        ending: 'withdrawn-staff',
        tellPartner: true,
        at,
      })),
      {
        kind: 'offerCreated',
        offerId: offer.id,
        deliveryId: delivery.id,
        orderId,
        partnerId,
        offerKind: 'staff',
        expiresAt: offer.expiresAt,
      },
      { kind: 'changed', orderId, status: 'SEARCHING', version, partnerIds: [], at },
    ];
    return {
      result: { orderId, deliveryId: delivery.id, version, at: at.toISOString(), replayed: false },
      effects,
    };
  });
  await runDispatchEffects(outcome.effects);
  return outcome.result;
}

/** A38: take an assigned order off its courier before pickup; a new search starts at once. */
export async function takeOffCourier(
  actor: UserActor,
  input: unknown,
): Promise<StaffDispatchResult> {
  const { orderId, expectedVersion, reason, note } = takeOffCourierInput.parse(input);
  const viewer = await requireStaff(actor, ASSIGN, true);
  const outcome = await runAs(actor, async (ctx) => {
    const order = await repo.findOrderForDispatch(ctx, orderId, true);
    if (!order) throw orderNotFound();
    const delivery = await repo.findDeliveryByOrder(ctx, orderId, true);
    if (!delivery) {
      throw refusal('NOT_ASSIGNED', `No courier has order ${order.number}.`, 409, {
        deliveryId: '',
      });
    }
    if (delivery.version !== expectedVersion) {
      throw await deliveryChanged(ctx, order.number, orderId, delivery);
    }
    if (delivery.status === 'PICKED_UP') {
      throw invalidState('After pickup, call the courier.', {
        orderId,
        number: order.number,
        status: delivery.status,
      });
    }
    if (!BEFORE_PICKUP.has(delivery.status) || !delivery.partnerId) {
      throw refusal('NOT_ASSIGNED', `No courier has order ${order.number}.`, 409, {
        deliveryId: delivery.id,
      });
    }
    const partnerId = delivery.partnerId;
    const version = await repo.takeOff(ctx, delivery.id, partnerId);
    const by = await staffBy(ctx, viewer);
    await repo.insertOrderEvent(ctx, {
      orderId,
      type: 'courier-unassigned',
      actorId: viewer.userId,
      data: { by, reason, partnerId, ...(note && { note }) },
    });
    await audit(ctx, {
      action: 'delivery.unassigned',
      targetType: 'order',
      targetId: orderId,
      data: {
        number: order.number,
        deliveryId: delivery.id,
        partnerId,
        reason,
        hasNote: Boolean(note),
      },
    });
    return { order, delivery, partnerId, version };
  });
  await runAsSystem('taken off', async (ctx) => {
    await repo.setWaitingSince(ctx, outcome.partnerId, null);
    await repo.setReleased(ctx, outcome.partnerId, 'takenOff', outcome.order.number);
  });
  const at = new Date();
  await runDispatchEffects([
    {
      kind: 'changed',
      orderId,
      status: 'SEARCHING',
      version: outcome.version,
      partnerIds: [outcome.partnerId],
      at,
    },
    { kind: 'restart', orderId, at },
    {
      kind: 'assignmentEnded',
      deliveryId: outcome.delivery.id,
      orderId,
      partnerId: outcome.partnerId,
      how: 'taken-off',
      version: outcome.version,
      at,
    },
  ]);
  return {
    orderId,
    deliveryId: outcome.delivery.id,
    version: outcome.version,
    at: at.toISOString(),
    replayed: false,
  };
}

/** A39.4: "Find a courier" for a ready order with no search running. */
export async function restartSearch(
  actor: UserActor,
  input: unknown,
): Promise<StaffDispatchResult> {
  const { orderId, expectedVersion } = restartSearchInput.parse(input);
  const viewer = await requireStaff(actor, ASSIGN, true);
  const outcome = await runAs(actor, async (ctx) => {
    const order = await repo.findOrderForDispatch(ctx, orderId, true);
    if (!order) throw orderNotFound();
    if (order.status !== 'READY') {
      throw invalidState(`Order ${order.number} isn't ready.`, {
        orderId,
        number: order.number,
        status: order.status,
      });
    }
    const existing = await repo.findDeliveryByOrder(ctx, orderId, true);
    const current = {
      status: existing?.status ?? ('SEARCHING' as const),
      version: existing?.version ?? 0,
    };
    if (current.version !== expectedVersion || (existing && isActive(existing.status))) {
      throw await deliveryChanged(ctx, order.number, orderId, current);
    }
    if (existing?.status === 'SEARCHING' && existing.searchStartedAt && !existing.searchStoppedAt) {
      throw invalidState(`We're already looking for a courier for order ${order.number}.`, {
        orderId,
        number: order.number,
        status: existing.status,
      });
    }
    let deliveryId = existing?.id ?? null;
    let version = 0;
    if (existing) version = await repo.clearStop(ctx, existing.id);
    else {
      deliveryId = await repo.insertDelivery(ctx, {
        orderId,
        pool: order.customerIsDemo ? 'DEMO' : 'REAL',
        readyAt: order.readyAt,
        readyEventId: null,
        tipCents: order.tipCents,
        startSearch: false,
      });
    }
    const by = await staffBy(ctx, viewer);
    await repo.insertOrderEvent(ctx, {
      orderId,
      type: 'courier-search-restarted',
      actorId: viewer.userId,
      data: { by },
    });
    await audit(ctx, {
      action: 'delivery.search-restarted',
      targetType: 'order',
      targetId: orderId,
      data: { number: order.number, deliveryId },
    });
    return { deliveryId: deliveryId ?? '', version };
  });
  const at = new Date();
  await runDispatchEffects([
    { kind: 'restart', orderId, at },
    { kind: 'changed', orderId, status: 'SEARCHING', version: outcome.version, partnerIds: [], at },
  ]);
  return { orderId, ...outcome, at: at.toISOString(), replayed: false };
}

// ------------------------------------------------------------------ the board and the order detail (A34 to A36)

export interface CourierOrderFacts {
  id: string;
  status: string;
  readyAt: Date | null;
}

interface LineContext {
  deliveries: Map<string, DeliveryRow>;
  offers: Map<string, OfferRowData>;
  partners: Map<string, repo.CourierFactsRow>;
  staff: Map<string, { name: string; shownToDemo: boolean }>;
  anyoneOnline: boolean;
}

async function lineContext(ctx: DbContext, orderIds: readonly string[]): Promise<LineContext> {
  const deliveries = await repo.listDeliveriesByOrders(ctx, orderIds);
  const offers = await repo.listOpenOffersOf(
    ctx,
    deliveries.map((delivery) => delivery.id),
  );
  const partnerIds = new Set<string>();
  for (const delivery of deliveries) if (delivery.partnerId) partnerIds.add(delivery.partnerId);
  for (const offer of offers) partnerIds.add(offer.partnerId);
  const staffIds = offers.flatMap((offer) => (offer.offeredBy ? [offer.offeredBy] : []));
  const partners = await repo.listCourierFacts(ctx, [...partnerIds]);
  const staff = await repo.listStaffNames(ctx, staffIds);
  const online = await repo.countOnline(ctx, 'REAL');
  return {
    deliveries: new Map(deliveries.map((delivery) => [delivery.orderId, delivery])),
    offers: new Map(offers.map((offer) => [offer.deliveryId, offer])),
    partners: new Map(partners.map((partner) => [partner.partnerId, partner])),
    staff: new Map(staff.map((person) => [person.id, person])),
    anyoneOnline: online > 0,
  };
}

function lineFor(
  viewer: { isDemo: boolean },
  order: CourierOrderFacts,
  context: LineContext,
  now: Date,
): BoardCourier | null {
  const t = timings();
  const delivery = context.deliveries.get(order.id) ?? null;
  const offer = delivery ? (context.offers.get(delivery.id) ?? null) : null;
  const holder = delivery?.partnerId ? (context.partners.get(delivery.partnerId) ?? null) : null;
  const state = courierStateOf(
    {
      orderStatus: order.status,
      readyAt: order.readyAt?.toISOString() ?? null,
      delivery: delivery
        ? {
            status: delivery.status,
            searchStartedAt: delivery.searchStartedAt?.toISOString() ?? null,
            escalatedAt: delivery.escalatedAt?.toISOString() ?? null,
            searchStoppedAt: delivery.searchStoppedAt?.toISOString() ?? null,
          }
        : null,
      openOfferKind: offer?.kind ?? null,
      anyoneOnline: context.anyoneOnline,
      lastPointAt: holder?.lastPointAt?.toISOString() ?? null,
    },
    now,
    t.startDelaySeconds,
  );
  if (!state) return null;
  // A36.5: the demo admin never sees a real courier's plate.
  const plate = holder && !(viewer.isDemo && !holder.shownToDemo) ? holder.vehiclePlate : null;
  const named = offer ? (context.partners.get(offer.partnerId) ?? null) : holder;
  const short = named ? shortName(nameFor(viewer, named.name, named.shownToDemo)) : null;
  const sender = offer?.offeredBy ? context.staff.get(offer.offeredBy) : undefined;
  const offeredBy = sender ? firstNameOf(nameFor(viewer, sender.name, sender.shownToDemo)) : null;
  const staleMinutes =
    state === 'assignedStale' && holder?.lastPointAt
      ? Math.round((now.getTime() - holder.lastPointAt.getTime()) / 60_000)
      : null;
  const { words, tone } = courierLineWords({
    state,
    partnerShort: short,
    offeredBy,
    reachKm: state === 'between' ? REACHES_KM[0] : (offer?.reachKm ?? null),
    vehicle: holder?.vehicleType ?? null,
    plate,
    distanceM: holder?.distanceM ?? null,
    staleMinutes,
  });
  return {
    state,
    tone,
    words,
    expiresAt: offer?.expiresAt.toISOString() ?? null,
    offeredBy,
    shortName: short,
    vehicleWords: holder ? courierVehicle(holder.vehicleType, plate) : null,
    plate,
    distanceWords:
      holder?.distanceM === null || holder?.distanceM === undefined
        ? null
        : holder.distanceM <= 100
          ? 'at the kitchen'
          : `${km(holder.distanceM)} away`,
    deliveryVersion: delivery?.version ?? null,
  };
}

/** The courier lines of a page of cards (A34.1), one read for all of them. */
export async function courierLines(
  viewer: { isDemo: boolean },
  orders: readonly CourierOrderFacts[],
  now = new Date(),
): Promise<Map<string, BoardCourier>> {
  const shown = orders.filter((order) => order.status === 'READY' || order.status === 'PICKED_UP');
  if (shown.length === 0) return new Map();
  const context = await runAsSystem('courier lines', (ctx) =>
    lineContext(
      ctx,
      shown.map((order) => order.id),
    ),
  );
  const lines = new Map<string, BoardCourier>();
  for (const order of shown) {
    const line = lineFor(viewer, order, context, now);
    if (line) lines.set(order.id, line);
  }
  return lines;
}

/** A35.1: "Couriers · 4 online · 2 free". */
export async function couriersCount(): Promise<CouriersCount> {
  return runAsSystem('couriers count', repo.countCouriers);
}

const sentByOf = (
  viewer: { isDemo: boolean },
  offer: OfferRowData,
  staff: Map<string, { name: string; role: string; shownToDemo: boolean }>,
) => {
  if (offer.kind === 'auto' || !offer.offeredBy) return 'Foodz (automatic)';
  const person = staff.get(offer.offeredBy);
  if (!person) return 'Foodz support';
  const role = person.role === 'admin' ? 'Admin' : 'Support';
  return `${nameFor(viewer, person.name, person.shownToDemo)} (${role})`;
};

/** A36: the detail's courier section, shaped by role (KITCHEN gets the line only). */
export async function courierSection(
  viewer: StaffViewer,
  order: CourierOrderFacts,
  now = new Date(),
): Promise<StaffCourierSection | null> {
  const data = await runAsSystem('courier section', async (ctx) => {
    const context = await lineContext(ctx, [order.id]);
    const delivery = context.deliveries.get(order.id) ?? null;
    const offers = delivery ? await repo.listOffersOfDelivery(ctx, delivery.id) : [];
    const partnerIds = [...new Set(offers.map((offer) => offer.partnerId))];
    const staffIds = offers.flatMap((offer) => (offer.offeredBy ? [offer.offeredBy] : []));
    const partners = await repo.listCourierFacts(ctx, partnerIds);
    const staff = await repo.listStaffNames(ctx, staffIds);
    return { context, delivery, offers, partners, staff };
  });
  const courier =
    lineFor(viewer, order, data.context, now) ??
    (data.delivery
      ? {
          state: 'notLooking' as const,
          tone: 'neutral' as const,
          words: '',
          expiresAt: null,
          offeredBy: null,
          shortName: null,
          vehicleWords: null,
          plate: null,
          distanceWords: null,
          deliveryVersion: data.delivery.version,
        }
      : null);
  if (!courier) return null;
  if (viewer.role === 'kitchen') return { view: 'kitchen', courier };

  const partners = new Map(data.partners.map((partner) => [partner.partnerId, partner]));
  const staff = new Map(data.staff.map((person) => [person.id, person]));
  const delivery = data.delivery;
  const holder = delivery?.partnerId
    ? (partners.get(delivery.partnerId) ?? data.context.partners.get(delivery.partnerId))
    : undefined;
  const accepted = data.offers.findLast((offer) => offer.endedReason === 'accepted');
  const readOnly = viewer.isDemo || !can(viewer.role, ASSIGN);
  const liveSearch =
    delivery?.status === 'SEARCHING' &&
    delivery.searchStartedAt !== null &&
    delivery.searchStoppedAt === null;
  const offers: OfferRow[] = data.offers.map((offer) => {
    const partner = partners.get(offer.partnerId);
    const ending: OfferEnding | 'open' = listedEnding(offer, timings().graceSeconds);
    const answered =
      (ending === 'accepted' || ending === 'declined') && offer.respondedAt
        ? Math.max(0, Math.round((offer.respondedAt.getTime() - offer.createdAt.getTime()) / 1000))
        : null;
    return {
      offerId: offer.id,
      at: offer.createdAt.toISOString(),
      partner: {
        id: partner && viewer.isDemo && !partner.shownToDemo ? null : offer.partnerId,
        name: partner ? nameFor(viewer, partner.name, partner.shownToDemo) : null,
      },
      sentBy: sentByOf(viewer, offer, staff),
      reachWords: offer.reachKm ? `Within ${offer.reachKm} km` : null,
      distanceWords: fromKitchenWords(offer.pickupM),
      seenAt: offer.seenAt?.toISOString() ?? null,
      ending,
      outcomeWords: outcomeWords(ending, {
        seen: offer.seenAt !== null,
        answeredAfterSeconds: answered,
      }),
    };
  });
  return {
    view: 'full',
    courier,
    deliveryId: delivery?.id ?? null,
    deliveryVersion: delivery?.version ?? null,
    assigned:
      holder && delivery && isActive(delivery.status)
        ? {
            partnerId: viewer.isDemo && !holder.shownToDemo ? null : holder.partnerId,
            name: nameFor(viewer, holder.name, holder.shownToDemo),
            vehicleWords: courierVehicle(holder.vehicleType, holder.vehiclePlate),
            plate: viewer.isDemo && !holder.shownToDemo ? null : holder.vehiclePlate,
            acceptedFromWords:
              accepted && accepted.pickupM <= 100
                ? 'at the kitchen'
                : `${km(accepted?.pickupM ?? 0)} from the kitchen`,
            phone:
              viewer.isDemo || !holder.phone
                ? null
                : { e164: holder.phone, display: displayPhone(holder.phone).display },
          }
        : null,
    offers,
    actions: {
      assign: !readOnly && order.status === 'READY' && !(delivery && isActive(delivery.status)),
      takeOff: !readOnly && Boolean(delivery && BEFORE_PICKUP.has(delivery.status)),
      findCourier:
        !readOnly &&
        order.status === 'READY' &&
        !liveSearch &&
        !(delivery && isActive(delivery.status)),
      readOnly,
      afterPickup: delivery?.status === 'PICKED_UP',
    },
    masked: viewer.isDemo,
  };
}

/**
 * The couriers the staff timeline names (design 2.5): full names for SUPPORT and ADMIN, masked
 * for the demo admin (A36.5), and only the first name and last initial for KITCHEN (A36.4), so
 * a full name never reaches the tablet.
 */
export async function courierNames(
  viewer: { isDemo: boolean; role: UserActor['role'] },
  partnerIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(partnerIds)];
  if (unique.length === 0) return new Map();
  const partners = await runAsSystem('courier names', (ctx) => repo.listCourierFacts(ctx, unique));
  return new Map(
    partners.map((partner) => {
      const name = nameFor(viewer, partner.name, partner.shownToDemo);
      return [partner.partnerId, viewer.role === 'kitchen' ? shortName(name) : name];
    }),
  );
}

/** F5's "Picked up by the assigned courier" reason: who holds the order, if anyone. */
export async function courierHolding(orderId: string): Promise<{ shortName: string } | null> {
  return runAsSystem('courier holding', async (ctx) => {
    const delivery = await repo.findDeliveryByOrder(ctx, orderId);
    if (!delivery?.partnerId || !BEFORE_PICKUP.has(delivery.status)) return null;
    const [partner] = await repo.listCourierFacts(ctx, [delivery.partnerId]);
    return partner ? { shortName: shortName(partner.name) } : null;
  });
}

// ------------------------------------------------------------------ the customer (S1 to S4)

/** The order page's courier card; null for anyone else's order. */
export async function getCustomerDispatch(
  actor: UserActor,
  orderId: string,
): Promise<CustomerDispatchView | null> {
  const own = await runAs(actor, (ctx) => repo.findOwnOrderId(ctx, orderId, actor.userId));
  if (!own) return null;
  const facts = await runAsSystem('customer courier', async (ctx) => {
    const delivery = await repo.findDeliveryByOrder(ctx, orderId);
    const [partner] = delivery?.partnerId
      ? await repo.listCourierFacts(ctx, [delivery.partnerId])
      : [];
    return { delivery, partner };
  });
  const state = customerStateOf({
    orderStatus: own.status,
    delivery: facts.delivery
      ? {
          status: facts.delivery.status,
          escalatedAt: facts.delivery.escalatedAt?.toISOString() ?? null,
          searchStoppedAt: facts.delivery.searchStoppedAt?.toISOString() ?? null,
        }
      : null,
  });
  const partner = facts.partner;
  // The courier card while he has the order; after delivery only his first name ("Delivered by
  // Luis."), never a photo link, vehicle, plate or rating (security S8), and never a position.
  const shown = (state === 'assigned' || state === 'pickedUp') && partner;
  const named = state === 'delivered' && partner;
  const delivery = facts.delivery;
  let photo: { url: string; expiresAt: string } | null = null;
  if (shown && partner.photoKey) {
    logger.info({ orderId, partnerId: partner.partnerId }, 'courier photo link');
    photo = {
      url: await presignDownload('PRIVATE', partner.photoKey, PHOTO_SECONDS),
      expiresAt: new Date(Date.now() + PHOTO_SECONDS * 1000).toISOString(),
    };
  }
  return {
    state,
    courier: shown
      ? {
          firstName: firstNameOf(partner.name),
          photoUrl: photo?.url ?? null,
          photoExpiresAt: photo?.expiresAt ?? null,
          vehicle: partner.vehicleType,
          vehicleWords: courierVehicle(partner.vehicleType, partner.vehiclePlate),
          plate: partner.vehiclePlate,
          rating:
            partner.ratingCount > 0
              ? { average: Math.round(partner.ratingAvg * 10) / 10, count: partner.ratingCount }
              : null,
        }
      : null,
    changed: Boolean(shown && delivery?.courierChanged),
    deliveredBy: named ? { firstName: firstNameOf(partner.name) } : null,
    assignedAt: shown || named ? (delivery?.assignedAt?.toISOString() ?? null) : null,
    pickedUpAt: shown || named ? (delivery?.pickedUpAt?.toISOString() ?? null) : null,
    deliveredAt: shown || named ? (delivery?.deliveredAt?.toISOString() ?? null) : null,
  };
}

/** B11: a fresh 5-minute link to the courier's photo, for the order's own customer only. */
export async function courierPhotoLink(
  actor: UserActor,
  input: unknown,
): Promise<{ url: string; expiresAt: string } | null> {
  const { orderId } = courierPhotoInput.parse(input);
  const own = await runAs(actor, (ctx) => repo.findOwnOrderId(ctx, orderId, actor.userId));
  if (!own) throw orderNotFound();
  const partner = await runAsSystem('courier photo', async (ctx) => {
    const delivery = await repo.findDeliveryByOrder(ctx, orderId);
    // Only while the courier holds the order: no photo is signed once it's delivered (S8).
    if (!delivery?.partnerId || !isActive(delivery.status)) return null;
    const [found] = await repo.listCourierFacts(ctx, [delivery.partnerId]);
    return found ?? null;
  });
  if (!partner?.photoKey) return null;
  logger.info({ orderId, partnerId: partner.partnerId }, 'courier photo link');
  return {
    url: await presignDownload('PRIVATE', partner.photoKey, PHOTO_SECONDS),
    expiresAt: new Date(Date.now() + PHOTO_SECONDS * 1000).toISOString(),
  };
}

// ------------------------------------------------------------------ the dispatch run's steps (W1 to W10)

/** Step 2 of the run: open (or reopen) the search for a ready order. Null when it shouldn't run. */
export async function openSearch(input: {
  orderId: string;
  readyEventId: string;
  restart: boolean;
}): Promise<{ deliveryId: string; readyAt: string; searchStartedAt: string } | null> {
  const outcome = await runAsSystem('open search', async (ctx) => {
    const order = await repo.findOrderForDispatch(ctx, input.orderId, true);
    if (order?.status !== 'READY') return null;
    const pool = order.customerIsDemo ? 'DEMO' : 'REAL';
    const existing = await repo.findDeliveryByOrder(ctx, input.orderId, true);
    // U16: a courier who kept the order through a move back keeps it; nothing to search for.
    if (existing && isActive(existing.status)) return null;
    let deliveryId: string;
    let fresh = true;
    if (!existing) {
      deliveryId = await repo.insertDelivery(ctx, {
        orderId: input.orderId,
        pool,
        readyAt: order.readyAt,
        readyEventId: input.readyEventId,
        tipCents: order.tipCents,
        startSearch: true,
      });
      await repo.bumpVersion(ctx, deliveryId);
    } else {
      deliveryId = existing.id;
      fresh =
        existing.readyEventId !== input.readyEventId ||
        !existing.searchStartedAt ||
        existing.searchStoppedAt !== null ||
        existing.status !== 'SEARCHING';
      if (fresh) {
        await repo.startSearch(ctx, deliveryId, {
          readyAt: order.readyAt,
          readyEventId: input.readyEventId,
          pool,
          tipCents: order.tipCents,
          restart: input.restart,
        });
      }
    }
    const delivery = await repo.findDelivery(ctx, deliveryId);
    if (!delivery?.searchStartedAt) return null;
    if (fresh) {
      await repo.insertOrderEvent(ctx, {
        orderId: input.orderId,
        type: 'courier-search-started',
        actorId: null,
        data: { restart: input.restart },
      });
    }
    return { delivery, fresh };
  });
  if (!outcome) return null;
  const { delivery } = outcome;
  if (outcome.fresh) {
    await runDispatchEffects([
      {
        kind: 'changed',
        orderId: input.orderId,
        status: 'SEARCHING',
        version: delivery.version,
        partnerIds: [],
        at: new Date(),
      },
    ]);
  }
  const searchStartedAt = delivery.searchStartedAt ?? new Date();
  return {
    deliveryId: delivery.id,
    readyAt: (delivery.readyAt ?? searchStartedAt).toISOString(),
    searchStartedAt: searchStartedAt.toISOString(),
  };
}

interface Pick {
  partnerId: string;
  distanceM: number;
  reachKm: number;
}

/** W3, W4, W9: the next partner for this order, the oldest ready order first. */
async function nextCandidate(
  ctx: DbContext,
  delivery: DeliveryRow,
  t: DispatchTimings,
  sweep: boolean,
): Promise<Pick | null> {
  const kitchen = await repo.findKitchen(ctx);
  const radiusKm = kitchen?.deliveryRadiusKm ?? REACHES_KM.at(-1) ?? 8;
  const since = delivery.searchStartedAt ?? new Date(0);
  const counts = await repo.countAutoOffersByReach(ctx, delivery.id, since);
  const byReach = REACHES_KM.map(
    (reach) => counts.find((count) => count.reachKm === reach)?.count ?? 0,
  );
  const reaches = reachesToTry(byReach);
  const search = (
    target: { id: string; pool: string; excludedPartnerIds: string[] },
    secondChance: boolean,
  ) =>
    repo.searchCandidates(ctx, {
      deliveryId: target.id,
      pool: target.pool === 'DEMO' ? 'DEMO' : 'REAL',
      reachM: radiusKm * 1000,
      excluded: target.excludedPartnerIds,
      secondChance,
      freshSeconds: t.freshPointSeconds,
      limit: 50,
    });
  const older = await repo.listOlderSearching(ctx, delivery.id, delivery.readyAt ?? since);
  // One query at a time on the transaction's connection.
  const first = await search(delivery, false);
  const second = sweep ? await search(delivery, true) : [];
  const olderLists = await older.reduce<Promise<{ deliveryId: string; candidates: string[] }[]>>(
    async (previous, other) => {
      const lists = await previous;
      const found = await search(other, Boolean(other.escalatedAt));
      const nearest =
        [0, 1, 2]
          .map((index) => found.filter((row) => row.distanceM <= reachMeters(index, radiusKm)))
          .find((rows) => rows.length > 0) ?? [];
      return [...lists, { deliveryId: other.id, candidates: nearest.map((row) => row.partnerId) }];
    },
    Promise.resolve([]),
  );
  const tryWith = (candidates: repo.CandidateRow[]): Pick | null => {
    for (const index of reaches) {
      const reachM = reachMeters(index, radiusKm);
      const mine = candidates.filter((row) => row.distanceM <= reachM);
      if (mine.length > 0) {
        const pickId = allocateOldestFirst(delivery.id, [
          ...olderLists,
          { deliveryId: delivery.id, candidates: mine.map((row) => row.partnerId) },
        ]);
        const pick = mine.find((row) => row.partnerId === pickId);
        if (pick)
          return {
            partnerId: pick.partnerId,
            distanceM: pick.distanceM,
            reachKm: REACHES_KM[index] ?? radiusKm,
          };
      }
    }
    return null;
  };
  return tryWith(first) ?? (sweep ? tryWith(second) : null);
}

/**
 * One turn of the run (W4, W5): under the dispatch lock, re-reads the order and the delivery
 * (so a missed event never leads to a second offer on an assigned order), stops at 60 minutes,
 * escalates at 5, and offers the next partner for 30 seconds.
 */
const quietTurn = (result: TurnResult) => ({
  result,
  effects: [] as DispatchEffect[],
  escalatedNow: false,
  orderId: '',
});

export async function searchTurn(deliveryId: string): Promise<TurnResult> {
  const t = timings();
  const outcome = await runAsSystem('dispatch turn', async (ctx) => {
    await repo.lockDispatch(ctx);
    const delivery = await repo.findDelivery(ctx, deliveryId, true);
    if (delivery?.status !== 'SEARCHING') return quietTurn({ kind: 'done' });
    const order = await repo.findOrderForDispatch(ctx, delivery.orderId);
    if (order?.status !== 'READY') return quietTurn({ kind: 'done' });
    if (delivery.searchStoppedAt) return quietTurn({ kind: 'stopped' });
    const open = await repo.findOpenOfferOfDelivery(ctx, deliveryId);
    if (open) {
      return quietTurn({
        kind: open.kind === 'staff' ? 'staffOfferOpen' : 'offered',
        offerId: open.id,
        expiresAt: open.expiresAt.toISOString(),
      });
    }
    const now = await repo.databaseNow(ctx);
    const startedAt = delivery.searchStartedAt ?? now;
    const facts = {
      readyAt: (delivery.searchRestartedAt ?? delivery.readyAt ?? startedAt).toISOString(),
      searchStartedAt: startedAt.toISOString(),
      escalatedAt: delivery.escalatedAt?.toISOString() ?? null,
      anyoneOnline: true,
      anyoneLeft: true,
    };
    const at = new Date();
    const first = searchStep(facts, now, t);
    if (first === 'stop') {
      await repo.markStopped(ctx, deliveryId, 'timeout');
      await repo.insertOrderEvent(ctx, {
        orderId: order.id,
        type: 'courier-search-stopped',
        actorId: null,
        data: { reason: 'timeout' },
      });
      const stopped = await repo.findDelivery(ctx, deliveryId);
      return {
        result: { kind: 'stopped' } as TurnResult,
        effects: [
          {
            kind: 'changed',
            orderId: order.id,
            status: 'SEARCHING',
            version: stopped?.version ?? 0,
            partnerIds: [],
            at,
          },
        ] as DispatchEffect[],
        escalatedNow: false,
        orderId: order.id,
      };
    }
    let escalated = delivery.escalatedAt !== null;
    let escalatedNow = false;
    const escalate = async () => {
      if (escalated) return;
      await repo.markEscalated(ctx, deliveryId);
      await repo.insertOrderEvent(ctx, {
        orderId: order.id,
        type: 'courier-escalated',
        actorId: null,
        data: {},
      });
      escalated = true;
      escalatedNow = true;
    };
    if (first === 'escalate') await escalate();

    const pick = await nextCandidate(ctx, delivery, t, escalated);
    if (pick) {
      const pay = offerPay(order);
      const offer = await repo.insertOffer(ctx, {
        deliveryId,
        partnerId: pick.partnerId,
        kind: 'auto',
        offeredBy: null,
        round: (await repo.countOffers(ctx, deliveryId)) + 1,
        reachKm: pick.reachKm,
        pickupM: pick.distanceM,
        payCents: pay.payCents,
        tipCents: pay.tipCents,
        seconds: t.offerSeconds,
      });
      const version = await repo.bumpVersion(ctx, deliveryId);
      return {
        result: {
          kind: 'offered',
          offerId: offer.id,
          expiresAt: offer.expiresAt.toISOString(),
        } as TurnResult,
        effects: [
          {
            kind: 'offerCreated',
            offerId: offer.id,
            deliveryId,
            orderId: order.id,
            partnerId: pick.partnerId,
            offerKind: 'auto',
            expiresAt: offer.expiresAt,
          },
          { kind: 'changed', orderId: order.id, status: 'SEARCHING', version, partnerIds: [], at },
        ] as DispatchEffect[],
        escalatedNow,
        orderId: order.id,
      };
    }
    const anyoneOnline = (await repo.countOnline(ctx, delivery.pool)) > 0;
    if (
      searchStep(
        {
          ...facts,
          escalatedAt: escalated ? at.toISOString() : null,
          anyoneOnline,
          anyoneLeft: false,
        },
        now,
        t,
      ) === 'escalate'
    ) {
      await escalate();
    }
    const after = await repo.findDelivery(ctx, deliveryId);
    return {
      result: { kind: 'nobody', escalated } as TurnResult,
      effects: escalatedNow
        ? ([
            {
              kind: 'changed',
              orderId: order.id,
              status: 'SEARCHING',
              version: after?.version ?? 0,
              partnerIds: [],
              at,
            },
          ] as DispatchEffect[])
        : [],
      escalatedNow,
      orderId: order.id,
    };
  });
  if (outcome.escalatedNow) {
    logger.warn(
      { deliveryId, orderId: outcome.orderId, alert: 'dispatch-escalated' },
      'no courier found yet; the order is escalated',
    );
  }
  await runDispatchEffects(outcome.effects);
  return outcome.result;
}

export type ExpireResult =
  | { outcome: 'expired'; partnerId: string; takeOffline: boolean; warn: boolean }
  | { outcome: 'not-due' }
  | { outcome: 'already-ended' };

/** The expiry job's step (W4.2, P25, W7.4): closes the offer, counts misses, tells the phone. */
export async function expireOffer(offerId: string): Promise<ExpireResult> {
  const t = timings();
  const outcome = await runAsSystem('offer expiry', async (ctx) => {
    const ended = await repo.expireOffer(ctx, offerId, t.graceSeconds);
    if (!ended) {
      const offer = await repo.findOffer(ctx, offerId);
      return offer?.status === 'PENDING'
        ? ({ outcome: 'not-due' } as const)
        : ({ outcome: 'already-ended' } as const);
    }
    const partner = await repo.findPartnerForDispatch(ctx, ended.partnerId, true);
    const counters = countersAfter(
      { kind: ended.kind, seen: ended.seen, ending: ended.ending, pressedBeforeEnd: ended.pressed },
      { missedInRow: partner?.missedInRow ?? 0, unseenInRow: partner?.unseenInRow ?? 0 },
    );
    await repo.writeCounters(ctx, ended.partnerId, counters);
    const version = await repo.bumpVersion(ctx, ended.deliveryId);
    const delivery = await repo.findDelivery(ctx, ended.deliveryId);
    return { outcome: 'expired' as const, ended, counters, version, delivery };
  });
  if (outcome.outcome !== 'expired') return outcome;
  const { ended, counters, delivery } = outcome;
  const at = new Date();
  await runDispatchEffects([
    {
      kind: 'offerEnded',
      offerId,
      deliveryId: ended.deliveryId,
      orderId: delivery?.orderId ?? '',
      partnerId: ended.partnerId,
      ending: ended.ending,
      tellPartner: true,
      at,
    },
    ...(delivery
      ? [
          {
            kind: 'changed' as const,
            orderId: delivery.orderId,
            status: delivery.status,
            version: outcome.version,
            partnerIds: [],
            at,
          },
        ]
      : []),
  ]);
  return {
    outcome: 'expired',
    partnerId: ended.partnerId,
    takeOffline: counters.takeOffline,
    warn: counters.warn,
  };
}

/**
 * W7.1, A25: a partner going offline loses an open offer (the run asks the next partner at
 * once); a suspended partner also loses the order he holds before pickup.
 */
export async function partnerLeaving(
  partnerId: string,
  how: 'offline' | 'suspended',
): Promise<{ withdrawnOfferId: string | null; releasedDeliveryId: string | null }> {
  const outcome = await runAsSystem('partner leaving', async (ctx) => {
    const withdrawn = await repo.withdrawOffers(ctx, { partnerId }, 'withdrawn-offline');
    const deliveries = await repo.listDeliveriesByIds(
      ctx,
      withdrawn.map((ended) => ended.deliveryId),
    );
    let released: { delivery: DeliveryRow; version: number } | null = null;
    if (how === 'suspended') {
      const active = await repo.findActiveDeliveryOfPartner(ctx, partnerId);
      if (active && BEFORE_PICKUP.has(active.status)) {
        const delivery = await repo.findDelivery(ctx, active.deliveryId, true);
        if (delivery) {
          const version = await repo.releaseDelivery(ctx, delivery.id, {
            status: 'SEARCHING',
            excludePartnerId: partnerId,
            courierChanged: true,
          });
          await repo.insertOrderEvent(ctx, {
            orderId: delivery.orderId,
            type: 'courier-unassigned',
            actorId: null,
            data: { reason: 'suspended', partnerId },
          });
          released = { delivery, version };
        }
      }
    }
    return { withdrawn, deliveries, released };
  });
  const at = new Date();
  const effects: DispatchEffect[] = outcome.withdrawn.flatMap((ended): DispatchEffect[] => {
    const delivery = outcome.deliveries.find((row) => row.id === ended.deliveryId);
    if (!delivery) return [];
    return [
      {
        kind: 'offerEnded',
        offerId: ended.id,
        deliveryId: ended.deliveryId,
        orderId: delivery.orderId,
        partnerId,
        ending: 'withdrawn-offline',
        tellPartner: true,
        at,
      },
      {
        kind: 'changed',
        orderId: delivery.orderId,
        status: delivery.status,
        version: delivery.version,
        partnerIds: [],
        at,
      },
    ];
  });
  if (outcome.released) {
    const { delivery, version } = outcome.released;
    effects.push(
      {
        kind: 'changed',
        orderId: delivery.orderId,
        status: 'SEARCHING',
        version,
        partnerIds: [partnerId],
        at,
      },
      { kind: 'restart', orderId: delivery.orderId, at },
    );
  }
  await runDispatchEffects(effects);
  return {
    withdrawnOfferId: outcome.withdrawn[0]?.id ?? null,
    releasedDeliveryId: outcome.released?.delivery.id ?? null,
  };
}

export type OrderChange =
  | 'moved-back'
  | 'cancelled'
  | 'handed-over'
  | 'picked-up-by-courier'
  | 'delivered'
  | 'moved-back-from-out';

/** The F5 hooks (contract §14): what an order's change does to its delivery. */
export async function orderChanged(orderId: string, change: OrderChange): Promise<void> {
  const outcome = await runAsSystem('order changed', async (ctx) => {
    const delivery = await repo.findDeliveryByOrder(ctx, orderId, true);
    if (!delivery) return null;
    const effects: DispatchEffect[] = [];
    const at = new Date();
    const holder = delivery.partnerId;
    const withdraw = async () => {
      const withdrawn = await repo.withdrawOffers(
        ctx,
        { deliveryId: delivery.id },
        'withdrawn-order',
      );
      for (const ended of withdrawn) {
        effects.push({
          kind: 'offerEnded',
          offerId: ended.id,
          deliveryId: delivery.id,
          orderId,
          partnerId: ended.partnerId,
          ending: 'withdrawn-order',
          tellPartner: true,
          at,
        });
      }
    };
    let version = delivery.version;
    let status: DeliveryStatus = delivery.status;
    switch (change) {
      case 'moved-back':
        await withdraw();
        if (holder) version = await repo.bumpVersion(ctx, delivery.id);
        break;
      case 'cancelled':
      case 'handed-over': {
        await withdraw();
        if (delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED') break;
        version = await repo.releaseDelivery(ctx, delivery.id, {
          status: 'CANCELLED',
          excludePartnerId: null,
          courierChanged: false,
        });
        status = 'CANCELLED';
        if (holder) {
          const order = await repo.findOrderForDispatch(ctx, orderId);
          // W3.3: a cancellation or a hand-over another way gives back the place held before.
          await repo.setWaitingSince(ctx, holder, delivery.partnerWaitingSince);
          await repo.setReleased(
            ctx,
            holder,
            change === 'cancelled' ? 'cancelled' : 'handedOver',
            order?.number ?? '',
          );
          effects.push({
            kind: 'assignmentEnded',
            deliveryId: delivery.id,
            orderId,
            partnerId: holder,
            how: change,
            version,
            at,
          });
        }
        if (change === 'handed-over') effects.push({ kind: 'handedOver', orderId, at });
        break;
      }
      case 'picked-up-by-courier':
        if (holder && BEFORE_PICKUP.has(delivery.status)) {
          version = await repo.setDeliveryStatus(ctx, delivery.id, 'PICKED_UP');
          status = 'PICKED_UP';
        }
        break;
      case 'delivered':
        if (holder && isActive(delivery.status)) {
          version = await repo.setDeliveryStatus(ctx, delivery.id, 'DELIVERED');
          status = 'DELIVERED';
          await repo.setWaitingSince(ctx, holder, null);
          effects.push({
            kind: 'assignmentEnded',
            deliveryId: delivery.id,
            orderId,
            partnerId: holder,
            how: 'delivered',
            version,
            at,
          });
        }
        break;
      default:
        if (holder && delivery.status === 'PICKED_UP') {
          version = await repo.setDeliveryStatus(ctx, delivery.id, 'ASSIGNED');
          status = 'ASSIGNED';
        }
    }
    if (version === delivery.version && effects.length === 0) return null;
    effects.unshift({
      kind: 'changed',
      orderId,
      status,
      version,
      partnerIds: holder ? [holder] : [],
      at,
    });
    return effects;
  });
  if (outcome) await runDispatchEffects(outcome);
}
