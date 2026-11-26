import 'server-only';
import { randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { channels } from '@/lib/realtime/channels';
import type { DeliveryChangedEvent } from '@/lib/realtime/events';
import { displayPhone } from '@/lib/phone';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { can, type Permission } from '@/server/auth/roles';
import { requirePermission, type UserActor } from '@/server/auth/session';
import { type DbContext, runAs, runAsSystem } from '@/server/db/context';
import { AppError, forbidden, invalidInput, notFound, unauthenticated } from '@/server/errors';
import { inngest } from '@/server/jobs/client';
import {
  deliveryDelivered,
  deliveryNoAnswerStarted,
  deliveryReplanRequested,
  demoDeliveryRequested,
} from '@/server/jobs/tracking-events';
import { deliveryAssignmentEnded } from '@/server/jobs/dispatch-events';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import type { StaffDispatchResult } from '@/server/modules/delivery/schema';
import { acceptOffer, getCurrentDelivery } from '@/server/modules/delivery/service';
import { cityAndZip, firstNameOf, shortName, courierVehicle } from '@/server/modules/delivery/text';
import { notify } from '@/server/modules/notifications/service';
import { type OrderEffect, runEffects } from '@/server/modules/orders/effects';
import { readPoint } from '@/server/modules/partners/location-store';
import { passStepUp, stepUpFreshUntilFor } from '@/server/modules/staff/service';
import { publish } from '@/server/realtime/pusher';
import { redis } from '@/server/redis';
import { deliveryCodeContext, deliveryCodeHash } from '@/server/security/code-hash';
import { decryptField, encryptField } from '@/server/security/field-encryption';
import { announceEarnings } from '@/server/modules/earnings/effects';
import { todayLineIn } from '@/server/modules/earnings/service';
import * as repo from './repo';
import type { TrackedDelivery } from './repo';
import { neighborhoodOf, ridePoints, routeBetween } from './routing';
import {
  almostThere,
  attentionOf,
  atKitchen,
  type DeliveryFacts,
  deliveryLineState,
  demoRunVerdict,
  distanceM,
  drawCode,
  etaShiftWorthPushing,
  freshnessOf,
  historyDue,
  mapStateOf,
  noAnswerClock,
  offRoute,
  roundCoordinate,
  stageOf,
  trackingTimings,
  triesLeft,
} from './rules';
import type {
  AttentionItem,
  CustomerTracking,
  DeliveryLine,
  HandOverResult,
  MapState,
  OpsMapSnapshot,
  PartnerDeliveryF8,
  PartnerTrackingNotice,
  PickedUpResult,
  ProblemKind,
  StaffTrackingDetail,
  TrackingRefusalDetails,
  TrackingRoute,
} from './schema';
import type { CheckedCode } from './code-fence';
import {
  askToWaitInput,
  CADENCE,
  cancelUnreachableInput,
  confirmHandoverInput,
  handOverInput,
  pickedUpInput,
  PROBLEM_KINDS,
  problemInput,
} from './schema';
import {
  attentionWords,
  customerNotices,
  deliveredWords,
  deliveryLineWords,
  mapStateWords,
} from './text';

/*
 * F8's services (contract §2 to §9). Partner steps go through definer functions as the partner;
 * staff steps through their own definer functions with an audit row in the same transaction;
 * the location pipeline, the estimate loop and the demo run act as the platform. One query at a
 * time per transaction and no nested transactions. Codes, coordinates, addresses and phones never
 * reach a log line.
 */

const timings = () => trackingTimings(process.env);
const problemOf = (value: string | null | undefined): ProblemKind | null =>
  PROBLEM_KINDS.find((kind) => kind === value) ?? null;
/** A48.2: the line carries `late` so the card can turn red. */
const withLate = (row: TrackedDelivery, line: DeliveryLine): DeliveryLine =>
  Object.assign(line, { late: lateAgainstPromise(row) });

const problemFact = (value: string | null): { kind: ProblemKind } | null => {
  const kind = problemOf(value);
  return kind ? { kind } : null;
};
const ACTIVE = new Set(['ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP']);
const TRACK = { delivery: ['track-any'] } as const satisfies Permission;
const CONFIRM = { delivery: ['confirm-handover'] } as const satisfies Permission;
const DEMO_CANNOT = 'Read-only in the demo';
/** Dana's Home (seeded): the demo run's drop-off. */
const DANA_HOME = {
  lat: 42.3467,
  lng: -71.0972,
  text: '12 Peterborough Street, Apt 3, Boston, MA 02215',
  line1: '12 Peterborough Street',
  line2: 'Apt 3',
  city: 'Boston, MA 02215',
} as const;

function refusal<K extends keyof TrackingRefusalDetails>(
  code: K,
  message: string,
  status: number,
  details: TrackingRefusalDetails[K],
): AppError {
  return new AppError(code, message, status, { details: { ...details } });
}

const notAssigned = (deliveryId: string) =>
  new AppError('NOT_ASSIGNED', "This order isn't yours any more.", 409, {
    details: { deliveryId },
  });

const changed = (orderNumber: string, status: string, version: number, orderId: string) =>
  new AppError(
    'DELIVERY_CHANGED',
    status === 'DELIVERED'
      ? `Order ${orderNumber} was delivered a moment ago.`
      : `Order ${orderNumber} changed a moment ago. Check it and try again.`,
    409,
    {
      details: {
        orderId,
        current: { status, version },
        how: 'other',
        by: { kind: 'system' },
        at: new Date().toISOString(),
      },
    },
  );

// ------------------------------------------------------------------ after commit

async function publishChanged(
  facts: { orderId: string; status: DeliveryChangedEvent['status']; version: number },
  partnerIds: readonly string[],
  notice?: PartnerTrackingNotice,
) {
  const data = {
    orderId: facts.orderId,
    status: facts.status,
    version: facts.version,
    at: new Date().toISOString(),
  };
  await publish(channels.ops, 'delivery.changed', data);
  await publish(channels.order(facts.orderId), 'delivery.changed', data);
  await Promise.all(
    partnerIds.map((id) =>
      publish(channels.partner(id), 'delivery.changed', notice ? { ...data, notice } : data),
    ),
  );
}

async function safely(label: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    logger.error({ err: error, effect: label }, 'tracking follow-up failed');
  }
}

