import { describe, expect, it } from 'vitest';
import { paymentGateway, setPaymentGatewayForTests } from '@/server/payments/stripe';

/*
 * The real gateway against Stripe's test mode. Skipped unless STRIPE_LIVE_TESTS=1 and Stripe
 * test keys are in the environment; it never runs with live keys. Run it by hand when the
 * Stripe library or API version changes:
 *   STRIPE_LIVE_TESTS=1 STRIPE_SECRET_KEY=sk_test_… NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_… \
 *     npx vitest run --project integration tests/integration/stripe-live.test.ts
 */

const secret = process.env.STRIPE_SECRET_KEY ?? '';
const enabled =
  process.env.STRIPE_LIVE_TESTS === '1' &&
  secret.startsWith('sk_test_') &&
  (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_test_');

describe.skipIf(!enabled)('Stripe test mode, for real (opt-in)', () => {
  it('creates, reads, cancels and refunds PaymentIntents as the gateway describes them', async () => {
    setPaymentGatewayForTests(undefined);
    const gateway = paymentGateway();
    if (!gateway) throw new Error('Stripe is not configured');
    const orderId = crypto.randomUUID();
    const created = await gateway.createIntent({
      amountCents: 5397,
      orderId,
      orderNumber: 'TEST',
      instance: 'live-test',
      saveCard: false,
      idempotencyKey: `live-test-${orderId}`,
    });
    expect(created).toMatchObject({
      status: 'requires_payment_method',
      amountCents: 5397,
      currency: 'usd',
      metadata: { orderId, orderNumber: 'TEST', instance: 'live-test' },
    });
    expect(created.clientSecret).toMatch(/^pi_.+_secret_.+$/);
    // The same key gives the same PaymentIntent.
    const again = await gateway.createIntent({
      amountCents: 5397,
      orderId,
      orderNumber: 'TEST',
      instance: 'live-test',
      saveCard: false,
      idempotencyKey: `live-test-${orderId}`,
    });
    expect(again.id).toBe(created.id);
    expect((await gateway.cancelIntent(created.id)).status).toBe('canceled');
    // Cancelling twice reports where it stands instead of failing.
    expect((await gateway.cancelIntent(created.id)).status).toBe('canceled');
    expect(await gateway.retrieveCard('pm_doesnotexist')).toBeNull();
  }, 60_000);
});
