import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { setPaymentGatewayForTests } from '@/server/payments/stripe';
import { redis } from '@/server/redis';
import {
  chargeObject,
  disputeObject,
  FakeStripe,
  intentObject,
  MASTERCARD,
  signedEvent,
  VISA,
  WEBHOOK_SECRET,
} from '../support/fake-stripe';
import { seedCatalog } from '../../prisma/seeding';
import { nextHeaders } from './support/browser';
import { customer, dishIds, openAllDay, press, restoreHours } from './support/checkout';

/*
 * POST /api/webhooks/stripe (F4 B6, S10): signatures on the raw body, each event once, the order,
 * its payment, its code and its timeline kept in step, one email per change, events from other
 * machines ignored, late payments (U10), mismatches (S10.4), refunds and disputes. Stripe is a
 * fake; events are signed with Stripe's own test helper.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
  publish: vi.fn<() => Promise<void>>(async () => undefined),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/realtime/pusher', () => ({
  publish: mocks.publish,
  signSubscription: vi.fn<() => void>(),
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const { POST } = await import('@/app/api/webhooks/stripe/route');
const { placeOrderAction, orderStatusAction } = await import('@/server/modules/orders/actions');
const { expireUnpaidOrder, processAutoRefund } =
  await import('@/server/modules/orders/payment-sync');

let migrator: PrismaClient;
let dish: Record<string, string> = {};
let fake: FakeStripe;
let tag = '';
const addedCodes: string[] = [];
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();

async function deliver(payload: string, signature: string | null, ip = '203.0.113.7') {
  const response = await POST(
    new Request('http://localhost:3456/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...(signature !== null && { 'stripe-signature': signature }),
      },
      body: payload,
    }),
  );
  return { status: response.status, body: (await response.json()) as { outcome?: string } };
}

const send = (type: string, object: Record<string, unknown>, options: { id?: string } = {}) => {
  const event = signedEvent(type, object, options);
  return deliver(event.payload, event.signature);
};

const emailsFor = (orderId: string) =>
  mocks.send.mock.calls
    .map(
      ([event]) =>
        event as { name: string; data: { orderId?: string; kind?: string; refundCents?: number } },
    )
    .filter((event) => event.name === 'order.email-requested' && event.data.orderId === orderId)
    .map((event) => event.data);

const refundJobsFor = (orderId: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; data: { orderId?: string } })
    .filter((event) => event.name === 'order.refund-requested' && event.data.orderId === orderId);

const orderOf = (id: string) => migrator.order.findUniqueOrThrow({ where: { id } });
const eventsOf = async (id: string) =>
  (
    await migrator.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })
  ).map((event) => event.type);

/** A card order waiting for payment, with a code held when given. */
async function waitingOrder(code?: string) {
  const who = await customer(migrator);
  const result = await placeOrderAction(
    press(who, dish, {
      method: 'card',
      card: { kind: 'new' },
      ...(code && { code, expectedTotalCents: 5183 }),
    }),
  );
  expect(result?.serverError).toBeUndefined();
  const orderId = result.data!.orderId;
  return { who, orderId, intentId: fake.intentFor(orderId)!.id };
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  dish = await dishIds(migrator);
  await openAllDay(migrator);
  tag = (await migrator.appInstance.findUniqueOrThrow({ where: { id: 1 } })).tag;
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_fake');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
}, 120_000);

beforeEach(() => {
  fake = new FakeStripe();
  setPaymentGatewayForTests(fake);
  mocks.send.mockClear();
});

afterEach(() => {
  setPaymentGatewayForTests(undefined);
});

afterAll(async () => {
  await restoreHours(migrator);
  await migrator.couponRedemption.deleteMany({ where: { coupon: { code: { in: addedCodes } } } });
  await migrator.order.updateMany({
    where: { coupon: { code: { in: addedCodes } } },
    data: { couponId: null },
  });
  await migrator.coupon.deleteMany({ where: { code: { in: addedCodes } } });
  await migrator.$disconnect();
  await redis.quit();
  vi.unstubAllEnvs();
});

