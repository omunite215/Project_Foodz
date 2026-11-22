'use client';

import { CircleExclamationPoint } from 'lucide-react';
import { useId } from 'react';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Quote } from '@/server/modules/cart/schema';
import { announce } from '@/lib/announce';
import { CHECKOUT_REASONS, type CheckoutReason, orderingOpensText } from '@/lib/cart-text';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type QuoteStatus, TotalRow } from './price-breakdown';

/** Why checkout can't start now, the first that applies (design 2.17). Null: it can. */
export function checkoutReason(quote: Quote | null, status: QuoteStatus): CheckoutReason | null {
  if (status === 'offline') return 'offline';
  if (status === 'updating') return 'updating';
  if (status === 'loading') return 'loading';
  if (status === 'failed' || status === 'tooBig') return 'failed';
  if (status === 'rateLimited') return 'rateLimited';
  const blockers = quote?.checkoutBlockers ?? [];
  if (blockers.includes('soldOut')) return 'soldOut';
  if (blockers.includes('closed')) return 'closed';
  if (blockers.includes('outside')) return 'outside';
  if (blockers.includes('empty')) return 'soldOut';
  return null;
}

export interface CheckoutBarProps {
  quote: Quote | null;
  status: QuoteStatus;
  /** The new answer has been on its way for 150 ms (dims the total) and 300 ms (says so). */
  dim: boolean;
  slow: boolean;
  onCheckout: () => void;
  onRetry: () => void;
  /** On /checkout the button only closes the cart (F4 design 1.3, D30). */
  backToCheckout?: boolean;
}

/**
 * The pinned footer: the total, "Go to checkout" with the amount once it is final, and a reserved
 * line that says why the button can't be used yet. A blocked button keeps its focus and repeats
 * its reason when pressed.
 */
export function CheckoutBar({
  quote,
  status,
  dim,
  slow,
  onCheckout,
  onRetry,
  backToCheckout = false,
}: CheckoutBarProps) {
  const reasonId = `${useId()}-checkout-reason`;
  const reason = backToCheckout ? null : checkoutReason(quote, status);
  const blocked = reason !== null;
  const final = status === 'ready' && quote?.totalKind === 'final' && !blocked;
  const closed = reason === 'closed' && quote ? orderingOpensText(quote.store.opensAt) : null;
  const label = backToCheckout
    ? 'Back to checkout'
    : (closed ??
      (final && quote ? `Go to checkout · ${formatPrice(quote.totalCents)}` : 'Go to checkout'));
  // While updating, presses are ignored at once but the grey look waits 300 ms (no flicker).
  const looksBlocked = blocked && (reason !== 'updating' || slow);
  const reasonText =
    reason === 'closed' || reason === null
      ? null
      : reason === 'loading' || reason === 'updating'
        ? slow
          ? CHECKOUT_REASONS.updating
          : null
        : CHECKOUT_REASONS[reason];

  return (
    <div className="shrink-0 border-t border-neutral-6 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:pb-6">
      <TotalRow quote={quote} status={status} dim={dim} />
      <Button
        type="button"
        size="touch"
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        onClick={() => {
          if (blocked) {
            announce(closed ?? reasonText ?? CHECKOUT_REASONS.updating);
            return;
          }
          onCheckout();
        }}
        className={cn('mt-3 w-full uppercase', looksBlocked && BLOCKED_BUTTON_CLASS)}
      >
        {label}
      </Button>
      <div
        id={reasonId}
        className={cn(
          'mt-2 flex min-h-5 flex-wrap items-center justify-center gap-x-1.5 text-center text-body-5',
          reason === 'failed' ? 'text-destructive' : 'text-neutral-3',
        )}
      >
        {reasonText && (reason === 'updating' || reason === 'loading') ? (
          <Spinner className="size-4 motion-reduce:animate-none" />
        ) : null}
        {reason === 'failed' ? (
          <CircleExclamationPoint className="size-4 shrink-0" aria-hidden />
        ) : null}
        {reasonText ? <span>{reasonText}</span> : null}
        {reason === 'failed' ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center font-medium text-brand-strong underline underline-offset-4"
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
