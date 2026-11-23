'use client';

import { Info } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { reorderAction } from '@/server/modules/orders/progress-actions';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { openCart } from '@/lib/cart-dialog';
import { addedText, leftOutSentence } from '@/lib/order-progress';
import { setReorderLeftOut } from '@/lib/reorder-notice';
import { useCartActions } from '@/lib/data/cart';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

/*
 * "Order again" (F5 design 8, S7.5): the order's dishes go into the cart at today's menu,
 * through the cart's own rules; never the code, tip, kitchen note, address or payment. The cart
 * opens and says what was added; anything left out is said in words under the button.
 */

export function OrderAgainButton({
  orderId,
  number,
  variant,
  className,
  onRow = false,
}: {
  orderId: string;
  number: string;
  variant: 'primary' | 'outline';
  className?: string;
  /** On an orders-list row, where the button names its order. */
  onRow?: boolean;
}) {
  const id = useId();
  const cart = useCartActions();
  const online = useOnline();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; lines: string[] } | null>(null);
  const slow = useSlowPending(pending);

  async function reorder() {
    if (pending) return;
    if (!online) {
      announce("You're offline.");
      return;
    }
    setPending(true);
    setStatus(null);
    const outcome = await callAction(() => reorderAction({ orderId }));
    setPending(false);
    if (!outcome.ok) {
      const text = "We couldn't add these dishes. Try again.";
      setStatus({ tone: 'error', lines: [text] });
      announce(text);
      return;
    }
    let added = 0;
    for (const line of outcome.data.lines) {
      const result = cart.add({
        menuItemId: line.menuItemId,
        flavors: line.flavors,
        quantity: line.quantity,
        ...(line.note ? { note: line.note } : {}),
      });
      if (result.kind === 'added') added += line.quantity;
    }
    if (added === 0) {
      // The cart stays as it was, and closed (design 8 step 4).
      const text = 'None of these dishes can be ordered right now.';
      setStatus({ tone: 'info', lines: [text] });
      announce(text);
      return;
    }
    // What was left out is the cart's first notice (design 8 step 3); the cart says it.
    setReorderLeftOut(outcome.data.leftOut.map(leftOutSentence));
    openCart(buttonRef.current);
    announce(addedText(added));
  }

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <Button
        ref={buttonRef}
        type="button"
        size="touch"
        variant={variant === 'primary' ? 'default' : 'outline'}
        aria-disabled={pending || !online || undefined}
        aria-describedby={
          [!online ? `${id}-offline` : null, status ? `${id}-status` : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        // On a list row it names its order: "Order again: order 1042" (design, Labels).
        aria-label={onRow && !slow ? `Order again: order ${number}` : undefined}
        onClick={() => void reorder()}
        className={cn(variant === 'primary' ? 'uppercase' : 'bg-white')}
      >
        {slow ? (
          <>
            <Spinner className="motion-reduce:animate-none" />
            Adding…
          </>
        ) : (
          'Order again'
        )}
      </Button>
      {!online ? (
        <span id={`${id}-offline`} className="text-body-5 text-neutral-3">
          You&apos;re offline.
        </span>
      ) : null}
      {status ? (
        <div
          id={`${id}-status`}
          className={cn(
            'mt-2 flex items-start gap-2 text-left text-body-5',
            status.tone === 'error' ? 'text-destructive' : 'text-neutral-1',
          )}
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            {status.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
