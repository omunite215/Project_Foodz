import type {
  PaymentIntent,
  Stripe,
  StripeCardNumberElement,
  StripeError,
} from '@stripe/stripe-js';

/*
 * Confirming a card payment in the browser (F4 design 2.17, D18 to D20). The payment is confirmed
 * with `handleActions: false`, so the button can say "Waiting for your bank…" before Stripe's own
 * bank screen opens. A network failure talking to Stripe is never reported as a decline.
 */

export type ConfirmOutcome =
  /** Stripe has the payment (or is processing it): go to the order page. */
  | { kind: 'succeeded' }
  /** The bank said no, or the bank check failed: stay on the page with the sentence. */
  | { kind: 'declined'; code: string | null; declineCode: string | null }
  /** Stripe couldn't be reached: ask the server what became of the press (D20). */
  | { kind: 'unreachable' };

/**
 * Stripe's answer in words of our own outcome. A decline is the bank's own answer (a card error,
 * or a bank check that failed), or Stripe saying the attempt is over (the PaymentIntent it sends
 * back wants a new card). Anything else is never worded as one, and the server is asked what
 * became of the payment instead.
 */
export function outcomeFromError(
  error: Pick<StripeError, 'type' | 'code' | 'decline_code'> & {
    payment_intent?: Pick<PaymentIntent, 'status'> | null;
  },
): ConfirmOutcome {
  const attemptOver =
    error.payment_intent?.status === 'requires_payment_method' ||
    error.payment_intent?.status === 'canceled';
  if (
    error.type === 'card_error' ||
    error.code === 'payment_intent_authentication_failure' ||
    attemptOver
  ) {
    return { kind: 'declined', code: error.code ?? null, declineCode: error.decline_code ?? null };
  }
  return { kind: 'unreachable' };
}

/** What a PaymentIntent's status means once Stripe has answered. */
export function outcomeFromIntent(
  intent: Pick<PaymentIntent, 'status' | 'last_payment_error'>,
): ConfirmOutcome {
  switch (intent.status) {
    case 'succeeded':
    case 'processing':
    case 'requires_capture':
      return { kind: 'succeeded' };
    case 'requires_payment_method':
    case 'canceled':
      return {
        kind: 'declined',
        code: intent.last_payment_error?.code ?? 'card_declined',
        declineCode: intent.last_payment_error?.decline_code ?? null,
      };
    default:
      return { kind: 'unreachable' };
  }
}

const CONFIRM_TIMEOUT_MS = 15_000;

class StripeTimeout extends Error {}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new StripeTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export interface ConfirmRequest {
  stripe: Stripe;
  clientSecret: string;
  /** A saved card's id, or the card number field (new card) with the name on the order. */
  method: { savedCardId: string } | { card: StripeCardNumberElement; name: string };
  /** The bank wants to check it's her: the button now says "Waiting for your bank…". */
  onBankCheck: () => void;
}

export async function confirmCard({
  stripe,
  clientSecret,
  method,
  onBankCheck,
}: ConfirmRequest): Promise<ConfirmOutcome> {
  const paymentMethod =
    'savedCardId' in method
      ? method.savedCardId
      : { card: method.card, billing_details: { name: method.name } };
  try {
    const first = await within(
      stripe.confirmCardPayment(
        clientSecret,
        { payment_method: paymentMethod },
        { handleActions: false },
      ),
      CONFIRM_TIMEOUT_MS,
    );
    if (first.error) return outcomeFromError(first.error);
    if (first.paymentIntent.status !== 'requires_action') {
      return outcomeFromIntent(first.paymentIntent);
    }
    onBankCheck();
    // Stripe.js opens the bank's screen and finishes the payment. No time limit here: she is on
    // her bank's screen.
    const next = await stripe.confirmCardPayment(clientSecret);
    if (next.error) return outcomeFromError(next.error);
    return outcomeFromIntent(next.paymentIntent);
  } catch {
    return { kind: 'unreachable' };
  }
}