/** A delivery ended as delivered: F5's notices, F9's event, F7's wake-up. */
async function afterDelivered(result: {
  deliveryId: string;
  orderId: string;
  partnerId: string;
  payCents: number;
  tipCents: number;
  cashCents: number;
  version: number;
  how: 'code' | 'staff-confirmed' | 'admin-override' | 'demo';
  notice?: PartnerTrackingNotice;
  orderNumber?: string;
}) {
  const at = new Date();
  const effects: OrderEffect[] = [
    { kind: 'publish', orderId: result.orderId, at: at.toISOString(), fromStatus: 'PICKED_UP' },
    { kind: 'notice', orderId: result.orderId, step: 'delivered' },
  ];
  await safely('order', () => runEffects(effects));
  if (result.notice === 'confirmed' && result.orderNumber) {
    const orderNumber = result.orderNumber;
    await safely('notice', () =>
      runAsSystem('partner notice', (ctx) =>
        repo.setPartnerNotice(ctx, result.partnerId, 'confirmed', orderNumber),
      ),
    );
  }
  await safely('changed', () =>
    publishChanged(
      { orderId: result.orderId, status: 'DELIVERED', version: result.version },
      [result.partnerId],
      result.notice,
    ),
  );
  // F9: his figures moved; the open app refetches (no amounts on the channel).
  await safely('earnings', () => announceEarnings(result.partnerId));
  await safely('delivered', () =>
    inngest.send(
      deliveryDelivered.create(
        {
          deliveryId: result.deliveryId,
          orderId: result.orderId,
          partnerId: result.partnerId,
          payCents: result.payCents,
          tipCents: result.tipCents,
          cashCents: result.cashCents,
          how: result.how,
          at: at.toISOString(),
        },
        { id: `delivery-delivered-${result.deliveryId}` },
      ),
    ),
  );
  await safely('assignment-ended', () =>
    inngest.send(
      deliveryAssignmentEnded.create(
        {
          deliveryId: result.deliveryId,
          orderId: result.orderId,
          partnerId: result.partnerId,
          how: 'delivered',
          at: at.toISOString(),
        },
        { id: `delivery-assignment-ended-${result.deliveryId}-${result.version}` },
      ),
    ),
  );
}

// ------------------------------------------------------------------ outcomes

const delivered = z.object({
  outcome: z.literal('delivered'),
  replayed: z.boolean().optional(),
  deliveryId: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  payCents: z.number(),
  tipCents: z.number().optional(),
  cashCents: z.number().optional(),
  version: z.number(),
  partnerId: z.string().optional(),
});
const handOverOutcome = z.discriminatedUnion('outcome', [
  delivered,
  z.object({
    outcome: z.literal('wrong'),
    triesLeft: z.number(),
    orderId: z.string().optional(),
    version: z.number().optional(),
    /** Gate S8: the same wrong code again within seconds (a re-send): not counted. */
    repeat: z.boolean().optional(),
  }),
  z.object({
    outcome: z.literal('locked'),
    orderId: z.string().optional(),
    version: z.number().optional(),
    justLocked: z.boolean().optional(),
  }),
  z.object({ outcome: z.literal('cash-required') }),
  z.object({ outcome: z.literal('not-assigned') }),
]);
const pickUpOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.enum(['picked-up', 'replayed']),
    deliveryId: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    version: z.number(),
  }),
  z.object({ outcome: z.literal('not-ready'), orderNumber: z.string() }),
  z.object({ outcome: z.literal('not-assigned') }),
]);
const problemOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('reported'),
    since: z.string(),
    orderId: z.string(),
    version: z.number(),
  }),
  z.object({ outcome: z.literal('replayed'), since: z.string(), orderId: z.string() }),
  z.object({ outcome: z.literal('not-assigned') }),
]);
const noAnswerOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('told'),
    toldAt: z.string(),
    orderId: z.string(),
    version: z.number(),
  }),
  z.object({ outcome: z.literal('replayed'), toldAt: z.string() }),
  z.object({ outcome: z.literal('too-early') }),
  z.object({ outcome: z.literal('not-assigned') }),
]);
const staffOutcome = z.discriminatedUnion('outcome', [
  delivered.extend({ how: z.enum(['staff-confirmed', 'admin-override']) }),
  z.object({
    outcome: z.literal('waiting'),
    deliveryId: z.string(),
    orderId: z.string(),
    partnerId: z.string().nullable(),
    since: z.string(),
    version: z.number(),
  }),
  z.object({
    outcome: z.literal('cancelled'),
    deliveryId: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    partnerId: z.string().nullable(),
    version: z.number(),
    paidByCard: z.boolean(),
  }),
  z.object({ outcome: z.literal('changed'), status: z.string(), version: z.number() }),
  z.object({ outcome: z.literal('not-stuck') }),
  z.object({ outcome: z.literal('cash-required') }),
  z.object({ outcome: z.literal('not-found') }),
]);

// ------------------------------------------------------------------ the partner's steps (P37 to P46)

async function partnerOf(actor: UserActor) {
  if (actor.role !== 'partner' || !can(actor.role, { partner: ['deliver'] })) throw forbidden();
  const partner = await runAs(actor, (ctx) => repo.findPartnerOfUser(ctx, actor.userId));
  if (partner?.status !== 'APPROVED') {
    throw new AppError('NOT_APPROVED', 'Your partner account is not approved to deliver.', 403);
  }
  return partner;
}

const ROUTE_LINE = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

function routeOf(row: TrackedDelivery): TrackingRoute | null {
  if (row.routeDistanceM === null || row.routeDurationSec === null || !row.etaAt) return null;
  return {
    geojson: ROUTE_LINE.safeParse(row.routeGeojson).data ?? null,
    distanceM: row.routeDistanceM,
    durationSec: row.routeDurationSec,
    etaAt: row.etaAt.toISOString(),
    estimated: row.etaEstimated,
  };
}

/** `GET /api/v1/partner/deliveries/current` in F8. */
export async function getCurrentDeliveryF8(actor: UserActor): Promise<PartnerDeliveryF8 | null> {
  const base = await getCurrentDelivery(actor);
  if (!base) return null;
  const row = await runAsSystem('partner tracking', (ctx) =>
    repo.findTracked(ctx, base.deliveryId),
  );
  if (!row) return null;
  const stage = stageOf(row.status) ?? 'toKitchen';
  const t = timings();
  const clock = noAnswerClock(
    row.noAnswerSince?.toISOString() ?? null,
    new Date(),
    t.noAnswerSeconds,
  );
  const { dropoff: _f7, ...rest } = base;
  void _f7;
  return {
    ...rest,
    stage,
    orderReady: row.orderStatus === 'READY' || row.orderStatus === 'PICKED_UP',
    route: routeOf(row),
    dropoff:
      row.status === 'PICKED_UP'
        ? {
            firstName: firstNameOf(row.contactName),
            addressText: row.addressText,
            apt: row.addressLine2,
            instructions: row.instructions,
            point: { lat: row.dropLat, lng: row.dropLng },
            phone: row.contactPhone,
          }
        : null,
    noAnswer: row.noAnswerSince
      ? {
          since: row.noAnswerSince.toISOString(),
          reportable: clock.reportable,
          told: Boolean(row.noAnswerReportedAt && row.noAnswerReportedAt >= row.noAnswerSince),
          waitRestartedAt: row.noAnswerWaitRestartedAt?.toISOString() ?? null,
        }
      : null,
    problem: problemFact(row.problemKind),
    otp: { locked: row.otpLockedAt !== null, triesLeft: triesLeft(row.otpWrongTries) },
    // P43.4: "asked to wait" stays readable for 10 minutes for a phone that missed the event.
    notice:
      row.noAnswerWaitRestartedAt &&
      Date.now() - row.noAnswerWaitRestartedAt.getTime() <= 10 * 60_000
        ? {
            kind: 'askedToWait',
            orderNumber: row.orderNumber,
            at: row.noAnswerWaitRestartedAt.toISOString(),
          }
        : null,
  };
}

