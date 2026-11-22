import { describe, expect, it } from 'vitest';
import { outcomeFromError, outcomeFromIntent } from './confirm-card';

describe('outcomeFromError (design 2.17, 2.18)', () => {
  it('passes the bank answer on as a decline', () => {
    expect(
      outcomeFromError({
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
      }),
    ).toEqual({ kind: 'declined', code: 'card_declined', declineCode: 'insufficient_funds' });
    expect(
      outcomeFromError({
        type: 'invalid_request_error',
        code: 'payment_intent_authentication_failure',
        decline_code: undefined,
      }),
    ).toEqual({
      kind: 'declined',
      code: 'payment_intent_authentication_failure',
      declineCode: null,
    });
  });

  it('never calls anything but the bank answer a decline (D20)', () => {
    expect(
      outcomeFromError({
        type: 'invalid_request_error',
        code: 'payment_intent_unexpected_state',
        decline_code: undefined,
      }),
    ).toEqual({ kind: 'unreachable' });
    expect(
      outcomeFromError({ type: 'api_connection_error', code: undefined, decline_code: undefined }),
    ).toEqual({
      kind: 'unreachable',
    });
  });
});

describe('outcomeFromIntent', () => {
  it('treats succeeded and processing as paid', () => {
    expect(outcomeFromIntent({ status: 'succeeded', last_payment_error: null })).toEqual({
      kind: 'succeeded',
    });
    expect(outcomeFromIntent({ status: 'processing', last_payment_error: null })).toEqual({
      kind: 'succeeded',
    });
  });

  it('reads a failed bank check as a decline with its code', () => {
    expect(
      outcomeFromIntent({
        status: 'requires_payment_method',
        last_payment_error: {
          type: 'card_error',
          code: 'card_declined',
          decline_code: 'insufficient_funds',
        },
      }),
    ).toEqual({ kind: 'declined', code: 'card_declined', declineCode: 'insufficient_funds' });
  });
});
