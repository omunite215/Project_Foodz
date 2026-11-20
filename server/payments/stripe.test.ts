import { describe, expect, it } from 'vitest';
import { signedEvent, WEBHOOK_SECRET } from '@/tests/support/fake-stripe';
import { intentStatus, stripeSettings, verifyStripeEvent } from './stripe';

describe('Stripe keys on this machine (S6.2)', () => {
  it('needs both keys for card payments, and calls test keys test mode', () => {
    expect(stripeSettings({})).toEqual({
      configured: false,
      testMode: false,
      publishableKey: null,
    });
    expect(stripeSettings({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toMatchObject({
      configured: false,
    });
    expect(
      stripeSettings({
        STRIPE_SECRET_KEY: 'sk_test_abc',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
      }),
    ).toEqual({ configured: true, testMode: true, publishableKey: 'pk_test_abc' });
    expect(
      stripeSettings({
        STRIPE_SECRET_KEY: 'sk_live_abc',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_abc',
      }),
    ).toMatchObject({ configured: true, testMode: false });
  });

  it('never hands out the secret key', () => {
    const settings = stripeSettings({
      STRIPE_SECRET_KEY: 'sk_test_secret_value',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
    });
    expect(JSON.stringify(settings)).not.toContain('sk_test_secret_value');
  });
});

describe('webhook signatures (B6, S10.2)', () => {
  const object = { id: 'pi_123', object: 'payment_intent' };

  it('accepts an event signed with the secret, over the raw body', () => {
    const { payload, signature } = signedEvent('payment_intent.succeeded', object);
    expect(verifyStripeEvent(payload, signature, WEBHOOK_SECRET)).toMatchObject({
      type: 'payment_intent.succeeded',
      data: { object },
    });
  });

  it('refuses a missing, wrong, replayed-on-another-body or old signature', () => {
    const { payload, signature } = signedEvent('payment_intent.succeeded', object);
    expect(() => verifyStripeEvent(payload, null, WEBHOOK_SECRET)).toThrow(/Stripe-Signature/);
    const forged = signedEvent('payment_intent.succeeded', object, {
      secret: 'whsec_someone_else',
    });
    expect(() => verifyStripeEvent(forged.payload, forged.signature, WEBHOOK_SECRET)).toThrow(
      /signature/i,
    );
    expect(() =>
      verifyStripeEvent(payload.replace('pi_123', 'pi_999'), signature, WEBHOOK_SECRET),
    ).toThrow(/signature/i);
    const old = signedEvent('payment_intent.succeeded', object, {
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });
    expect(() => verifyStripeEvent(old.payload, old.signature, WEBHOOK_SECRET)).toThrow(
      /tolerance/i,
    );
  });

  it('refuses everything when no secret is set', () => {
    const { payload, signature } = signedEvent('payment_intent.succeeded', object);
    expect(() => verifyStripeEvent(payload, signature, '')).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe('PaymentIntent statuses', () => {
  it('keeps the ones it knows and treats a new one as still waiting', () => {
    expect(intentStatus('succeeded')).toBe('succeeded');
    expect(intentStatus('requires_action')).toBe('requires_action');
    expect(intentStatus('something_new')).toBe('requires_confirmation');
  });
});