/** P38: "Picked up". The code is drawn and sealed here, and stored by the definer function. */
export async function pickUp(
  actor: UserActor,
  deliveryId: string,
  input: unknown,
): Promise<PickedUpResult> {
  const id = z.uuid().parse(deliveryId);
  const { confirmFar } = pickedUpInput.parse(input ?? {});
  await partnerOf(actor);
  const code = drawCode(randomInt);
  const result = pickUpOutcome.parse(
    await runAs(actor, (ctx) =>
      repo.pickUp(
        ctx,
        id,
        encryptField(code, deliveryCodeContext(id)),
        deliveryCodeHash(id, code),
        Boolean(confirmFar),
      ),
    ),
  );
  if (result.outcome === 'not-assigned') throw notAssigned(id);
  if (result.outcome === 'not-ready') {
    throw refusal(
      'ORDER_NOT_READY',
      `The kitchen is still preparing order ${result.orderNumber}.`,
      409,
      {
        orderNumber: result.orderNumber,
      },
    );
  }
  if (result.outcome === 'picked-up') {
    const at = new Date().toISOString();
    await safely('order', () =>
      runEffects([
        { kind: 'publish', orderId: result.orderId, at, fromStatus: 'READY' },
        { kind: 'notice', orderId: result.orderId, step: 'picked-up' },
      ]),
    );
    await safely('changed', () =>
      publishChanged({ orderId: result.orderId, status: 'PICKED_UP', version: result.version }, []),
    );
    await safely('replan', () => requestReplan(id, true));
  }
  return { deliveryId: id, version: result.version, replayed: result.outcome === 'replayed' };
}

/** A51.2: ADMIN marked a held delivery delivered by hand; the courier's phone is told. */
export async function notifyMarkedDelivered(orderId: string): Promise<void> {
  const row = await runAsSystem('marked delivered', async (ctx) => {
    const found = await repo.findTrackedByOrder(ctx, orderId);
    if (found?.status === 'DELIVERED' && found.partnerId) {
      await repo.markOverride(ctx, found.deliveryId);
      await repo.setPartnerNotice(ctx, found.partnerId, 'markedDelivered', found.orderNumber);
    }
    return found;
  });
  if (row?.status !== 'DELIVERED' || !row.partnerId) return;
  const partnerId = row.partnerId;
  await safely('changed', () =>
    publishChanged(
      { orderId, status: 'DELIVERED', version: row.version },
      [partnerId],
      'markedDelivered',
    ),
  );
  await safely('delivered', () =>
    inngest.send(
      deliveryDelivered.create(
        {
          deliveryId: row.deliveryId,
          orderId,
          partnerId,
          payCents: row.partnerFeeCents,
          // The offer pay (fee and tip) is frozen on the delivery row (F7 U12), like every other ending.
          tipCents: row.tipCents,
          cashCents: row.paymentMethod === 'CASH' ? row.totalCents : 0,
          how: 'admin-override',
          at: new Date().toISOString(),
        },
        { id: `delivery-delivered-${row.deliveryId}` },
      ),
    ),
  );
}

/** A53: the detail's tracking data for SUPPORT and ADMIN (the demo admin: demo orders only). */
export async function staffTrackingDetail(
  viewer: { role: string; isDemo: boolean },
  orderId: string,
  now = new Date(),
): Promise<StaffTrackingDetail | null> {
  if (viewer.role === 'kitchen') return null;
  const row = await runAsSystem('staff tracking', (ctx) => repo.findTrackedByOrder(ctx, orderId));
  if (!row?.partnerId) return null;
  const hidden = viewer.isDemo && !row.customerIsDemo;
  const late = lateAgainstPromise(row);
  return {
    steps: {
      assignedAt: row.assignedAt?.toISOString() ?? null,
      atKitchenAt: row.atRestaurantAt?.toISOString() ?? null,
      pickedUpAt: row.pickedUpAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      noAnswerSince: row.noAnswerSince?.toISOString() ?? null,
      codeLockedAt: row.otpLockedAt?.toISOString() ?? null,
      problem: problemFact(row.problemKind)?.kind ?? null,
    },
    point:
      hidden || row.lastLat === null || row.lastLng === null || !ACTIVE.has(row.status)
        ? null
        : {
            lat: roundCoordinate(row.lastLat),
            lng: roundCoordinate(row.lastLng),
            at: row.lastPointAt?.toISOString() ?? null,
            freshness: freshnessOf(row.lastPointAt?.toISOString() ?? null, now),
          },
    route: hidden || !ACTIVE.has(row.status) ? null : routeOf(row),
    dropoffPoint: hidden ? null : { lat: row.dropLat, lng: row.dropLng },
    etaAt: row.etaAt?.toISOString() ?? null,
    estimated: row.etaEstimated,
    late,
  };
}

/** A48.2: the estimate is more than 10 minutes past the promised window. */
function lateAgainstPromise(row: TrackedDelivery): boolean {
  if (!row.etaAt || !row.placedAt || row.arrivalToMinutes === null) return false;
  const promised = row.placedAt.getTime() + row.arrivalToMinutes * 60_000;
  return row.etaAt.getTime() - promised > 10 * 60_000;
}

/** A51.1: ADMIN's "keep the courier" pickup still ends with the customer's code. */
export async function issueCodeForOrder(orderId: string): Promise<void> {
  const row = await runAsSystem('issue code', (ctx) => repo.findTrackedByOrder(ctx, orderId));
  if (row?.status !== 'PICKED_UP') return;
  const code = drawCode(randomInt);
  await runAsSystem('issue code', (ctx) =>
    repo.storeCode(
      ctx,
      row.deliveryId,
      encryptField(code, deliveryCodeContext(row.deliveryId)),
      deliveryCodeHash(row.deliveryId, code),
    ),
  );
}

/** P41, P42: the code check, atomic with the try count in the database. */
export async function handOver(
  actor: UserActor,
  deliveryId: string,
  input: unknown,
): Promise<HandOverResult> {
  return (await checkCode(actor, deliveryId, input)).result;
}

/**
 * The code check with whether it told anything about the code (gate S9): the courier's route
 * gives the `delivery.otp` point back when it didn't (a right code, a repeat not counted).
 */
export async function checkCode(
  actor: UserActor,
  deliveryId: string,
  input: unknown,
): Promise<CheckedCode> {
  const id = z.uuid().parse(deliveryId);
  const body = handOverInput.parse(input);
  await partnerOf(actor);
  const { result, today } = await runAs(actor, async (ctx) => {
    const outcome = handOverOutcome.parse(
      await repo.handOver(
        ctx,
        id,
        deliveryCodeHash(id, body.code),
        Boolean(body.cashCollected),
        Boolean(body.confirmFar),
      ),
    );
    return {
      result: outcome,
      today:
        outcome.outcome === 'delivered' && outcome.partnerId
          ? await todayLineIn(ctx, outcome.partnerId)
          : null,
    };
  });
  logger.info({ deliveryId: id, outcome: result.outcome }, 'hand-over');
  switch (result.outcome) {
    case 'not-assigned':
      throw notAssigned(id);
    case 'cash-required': {
      const message = 'Tick this once you have the cash.';
      throw invalidInput(message, { cashCollected: [message] });
    }
    case 'wrong': {
      const { orderId, version } = result;
      if (!result.repeat && orderId && version !== undefined) {
        await safely('changed', () =>
          publishChanged({ orderId, status: 'PICKED_UP', version }, []),
        );
      }
      return {
        result: { outcome: 'wrong', triesLeft: result.triesLeft },
        counts: !result.repeat,
      };
    }
    case 'locked':
      if (result.justLocked && result.orderId && result.version !== undefined) {
        const { orderId, version } = result;
        logger.warn({ deliveryId: id, alert: 'delivery-code-locked' }, 'delivery code locked');
        await safely('changed', () =>
          publishChanged({ orderId, status: 'PICKED_UP', version }, []),
        );
      }
      return { result: { outcome: 'locked' }, counts: true };
    default:
      break;
  }
  if (!result.replayed && result.partnerId) {
    await afterDelivered({
      deliveryId: id,
      orderId: result.orderId,
      partnerId: result.partnerId,
      payCents: result.payCents,
      tipCents: result.tipCents ?? 0,
      cashCents: result.cashCents ?? 0,
      version: result.version,
      how: actor.isDemo ? 'demo' : 'code',
    });
  }
  return {
    result: {
      outcome: 'delivered',
      payWords: deliveredWords(result.orderNumber, result.payCents),
      today,
    },
    counts: false,
  };
}

