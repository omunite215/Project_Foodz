'use client';

import { CircleExclamationPoint } from 'lucide-react';
import { useId } from 'react';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Quote } from '@/server/modules/cart/schema';
import { announce } from '@/lib/announce';
import { CHECKOUT_REASONS, checkoutButtonState, type QuoteStatus } from '@/lib/cart-text';
import { cn } from '@/lib/utils';
import { TotalRow } from './price-breakdown';

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
  const state = checkoutButtonState(quote, status, slow);
  // With an order waiting at checkout, the button goes back there whatever the quote says.
  const reason = backToCheckout ? null : state.reason;
  const blocked = reason !== null;
  const label = backToCheckout ? 'Back to checkout' : state.label;
  const line = backToCheckout ? null : state.line;
  // While updating, presses are ignored at once but the grey look waits 300 ms (no flicker).
  const looksBlocked = blocked && (reason !== 'updating' || slow);
  const closed = quote !== null && !quote.store.isOpen;

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
            announce(
              closed ? (line ? `${label}. ${line}` : label) : (line ?? CHECKOUT_REASONS.updating),
            );
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
        {line && (reason === 'updating' || reason === 'loading') ? (
          <Spinner className="size-4 motion-reduce:animate-none" />
        ) : null}
        {reason === 'failed' ? (
          <CircleExclamationPoint className="size-4 shrink-0" aria-hidden />
        ) : null}
        {line ? <span>{line}</span> : null}
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