describe('who may call it (S10.2)', () => {
  it('answers 400 to a bad, missing or foreign signature, and changes nothing', async () => {
    const { orderId, intentId } = await waitingOrder();
    const intent = fake.succeed(intentId);
    const event = signedEvent('payment_intent.succeeded', intentObject(intent));
    expect((await deliver(event.payload, null)).status).toBe(400);
    expect((await deliver(event.payload, 't=1,v1=deadbeef')).status).toBe(400);
    const foreign = signedEvent('payment_intent.succeeded', intentObject(intent), {
      secret: 'whsec_someone_else',
    });
    expect((await deliver(foreign.payload, foreign.signature)).body).toEqual({
      received: false,
      outcome: 'bad-signature',
    });
    // A valid signature on a changed body.
    expect((await deliver(event.payload.replace('"usd"', '"eur"'), event.signature)).status).toBe(
      400,
    );
    expect((await orderOf(orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('refuses a body over the size cap before reading it', async () => {
    const event = signedEvent('payment_intent.succeeded', { padding: 'x'.repeat(300 * 1024) });
    expect((await deliver(event.payload, event.signature)).status).toBe(413);
  });

  it('answers 200 to events it does not handle', async () => {
    const response = await send('customer.created', { id: 'cus_1', object: 'customer' });
    expect(response).toEqual({ status: 200, body: { received: true, outcome: 'ignored-type' } });
  });

  it('limits each network and answers 429 past it', async () => {
    const ip = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const event = signedEvent('customer.created', { id: 'cus_1', object: 'customer' });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 601; attempt += 1) {
      statuses.push((await deliver(event.payload, event.signature, ip)).status);
    }
    expect(statuses.slice(0, 600).every((status) => status === 200)).toBe(true);
    expect(statuses[600]).toBe(429);
  }, 120_000);
});

describe('a payment that succeeds (S6.5, S10.1, S11.5)', () => {
  it('places the order, uses the code, writes the timeline and queues one receipt', async () => {
    const code = `HOOK${TAG}`;
    addedCodes.push(code);
    await migrator.coupon.create({ data: { code, type: 'FIXED', value: 200, usageLimit: 5 } });
    const { orderId, intentId } = await waitingOrder(code);
    const intent = fake.succeed(intentId, VISA);

    const response = await send('payment_intent.succeeded', intentObject(intent));
    expect(response).toEqual({ status: 200, body: { received: true, outcome: 'applied' } });
    expect(await orderOf(orderId)).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'PAID',
      cardBrand: 'visa',
      cardLast4: '4242',
      stripePaymentMethodId: intent.paymentMethodId,
    });
    expect((await orderOf(orderId)).placedAt).toBeInstanceOf(Date);
    expect((await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId } })).status).toBe(
      'REDEEMED',
    );
    expect(await eventsOf(orderId)).toEqual(['created', 'paid', 'placed']);
    expect(emailsFor(orderId)).toEqual([{ orderId, kind: 'receipt' }]);
  });

  it('applies each event id once: a replay changes nothing and sends nothing (B6)', async () => {
    const { orderId, intentId } = await waitingOrder();
    const intent = fake.succeed(intentId);
    const id = `evt_replay${uuid().replaceAll('-', '')}`;
    expect(
      (await send('payment_intent.succeeded', intentObject(intent), { id })).body.outcome,
    ).toBe('applied');
    expect(
      (await send('payment_intent.succeeded', intentObject(intent), { id })).body.outcome,
    ).toBe('duplicate');
    expect(await migrator.webhookEvent.count({ where: { id } })).toBe(1);
    expect(emailsFor(orderId)).toHaveLength(1);
    expect(await eventsOf(orderId)).toEqual(['created', 'paid', 'placed']);
  });

  it('meets the direct check in the same step: one placement, one email (B7, S10.5)', async () => {
    const { orderId, intentId } = await waitingOrder();
    const intent = fake.succeed(intentId);
    const checked = await orderStatusAction({ orderId, confirmed: true });
    expect(checked?.data?.status).toBe('PLACED');
    expect((await send('payment_intent.succeeded', intentObject(intent))).body.outcome).toBe(
      'unchanged',
    );
    expect(emailsFor(orderId)).toHaveLength(1);
  });

  it('ignores events from another machine and orders it does not hold, with a 200 (S10.7)', async () => {
    const { orderId, intentId } = await waitingOrder();
    const intent = fake.succeed(intentId);
    const elsewhere = {
      ...intentObject(intent),
      metadata: { ...intent.metadata, instance: uuid() },
    };
    expect(await send('payment_intent.succeeded', elsewhere)).toEqual({
      status: 200,
      body: { received: true, outcome: 'other-instance' },
    });
    // A payment this database never made: Stripe's own copy (asked first) isn't ours either.
    const notOurs = {
      ...intentObject(intent),
      id: 'pi_madeelsewhere123',
      metadata: { orderId: uuid(), orderNumber: '1', instance: tag },
    };
    expect((await send('payment_intent.succeeded', notOurs)).body.outcome).toBe('unknown-order');
    // An event's copy carrying our tag is checked against Stripe's own copy, which wins.
    const claimed = intentObject(intent);
    fake.intents.get(intentId)!.metadata.instance = 'someone-else';
    expect((await send('payment_intent.succeeded', claimed)).body.outcome).toBe('other-instance');
    fake.intents.get(intentId)!.metadata.instance = tag;
    expect((await orderOf(orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('never moves a paid order back, whatever arrives after (S10.3)', async () => {
    const { orderId, intentId } = await waitingOrder();
    const paid = fake.succeed(intentId);
    await send('payment_intent.succeeded', intentObject(paid));
    const late = {
      ...intentObject(paid),
      status: 'requires_payment_method',
      last_payment_error: { code: 'card_declined' },
    };
    expect((await send('payment_intent.payment_failed', late)).body.outcome).toBe('unchanged');
    expect(await orderOf(orderId)).toMatchObject({ status: 'PLACED', paymentStatus: 'PAID' });
  });
});

describe('a payment that fails (S6.8, U2)', () => {
  it('ends the attempt, releases the code and sends no email', async () => {
    const code = `FAIL${TAG}`;
    addedCodes.push(code);
    await migrator.coupon.create({ data: { code, type: 'FIXED', value: 200, usageLimit: 1 } });
    const { orderId, intentId } = await waitingOrder(code);
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(1);
    const declined = fake.decline(intentId, 'card_declined', 'insufficient_funds');

    expect((await send('payment_intent.payment_failed', intentObject(declined))).body.outcome).toBe(
      'applied',
    );
    expect((await orderOf(orderId)).status).toBe('FAILED');
    expect((await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId } })).status).toBe(
      'RELEASED',
    );
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
    const failed = await migrator.orderEvent.findFirstOrThrow({
      where: { orderId, type: 'payment-failed' },
    });
    expect(failed.data).toMatchObject({ code: 'card_declined', declineCode: 'insufficient_funds' });
    expect(emailsFor(orderId)).toHaveLength(0);
    expect(fake.count('cancelIntent')).toBe(1);
  });

  it('changes nothing when a cancelled payment belongs to an order already over', async () => {
    const { orderId, intentId } = await waitingOrder();
    await expireUnpaidOrder(orderId, new Date(Date.now() + 16 * 60_000));
    const intent = await fake.retrieveIntent(intentId);
    expect((await send('payment_intent.canceled', intentObject(intent))).body.outcome).toBe(
      'unchanged',
    );
    expect(await orderOf(orderId)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'payment-expired',
    });
  });
});