/** P43.1: a problem at the door; "isn't answering" starts the 5-minute clock. */
export async function reportProblem(
  actor: UserActor,
  deliveryId: string,
  input: unknown,
): Promise<{ since: string }> {
  const id = z.uuid().parse(deliveryId);
  const { kind } = problemInput.parse(input);
  await partnerOf(actor);
  const result = problemOutcome.parse(
    await runAs(actor, (ctx) => repo.reportProblem(ctx, id, kind)),
  );
  if (result.outcome === 'not-assigned') throw notAssigned(id);
  const since = new Date(result.since).toISOString();
  if (result.outcome === 'reported') {
    const { orderId, version } = result;
    await safely('changed', () => publishChanged({ orderId, status: 'PICKED_UP', version }, []));
    if (kind === 'no-answer') await noAnswerStarted(id, orderId, since);
  }
  return { since };
}

async function noAnswerStarted(deliveryId: string, orderId: string, since: string) {
  await safely('no-answer job', () =>
    inngest.send(
      deliveryNoAnswerStarted.create(
        { deliveryId, orderId, since },
        { id: `delivery-no-answer-${deliveryId}-${Date.parse(since)}` },
      ),
    ),
  );
  await safely('at-door notice', async () => {
    const row = await runAsSystem('at-door notice', (ctx) => repo.findTracked(ctx, deliveryId));
    if (!row) return;
    const phone = await runAsSystem('kitchen phone', storePhone);
    const notice = customerNotices.atDoor(firstNameOf(row.partnerName ?? 'Your courier'), phone);
    await notify({
      userId: row.customerId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      link: `/orders/${row.orderId}`,
      order: { orderId: row.orderId, orderNumber: row.orderNumber, status: 'pickedUp' },
    });
  });
}

async function storePhone(ctx: DbContext): Promise<string> {
  const row = await repo.findStorePhone(ctx);
  return row ? displayPhone(row).display : 'Foodz Kitchen';
}

/** P43.3: "Tell Foodz nobody answered", once the clock has run out. */
export async function reportNoAnswer(
  actor: UserActor,
  deliveryId: string,
): Promise<{ toldAt: string }> {
  const id = z.uuid().parse(deliveryId);
  await partnerOf(actor);
  const result = noAnswerOutcome.parse(
    await runAs(actor, (ctx) => repo.reportNoAnswer(ctx, id, timings().noAnswerSeconds)),
  );
  if (result.outcome === 'not-assigned') throw notAssigned(id);
  if (result.outcome === 'too-early') {
    throw new AppError('INVALID_STATE', 'Wait the full 5 minutes first.', 409, {
      details: { deliveryId: id },
    });
  }
  if (result.outcome === 'told') {
    const { orderId, version } = result;
    await safely('changed', () => publishChanged({ orderId, status: 'PICKED_UP', version }, []));
  }
  return { toldAt: new Date(result.toldAt).toISOString() };
}

// ------------------------------------------------------------------ the location pipeline (L1 to L3)

/** Throttles by a Redis key that lives for `ms`: true when this caller may go ahead. */
async function gate(key: string, ms: number): Promise<boolean> {
  return (await redis.set(key, '1', 'PX', ms, 'NX')) === 'OK';
}

async function requestReplan(deliveryId: string, now = false) {
  if (!now && !(await gate(`route:${deliveryId}`, timings().etaSeconds * 1000))) return;
  await inngest.send(
    deliveryReplanRequested.create(
      { deliveryId, at: new Date().toISOString() },
      { id: `delivery-replan-${deliveryId}-${Math.floor(Date.now() / 1000)}` },
    ),
  );
}

function mapStateFor(row: TrackedDelivery | null, hasOpenOffer: boolean): MapState {
  return mapStateOf({
    deliveryStatus: row?.status ?? null,
    hasOpenOffer,
    noAnswerSince: row?.noAnswerSince?.toISOString() ?? null,
    locked: Boolean(row?.otpLockedAt),
    problem: Boolean(row?.problemKind),
  });
}

/**
 * Each accepted point of an online partner (F6's route, or the demo run for the bot): history,
 * "at the kitchen", "almost there", the customer's and the map's positions, re-plans.
 */
export async function pointAccepted(input: {
  partnerId: string;
  isDemo: boolean;
  point: { lat: number; lng: number; heading: number | null; speed: number | null };
  acceptedAt: Date;
}): Promise<void> {
  const { partnerId, point } = input;
  const at = input.acceptedAt.toISOString();
  const work = await runAsSystem('point accepted', async (ctx) => {
    const row = await repo.findHeldBy(ctx, partnerId);
    if (!row) return { row: null, atKitchenVersion: null, almost: false };
    const last = await repo.lastLocationAt(ctx, row.deliveryId);
    if (historyDue(last?.toISOString() ?? null, input.acceptedAt)) {
      await repo.insertLocation(ctx, row.deliveryId, {
        lat: point.lat,
        lng: point.lng,
        heading: point.heading,
        speedKmh: point.speed === null ? null : point.speed * 3.6,
      });
    }
    let atKitchenVersion: number | null = null;
    if (
      row.status === 'ASSIGNED' &&
      atKitchen(distanceM(point, { lat: row.kitchenLat, lng: row.kitchenLng }))
    ) {
      atKitchenVersion = await repo.markAtRestaurant(ctx, row.deliveryId);
      if (atKitchenVersion !== null) {
        await repo.insertOrderEvent(ctx, {
          orderId: row.orderId,
          type: 'courier-at-kitchen',
          actorId: null,
          data: { partnerId },
        });
      }
    }
    let almost = false;
    if (row.status === 'PICKED_UP') {
      const toDoor = distanceM(point, { lat: row.dropLat, lng: row.dropLng });
      if (
        almostThere(toDoor, row.routeDurationSec) &&
        (await repo.markAlmost(ctx, row.deliveryId))
      ) {
        almost = true;
        await repo.insertOrderEvent(ctx, {
          orderId: row.orderId,
          type: 'courier-almost-there',
          actorId: null,
          data: { partnerId },
        });
      }
    }
    return { row, atKitchenVersion, almost };
  });
  const { row } = work;
  if (row) {
    if (work.atKitchenVersion !== null) {
      const version = work.atKitchenVersion;
      await safely('changed', () =>
        publishChanged({ orderId: row.orderId, status: 'AT_RESTAURANT', version }, [partnerId]),
      );
    }
    if (
      row.status === 'PICKED_UP' &&
      (await gate(`pub:track:${row.orderId}`, CADENCE.customerMs))
    ) {
      await safely('track', () =>
        publish(channels.track(row.orderId), 'courier.location', {
          orderId: row.orderId,
          lat: roundCoordinate(point.lat),
          lng: roundCoordinate(point.lng),
          heading: point.heading,
          at,
        }),
      );
    }
    if (work.almost) {
      const minutes = Math.max(1, Math.ceil((row.routeDurationSec ?? 60) / 60));
      const notice = customerNotices.almostHere(
        row.orderNumber,
        firstNameOf(row.partnerName ?? 'Your courier'),
        minutes,
      );
      await safely('almost notice', () =>
        notify({
          userId: row.customerId,
          type: notice.type,
          title: notice.title,
          body: notice.body,
          link: `/orders/${row.orderId}`,
          order: { orderId: row.orderId, orderNumber: row.orderNumber, status: 'pickedUp' },
        }),
      );
    }
    const coordinates = ROUTE_LINE.safeParse(row.routeGeojson).data?.coordinates ?? null;
    if (offRoute(point, coordinates)) await safely('replan', () => requestReplan(row.deliveryId));
  }
  await safely('map', () =>
    publishMapPoint(partnerId, input.isDemo, point, at, mapStateFor(row, false)),
  );
}

async function publishMapPoint(
  partnerId: string,
  isDemo: boolean,
  point: { lat: number; lng: number; heading: number | null },
  at: string,
  state: MapState,
) {
  const stateKey = `map:state:${partnerId}`;
  const previous = await redis.get(stateKey);
  await redis.set(stateKey, state, 'EX', 600);
  const due = previous !== state || (await gate(`pub:map:${partnerId}`, CADENCE.opsMapMs));
  if (!due) return;
  await publish(isDemo ? channels.opsMapDemo : channels.opsMap, 'courier.position', {
    partnerId,
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
    heading: point.heading,
    state,
    at,
  });
}

// ------------------------------------------------------------------ the estimate (L4) and the clock (U6)

/** One step of the `delivery-eta` loop. */
export async function refreshEstimate(
  deliveryId: string,
): Promise<{ active: boolean; route: TrackingRoute | null }> {
  const row = await runAsSystem('estimate', (ctx) => repo.findTracked(ctx, deliveryId));
  if (!row || !ACTIVE.has(row.status) || !row.partnerId) return { active: false, route: null };
  const live = await readPoint(row.partnerId);
  const from = live ??
    (row.lastLat !== null && row.lastLng !== null
      ? { lat: row.lastLat, lng: row.lastLng }
      : null) ?? {
      lat: row.kitchenLat,
      lng: row.kitchenLng,
    };
  const to =
    row.status === 'PICKED_UP'
      ? { lat: row.dropLat, lng: row.dropLng }
      : { lat: row.kitchenLat, lng: row.kitchenLng };
  const route = await routeBetween(from, to, row.vehicle ?? 'SCOOTER', { deliveryId });
  await runAsSystem('estimate', (ctx) => repo.writeRoute(ctx, deliveryId, route));
  // A46: the neighborhood for "Priya · Downtown", once, from the drop-off's geocode.
  if (row.addressArea === null || row.addressArea === cityAndZip(row.addressCity)) {
    const area = await neighborhoodOf({ lat: row.dropLat, lng: row.dropLng });
    if (area) await runAsSystem('order area', (ctx) => repo.setOrderArea(ctx, row.orderId, area));
  }
  if (etaShiftWorthPushing(row.etaAt?.toISOString() ?? null, route.etaAt.toISOString())) {
    await safely('changed', () =>
      publishChanged(
        {
          orderId: row.orderId,
          status: row.status,
          version: row.version,
        },
        [],
      ),
    );
  }
  return {
    active: true,
    route: {
      geojson: route.geojson,
      distanceM: route.distanceM,
      durationSec: route.durationSec,
      etaAt: route.etaAt.toISOString(),
      estimated: route.estimated,
    },
  };
}

/** The 5-minute mark of a no-answer wait (job step): repaints the board and the phone. */
export async function noAnswerDue(deliveryId: string, since: string): Promise<'due' | 'moved-on'> {
  const row = await runAsSystem('no-answer due', (ctx) => repo.findTracked(ctx, deliveryId));
  if (
    row?.status !== 'PICKED_UP' ||
    row.noAnswerSince?.toISOString() !== new Date(since).toISOString()
  ) {
    return 'moved-on';
  }
  await publishChanged(
    { orderId: row.orderId, status: 'PICKED_UP', version: row.version },
    row.partnerId ? [row.partnerId] : [],
  );
  return 'due';
}

// ------------------------------------------------------------------ the customer (S1 to S7)

/** B7: for the order's own customer, from acceptance (words only) through delivery; else null. */
export async function getCustomerTracking(
  actor: UserActor,
  orderId: string,
): Promise<CustomerTracking | null> {
  const own = await runAs(actor, (ctx) => repo.findOwnOrder(ctx, orderId, actor.userId));
  if (!own) return null;
  const row = await runAsSystem('customer tracking', (ctx) =>
    repo.findTrackedByOrder(ctx, orderId),
  );
  const stage = row ? stageOf(row.status) : null;
  if (!row || !stage || !row.partnerId) return null;
  const pickedUp = row.status === 'PICKED_UP';
  let code: string | null = null;
  let courierPoint: CustomerTracking['courierPoint'] = null;
  if (pickedUp) {
    const sealed = await runAs(actor, (ctx) => repo.findCodeEnc(ctx, row.deliveryId));
    code = sealed ? decryptField(sealed, deliveryCodeContext(row.deliveryId)) : null;
    const live = await readPoint(row.partnerId);
    const point =
      live ??
      (row.lastLat !== null && row.lastLng !== null
        ? { lat: row.lastLat, lng: row.lastLng, heading: null }
        : null);
    const at = live?.acceptedAt ?? row.lastPointAt?.toISOString() ?? null;
    if (point && at) {
      courierPoint = {
        lat: roundCoordinate(point.lat),
        lng: roundCoordinate(point.lng),
        heading: point.heading ?? null,
        at,
      };
    }
  }
  return {
    stage,
    courierPoint,
    route: pickedUp ? routeOf(row) : null,
    dropoffPoint: { lat: row.dropLat, lng: row.dropLng },
    almost: pickedUp && row.almostNotifiedAt !== null,
    atDoor: pickedUp && row.noAnswerSince !== null,
    code,
  };
}

// ------------------------------------------------------------------ staff (A46 to A54)

async function requireStaff(actor: UserActor, permission: Permission, write: boolean) {
  const checked = await requirePermission(permission, { write, demoMessage: DEMO_CANNOT });
  if (checked.userId !== actor.userId) throw unauthenticated();
  return { userId: checked.userId, role: checked.role, isDemo: checked.isDemo };
}

const maskName = (name: string) => `${name.trim().charAt(0)}•••`;