describe('a payment after the order expired (U10, S9.5)', () => {
  it('places the order after all when nothing changed, honouring the code past its limit', async () => {
    const code = `LATE${TAG}`;
    addedCodes.push(code);
    await migrator.coupon.create({ data: { code, type: 'FIXED', value: 200, usageLimit: 1 } });
    const { orderId, intentId } = await waitingOrder(code);
    // The bank was slow: Stripe still processing when the expiry job ran.
    fake.processing(intentId);
    expect(await expireUnpaidOrder(orderId, new Date(Date.now() + 16 * 60_000))).toBe('wait');
    fake.decline(intentId);
    expect(await expireUnpaidOrder(orderId, new Date(Date.now() + 16 * 60_000))).toBe('expired');
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
    // Someone else takes the last use meanwhile.
    await migrator.coupon.update({ where: { code }, data: { usedCount: 1 } });

    const paid = fake.succeed(intentId, MASTERCARD);
    expect((await send('payment_intent.succeeded', intentObject(paid))).body.outcome).toBe(
      'applied',
    );
    expect(await orderOf(orderId)).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'PAID',
      cancelReason: null,
      cardBrand: 'mastercard',
    });
    expect((await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId } })).status).toBe(
      'REDEEMED',
    );
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(2);
    expect(await eventsOf(orderId)).toEqual(['created', 'expired', 'revived']);
    expect(emailsFor(orderId)).toEqual([{ orderId, kind: 'receipt-late' }]);
  });

  it('refunds in full when a dish sold out meanwhile, and emails why (S9.5)', async () => {
    const { orderId, intentId } = await waitingOrder();
    await expireUnpaidOrder(orderId, new Date(Date.now() + 16 * 60_000));
    await migrator.menuItem.update({ where: { slug: 'pad-thai' }, data: { isAvailable: false } });
    try {
      const paid = fake.succeed(intentId);
      await send('payment_intent.succeeded', intentObject(paid));
      expect(await orderOf(orderId)).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        autoRefundReason: 'late-payment',
      });
      expect(refundJobsFor(orderId)).toHaveLength(1);

      // The refund job.
      expect(await processAutoRefund(orderId)).toBe('refunded');
      expect(await processAutoRefund(orderId)).toBe('none');
      expect(fake.refunds).toEqual([
        expect.objectContaining({ amountCents: 5397, reason: 'late-payment' }),
      ]);
      expect(await orderOf(orderId)).toMatchObject({
        paymentStatus: 'REFUNDED',
        refundedCents: 5397,
      });
      expect(emailsFor(orderId)).toEqual([
        expect.objectContaining({ orderId, kind: 'late-refund', refundCents: 5397 }),
      ]);
      const audit = await migrator.auditLog.findFirstOrThrow({
        where: { action: 'order.refund-issued', targetId: orderId },
      });
      expect(audit).toMatchObject({
        actorRole: 'system',
        data: expect.objectContaining({ amountCents: 5397, reason: 'late-payment' }),
      });

      // Stripe's own refund event later changes nothing and sends nothing more.
      const refunded = await fake.retrieveIntent(intentId);
      expect((await send('charge.refunded', chargeObject(refunded, 5397))).body.outcome).toBe(
        'unchanged',
      );
      expect(emailsFor(orderId)).toHaveLength(1);
    } finally {
      await migrator.menuItem.update({ where: { slug: 'pad-thai' }, data: { isAvailable: true } });
    }
  });
});