function lineFacts(row: TrackedDelivery, now: Date): DeliveryFacts {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    status: row.status,
    lastPointAt: row.lastPointAt?.toISOString() ?? null,
    distanceToDoorM:
      row.lastLat === null || row.lastLng === null
        ? null
        : Math.round(
            distanceM(
              { lat: row.lastLat, lng: row.lastLng },
              { lat: row.dropLat, lng: row.dropLng },
            ),
          ),
    durationSec: row.etaAt
      ? Math.max(0, Math.round((row.etaAt.getTime() - now.getTime()) / 1000))
      : null,
    noAnswerSince: row.noAnswerSince?.toISOString() ?? null,
    lockedAt: row.otpLockedAt?.toISOString() ?? null,
    problem:
      problemOf(row.problemKind) && row.problemAt
        ? { kind: problemOf(row.problemKind) ?? 'other', at: row.problemAt.toISOString() }
        : null,
  };
}

/** A48, A49: the Out-for-delivery lines and the stuck-delivery list for the board. */
export async function boardTracking(
  viewer: { isDemo: boolean },
  timeZone: string,
  now = new Date(),
): Promise<{ lines: Map<string, DeliveryLine>; attention: AttentionItem[] }> {
  const rows = await runAsSystem('board tracking', (ctx) =>
    repo.listActive(ctx, viewer.isDemo ? 'DEMO' : 'REAL'),
  );
  const t = timings();
  const lines = new Map<string, DeliveryLine>();
  const picked = rows.filter((row) => row.status === 'PICKED_UP');
  for (const row of picked) {
    const facts = lineFacts(row, now);
    const state = deliveryLineState(facts, now, t.noAnswerSeconds);
    const name = row.partnerName ?? 'Courier';
    const silent = row.lastPointAt
      ? Math.floor((now.getTime() - row.lastPointAt.getTime()) / 60_000)
      : 0;
    lines.set(
      row.orderId,
      withLate(
        row,
        deliveryLineWords({
          ...state,
          courierShort: shortName(viewer.isDemo ? maskName(name) : name),
          customerFirst: firstNameOf(row.contactName),
          distanceToDoorM: facts.distanceToDoorM,
          arrivalClock: row.etaAt
            ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
                .format(row.etaAt)
                .replace(' AM', ' am')
                .replace(' PM', ' pm')
            : null,
          silentMinutes: silent,
          waitedMinutes: row.noAnswerSince
            ? Math.floor((now.getTime() - row.noAnswerSince.getTime()) / 60_000)
            : 0,
          problem: facts.problem?.kind ?? null,
        }),
      ),
    );
  }
  const items = attentionOf(
    picked.map((row) => lineFacts(row, now)),
    now,
  );
  const byOrder = new Map(rows.map((row) => [row.orderId, row]));
  const attention = items.map((item): AttentionItem => {
    const row = byOrder.get(item.orderId);
    return {
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      kind: item.kind,
      since: item.since,
      minutes: item.minutes,
      words: attentionWords({
        kind: item.kind,
        orderNumber: item.orderNumber,
        courierFirst: firstNameOf(
          viewer.isDemo ? maskName(row?.partnerName ?? 'Courier') : (row?.partnerName ?? 'Courier'),
        ),
        customerFirst: firstNameOf(row?.contactName ?? 'The customer'),
        minutes: item.minutes,
        problem: problemOf(row?.problemKind),
      }),
    };
  });
  return { lines, attention };
}

/** L3.3: the live map snapshot for the viewer's pool (demo admin: demo only). */
export async function getOpsMap(actor: UserActor, now = new Date()): Promise<OpsMapSnapshot> {
  const viewer = await requireStaff(actor, TRACK, false);
  const pool = viewer.isDemo ? 'DEMO' : 'REAL';
  const data = await runAsSystem('ops map', async (ctx) => ({
    couriers: await repo.listOnlineCouriers(ctx, pool),
    active: await repo.listActive(ctx, pool),
    ready: await repo.listReadyWithoutCourier(ctx, pool),
    running: viewer.isDemo ? await repo.findRunningDemo(ctx) : null,
    starts: viewer.isDemo
      ? await repo.listDemoStarts(ctx, new Date(now.getTime() - 3_600_000))
      : [],
    kitchen: await repo.findKitchenPoint(ctx),
  }));
  // A49 (design 3.9): the stuck-delivery banners show on the live map too, from the same pool.
  const { attention } = await boardTracking(viewer, STORE_TIME_ZONE, now);
  const byPartner = new Map(
    data.active.flatMap((row) => (row.partnerId ? [[row.partnerId, row] as const] : [])),
  );
  const verdict = demoRunVerdict({
    running: data.running ? { endsAt: data.running.endsAt.toISOString() } : null,
    startsInLastHour: data.starts,
    now,
  });
  return {
    asOf: now.toISOString(),
    pool,
    couriers: data.couriers.map((courier) => {
      const row = byPartner.get(courier.partnerId) ?? null;
      const state = mapStateFor(row, courier.hasOpenOffer);
      const name = viewer.isDemo && !courier.shownToDemo ? maskName(courier.name) : courier.name;
      const silent = courier.lastPointAt
        ? Math.floor((now.getTime() - courier.lastPointAt.getTime()) / 60_000)
        : null;
      const orderNumber = row?.orderNumber ?? courier.offeredOrderNumber;
      return {
        partnerId: courier.partnerId,
        fullName: name,
        shortName: shortName(name),
        vehicle: courier.vehicle,
        vehicleWords: courierVehicle(
          courier.vehicle,
          viewer.isDemo && !courier.shownToDemo ? null : courier.plate,
        ),
        plate: viewer.isDemo && !courier.shownToDemo ? null : courier.plate,
        state,
        words: mapStateWords(state, orderNumber, silent),
        orderId: row?.orderId ?? null,
        orderNumber,
        point:
          courier.lat === null || courier.lng === null
            ? null
            : { lat: roundCoordinate(courier.lat), lng: roundCoordinate(courier.lng) },
        heading: null,
        at: courier.lastPointAt?.toISOString() ?? null,
        freshness: freshnessOf(courier.lastPointAt?.toISOString() ?? null, now),
        phone:
          viewer.isDemo || !courier.phone
            ? null
            : { e164: courier.phone, display: displayPhone(courier.phone).display },
      };
    }),
    deliveries: data.active.map((row) => {
      const promised =
        row.placedAt && row.arrivalToMinutes !== null
          ? row.placedAt.getTime() + row.arrivalToMinutes * 60_000
          : null;
      return {
        orderId: row.orderId,
        number: row.orderNumber,
        courierShortName: shortName(
          viewer.isDemo ? maskName(row.partnerName ?? 'Courier') : (row.partnerName ?? 'Courier'),
        ),
        stateWords: mapStateWords(mapStateFor(row, false), row.orderNumber, null),
        etaAt: row.etaAt?.toISOString() ?? null,
        lateMinutes:
          row.etaAt && promised !== null
            ? Math.max(0, Math.round((row.etaAt.getTime() - promised) / 60_000))
            : null,
        dropoffPoint: { lat: row.dropLat, lng: row.dropLng },
        customerFirstName:
          viewer.isDemo && !row.customerIsDemo
            ? maskName(row.contactName)
            : firstNameOf(row.contactName),
        areaWords: row.addressArea ?? cityAndZip(row.addressCity),
      };
    }),
    readyWithoutCourier: data.ready.map((order) => ({
      orderId: order.orderId,
      number: order.number,
      readyAt: order.readyAt.toISOString(),
    })),
    attention,
    kitchen: data.kitchen,
    demoRun: viewer.isDemo
      ? {
          running: Boolean(data.running),
          orderNumber: null,
          endsAt: data.running?.endsAt.toISOString() ?? null,
          runsLeft: Math.max(0, 6 - data.starts.length),
          nextAt: verdict.ok ? null : verdict.why === 'limit' ? verdict.nextAt : null,
        }
      : null,
  };
}

async function staffStep(
  actor: UserActor,
  orderId: string,
  step: (ctx: DbContext, row: TrackedDelivery) => Promise<unknown>,
) {
  return runAs(actor, async (ctx) => {
    const row = await repo.findTrackedByOrder(ctx, orderId);
    if (!row) throw notFound('Order not found.');
    return { row, raw: await step(ctx, row) };
  });
}

/** A50.1: SUPPORT (stuck only) and ADMIN confirm a hand-over, audited. */
export async function confirmHandover(
  actor: UserActor,
  input: unknown,
): Promise<StaffDispatchResult> {
  const body = confirmHandoverInput.parse(input);
  await requireStaff(actor, CONFIRM, true);
  const t = timings();
  const outcome = await runAs(actor, async (ctx) => {
    const row = await repo.findTrackedByOrder(ctx, body.orderId);
    if (!row) throw notFound('Order not found.');
    const result = staffOutcome.parse(
      await repo.staffConfirm(ctx, {
        id: row.deliveryId,
        version: body.expectedVersion,
        reason: body.reason,
        cash: Boolean(body.cashCollected),
        waitSeconds: t.noAnswerSeconds,
        note: body.note ?? null,
      }),
    );
    if (result.outcome === 'delivered') {
      await audit(ctx, {
        action: 'tracking.handover-confirmed',
        targetType: 'order',
        targetId: body.orderId,
        data: {
          number: row.orderNumber,
          reason: body.reason,
          hasNote: Boolean(body.note),
          cashCollectedCents: result.cashCents ?? 0,
          how: result.how,
        },
      });
    }
    return { row, result };
  });
  const { row, result } = outcome;
  if (result.outcome === 'not-found') throw notFound('Order not found.');
  if (result.outcome === 'changed')
    throw changed(row.orderNumber, result.status, result.version, row.orderId);
  if (result.outcome === 'not-stuck') {
    throw refusal(
      'CONFIRM_NOT_ALLOWED',
      'Confirm a hand-over after a code lock or 5 minutes without an answer.',
      409,
      {
        why: 'not-stuck',
      },
    );
  }
  if (result.outcome === 'cash-required') {
    const message = 'Tick this once the cash is collected.';
    throw invalidInput(message, { cashCollected: [message] });
  }
  if (result.outcome !== 'delivered')
    throw changed(row.orderNumber, row.status, row.version, row.orderId);
  await afterDelivered({
    deliveryId: result.deliveryId,
    orderId: result.orderId,
    partnerId: result.partnerId ?? row.partnerId ?? '',
    payCents: result.payCents,
    tipCents: result.tipCents ?? 0,
    cashCents: result.cashCents ?? 0,
    version: result.version,
    how: result.how,
    notice: 'confirmed',
    orderNumber: row.orderNumber,
  });
  return {
    orderId: result.orderId,
    deliveryId: result.deliveryId,
    version: result.version,
    at: new Date().toISOString(),
    replayed: false,
  };
}

/** A50.1: "Ask Luis to wait 5 more minutes". */
export async function askToWait(actor: UserActor, input: unknown): Promise<StaffDispatchResult> {
  const body = askToWaitInput.parse(input);
  await requireStaff(actor, CONFIRM, true);
  const { row, raw } = await staffStep(actor, body.orderId, async (ctx, found) => {
    const result = await repo.staffAskToWait(ctx, found.deliveryId, body.expectedVersion);
    const parsed = staffOutcome.parse(result);
    if (parsed.outcome === 'waiting') {
      await audit(ctx, {
        action: 'tracking.asked-to-wait',
        targetType: 'order',
        targetId: body.orderId,
        data: { number: found.orderNumber },
      });
    }
    return parsed;
  });
  const result = staffOutcome.parse(raw);
  if (result.outcome !== 'waiting') {
    throw changed(
      row.orderNumber,
      'status' in result ? result.status : row.status,
      'version' in result ? result.version : row.version,
      row.orderId,
    );
  }
  const since = new Date(result.since).toISOString();
  await safely('changed', () =>
    publishChanged(
      { orderId: result.orderId, status: 'PICKED_UP', version: result.version },
      result.partnerId ? [result.partnerId] : [],
      'askedToWait',
    ),
  );
  await safely('no-answer job', () =>
    inngest.send(
      deliveryNoAnswerStarted.create(
        { deliveryId: result.deliveryId, orderId: result.orderId, since },
        { id: `delivery-no-answer-${result.deliveryId}-${Date.parse(since)}` },
      ),
    ),
  );
  return {
    orderId: result.orderId,
    deliveryId: result.deliveryId,
    version: result.version,
    at: since,
    replayed: false,
  };
}

/** A50.1, U6: "Cancel and bring it back" with F5's refund rules (step-up for a paid card). */
export async function cancelUnreachable(
  actor: UserActor,
  input: unknown,
): Promise<StaffDispatchResult> {
  const body = cancelUnreachableInput.parse(input);
  const viewer = await requireStaff(actor, CONFIRM, true);
  const paid = await runAsSystem('cancel check', (ctx) => repo.paidByCard(ctx, body.orderId));
  // F5 A7.10: a card refund asks for a code unless one was checked in the last 10 minutes.
  if (paid.paidCard && !viewer.isDemo && !(await stepUpFreshUntilFor(actor))) {
    await passStepUp(actor, body.stepUp);
  }
  const { row, raw } = await staffStep(actor, body.orderId, async (ctx, found) => {
    const parsed = staffOutcome.parse(
      await repo.staffCancelUnreachable(
        ctx,
        found.deliveryId,
        body.expectedVersion,
        body.note ?? null,
      ),
    );
    if (parsed.outcome === 'cancelled') {
      await audit(ctx, {
        action: 'order.cancelled-by-staff',
        targetType: 'order',
        targetId: body.orderId,
        data: {
          number: found.orderNumber,
          reason: 'customer-unreachable',
          hasNote: Boolean(body.note),
          afterPickup: true,
        },
      });
    }
    return parsed;
  });
  const result = staffOutcome.parse(raw);
  if (result.outcome === 'not-stuck') {
    throw refusal(
      'CONFIRM_NOT_ALLOWED',
      'Cancel it after a code lock, a reported problem or 5 minutes without an answer.',
      409,
      { why: 'not-stuck' },
    );
  }
  if (result.outcome === 'cancelled' && result.partnerId) {
    const partnerId = result.partnerId;
    await safely('notice', () =>
      runAsSystem('partner notice', (ctx) =>
        repo.setPartnerNotice(ctx, partnerId, 'cancelledBringBack', result.orderNumber),
      ),
    );
  }
  if (result.outcome !== 'cancelled') {
    throw changed(
      row.orderNumber,
      'status' in result ? result.status : row.status,
      'version' in result ? result.version : row.version,
      row.orderId,
    );
  }
  const at = new Date().toISOString();
  const effects: OrderEffect[] = [
    { kind: 'publish', orderId: result.orderId, at, fromStatus: 'PICKED_UP' },
    {
      kind: 'email',
      orderId: result.orderId,
      email: 'cancelled',
      change: 'cancelled',
      ...(result.paidByCard && paid.totalCents > 0 && { refundCents: paid.totalCents, at }),
    },
    ...(result.paidByCard ? [{ kind: 'refund' as const, orderId: result.orderId }] : []),
  ];
  await safely('order', () => runEffects(effects));
  await safely('changed', () =>
    publishChanged(
      { orderId: result.orderId, status: 'CANCELLED', version: result.version },
      result.partnerId ? [result.partnerId] : [],
      'cancelledBringBack',
    ),
  );
  if (result.partnerId) {
    const partnerId = result.partnerId;
    await safely('earnings', () => announceEarnings(partnerId));
    await safely('assignment-ended', () =>
      inngest.send(
        deliveryAssignmentEnded.create(
          {
            deliveryId: result.deliveryId,
            orderId: result.orderId,
            partnerId,
            how: 'cancelled',
            at,
          },
          { id: `delivery-assignment-ended-${result.deliveryId}-${result.version}` },
        ),
      ),
    );
  }
  return {
    orderId: result.orderId,
    deliveryId: result.deliveryId,
    version: result.version,
    at,
    replayed: false,
  };
}