describe('a payment that does not match its order (S10.4)', () => {
  it('never places it, refunds in full, and says so', async () => {
    const { orderId, intentId } = await waitingOrder();
    const wrong = fake.succeed(intentId, VISA, 4999);
    expect((await send('payment_intent.succeeded', intentObject(wrong))).body.outcome).toBe(
      'applied',
    );
    expect(await orderOf(orderId)).toMatchObject({
      status: 'FAILED',
      autoRefundReason: 'mismatch',
    });
    expect(await processAutoRefund(orderId)).toBe('refunded');
    expect(fake.refunds.at(-1)).toMatchObject({ amountCents: 4999, reason: 'mismatch' });
    expect(emailsFor(orderId)).toEqual([
      expect.objectContaining({ kind: 'mismatch-refund', refundCents: 4999 }),
    ]);
  });
});

describe('refunds and disputes made at Stripe (S10.1)', () => {
  it('marks a partial and then a full refund, one email each, and ignores a replay', async () => {
    const { orderId, intentId } = await waitingOrder();
    const paid = fake.succeed(intentId);
    await send('payment_intent.succeeded', intentObject(paid));
    mocks.send.mockClear();

    const partial = signedEvent('charge.refunded', chargeObject(paid, 500));
    expect((await deliver(partial.payload, partial.signature)).body.outcome).toBe('applied');
    expect(await orderOf(orderId)).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'PARTIALLY_REFUNDED',
      refundedCents: 500,
    });
    expect((await deliver(partial.payload, partial.signature)).body.outcome).toBe('duplicate');

    expect((await send('charge.refunded', chargeObject(paid, 5397))).body.outcome).toBe('applied');
    expect(await orderOf(orderId)).toMatchObject({
      paymentStatus: 'REFUNDED',
      refundedCents: 5397,
    });
    expect(emailsFor(orderId)).toEqual([
      expect.objectContaining({ kind: 'refunded', refundCents: 500 }),
      expect.objectContaining({ kind: 'refunded', refundCents: 4897 }),
    ]);
    const refunds = await migrator.orderEvent.findMany({ where: { orderId, type: 'refunded' } });
    expect(refunds.map((event) => event.data)).toEqual([
      { amountCents: 500, totalRefundedCents: 500 },
      { amountCents: 4897, totalRefundedCents: 5397 },
    ]);
  });

  it('catches up when the refund arrives before the success (S10.3)', async () => {
    const { orderId, intentId } = await waitingOrder();
    const paid = fake.succeed(intentId);
    await fake.refund({
      paymentIntentId: intentId,
      amountCents: 5397,
      reason: 'x',
      orderId,
      idempotencyKey: `r-${orderId}`,
    });
    expect((await send('charge.refunded', chargeObject(paid, 5397))).body.outcome).toBe('applied');
    expect(await orderOf(orderId)).toMatchObject({ status: 'PLACED', paymentStatus: 'REFUNDED' });
  });

  it('records a dispute opening and closing, with no email and the order unchanged (S10.6)', async () => {
    const { orderId, intentId } = await waitingOrder();
    const paid = fake.succeed(intentId);
    await send('payment_intent.succeeded', intentObject(paid));
    mocks.send.mockClear();
    expect(
      (await send('charge.dispute.created', disputeObject(paid, 'needs_response'))).body.outcome,
    ).toBe('applied');
    expect(await orderOf(orderId)).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'PAID',
      disputeStatus: 'OPEN',
    });
    expect((await send('charge.dispute.closed', disputeObject(paid, 'won'))).body.outcome).toBe(
      'applied',
    );
    const order = await orderOf(orderId);
    expect(order).toMatchObject({ disputeStatus: 'WON' });
    expect(order.disputeOpenedAt).toBeInstanceOf(Date);
    expect(order.disputeClosedAt).toBeInstanceOf(Date);
    expect(await eventsOf(orderId)).toEqual([
      'created',
      'paid',
      'placed',
      'dispute-opened',
      'dispute-closed',
    ]);
    expect(emailsFor(orderId)).toHaveLength(0);
  });
});