// ------------------------------------------------------------------ the demo run (L10)

/** A54.1: demo staff start the pretend delivery (one at a time, six an hour). */
export async function startDemoDelivery(
  actor: UserActor,
  now = new Date(),
): Promise<{ runId: string; endsAt: string }> {
  const viewer = await requireStaff(actor, TRACK, false);
  if (!viewer.isDemo) throw forbidden();
  const runId = uuidv7();
  const endsAt = new Date(now.getTime() + 9 * 60_000);
  await runAsSystem('demo run', async (ctx) => {
    const running = await repo.findRunningDemo(ctx);
    const verdict = demoRunVerdict({
      running: running ? { endsAt: running.endsAt.toISOString() } : null,
      startsInLastHour: await repo.listDemoStarts(ctx, new Date(now.getTime() - 3_600_000)),
      now,
    });
    if (!verdict.ok && verdict.why === 'busy') {
      throw refusal('DEMO_RUN_BUSY', 'A demo delivery is already running.', 409, {
        orderNumber: 'D-1',
        endsAt: verdict.endsAt,
      });
    }
    if (!verdict.ok)
      throw refusal('DEMO_RUN_LIMIT', 'Demo deliveries are limited to 6 an hour.', 429, {
        nextAt: verdict.nextAt,
      });
    await repo.insertDemoRun(ctx, { id: runId, endsAt, requestedBy: viewer.userId });
  });
  await inngest.send(
    demoDeliveryRequested.create(
      { runId, requestedBy: viewer.userId, at: now.toISOString() },
      { id: `demo-run-${runId}` },
    ),
  );
  await safely('demo changed', () =>
    publish(channels.opsMapDemo, 'demo.run-changed', {
      running: true,
      endsAt: endsAt.toISOString(),
      at: now.toISOString(),
    }),
  );
  return { runId, endsAt: endsAt.toISOString() };
}

const jamieActor = (userId: string): UserActor => ({
  kind: 'user',
  userId,
  role: 'partner',
  isDemo: true,
});

/** Demo step 1: Dana's order, ready, with a delivery and an offer to Jamie he accepts. */
export async function demoPrepare(
  runId: string,
): Promise<{ deliveryId: string; orderId: string; points: number } | null> {
  const cast = await runAsSystem('demo cast', repo.findDemoCast);
  if (!cast) return null;
  const made = await runAsSystem('demo order', async (ctx) => {
    const order = await repo.createDemoOrder(ctx, cast.danaUserId, DANA_HOME);
    await repo.setDemoRunOrder(ctx, runId, order.orderId);
    await repo.botOnline(ctx, cast.jamiePartnerId);
    const offerId = await repo.offerToBot(ctx, order.orderId, cast.jamiePartnerId);
    return { ...order, offerId };
  });
  await acceptOffer(jamieActor(cast.jamieUserId), made.offerId, null);
  const route = await refreshEstimate(made.deliveryId);
  await pickUp(jamieActor(cast.jamieUserId), made.deliveryId, {});
  const toDoor = await refreshEstimate(made.deliveryId);
  const coordinates = toDoor.route?.geojson?.coordinates ?? route.route?.geojson?.coordinates ?? [];
  return {
    deliveryId: made.deliveryId,
    orderId: made.orderId,
    points: ridePoints(coordinates, timings().demoSpeedKmh, 4).length,
  };
}

/** Demo step 2: the i-th point of Jamie's ride, through the same pipeline as a phone. */
export async function demoPoint(deliveryId: string, index: number): Promise<boolean> {
  const cast = await runAsSystem('demo cast', repo.findDemoCast);
  const row = await runAsSystem('demo point', (ctx) => repo.findTracked(ctx, deliveryId));
  if (!cast || row?.status !== 'PICKED_UP') return false;
  const coordinates = ROUTE_LINE.safeParse(row.routeGeojson).data?.coordinates ?? [];
  const point = ridePoints(coordinates, timings().demoSpeedKmh, 4)[index];
  if (!point) return false;
  const at = new Date();
  await runAsSystem('demo point', (ctx) => repo.botPoint(ctx, cast.jamiePartnerId, point));
  await pointAccepted({
    partnerId: cast.jamiePartnerId,
    isDemo: true,
    point: { ...point, heading: null, speed: null },
    acceptedAt: at,
  });
  return true;
}

/** Demo step 3: Jamie hands over with Dana's code, and the run ends. */
export async function demoFinish(
  runId: string,
  deliveryId: string | null,
  ok: boolean,
): Promise<void> {
  const cast = await runAsSystem('demo cast', repo.findDemoCast);
  if (cast && deliveryId && ok) {
    const sealed = await runAsSystem('demo code', (ctx) => repo.findCodeEnc(ctx, deliveryId));
    if (sealed) {
      await handOver(jamieActor(cast.jamieUserId), deliveryId, {
        code: decryptField(sealed, deliveryCodeContext(deliveryId)),
        cashCollected: true,
      });
    }
  }
  await runAsSystem('demo end', async (ctx) => {
    if (!ok && deliveryId) await repo.cancelDemoDelivery(ctx, deliveryId);
    await repo.finishDemoRun(ctx, runId, { status: ok ? 'done' : 'failed' });
    if (cast) await repo.botOffline(ctx, cast.jamiePartnerId);
  });
  await safely('demo changed', () =>
    publish(channels.opsMapDemo, 'demo.run-changed', {
      running: false,
      endsAt: null,
      at: new Date().toISOString(),
    }),
  );
}

// ------------------------------------------------------------------ retention (L8.2)

export async function purgeOldLocations(
  now = new Date(),
): Promise<{ rows: number; routes: number }> {
  const before = new Date(now.getTime() - timings().retentionDays * 24 * 60 * 60_000);
  return runAsSystem('location retention', (ctx) => repo.purgeLocations(ctx, before));
}
