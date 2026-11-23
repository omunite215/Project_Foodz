'use client';

import { Info } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { reorderAction } from '@/server/modules/orders/progress-actions';
import type { ReorderLeftOut } from '@/server/modules/orders/progress-schema';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { openCart } from '@/lib/cart-dialog';
import { useCartActions } from '@/lib/data/cart';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

/*
 * "Order again" (F5 design 8, S7.5): the order's dishes go into the cart at today's menu,
 * through the cart's own rules; never the code, tip, kitchen note, address or payment. The cart
 * opens and says what was added; anything left out is said in words under the button.
 */

/** One sentence per item left out (design 8 step 3). */
export function leftOutSentence(item: ReorderLeftOut): string {
  switch (item.kind) {
    case 'extraDropped':
      return `${item.extra ?? 'An extra'} is no longer offered on ${item.dish}, so we left it off.`;
    case 'kitchenRanOut':
      return `The kitchen ran out of ${item.dish} today, so we left it out.`;
    case 'offMenu':
      return `${item.dish} is no longer on the menu, so we left it out.`;
    case 'soldOut':
    default:
      return `${item.dish} is sold out, so we left it out.`;
  }
}

export const addedText = (quantity: number) =>
  `Added ${quantity} ${quantity === 1 ? 'dish' : 'dishes'} to your cart`;

export function OrderAgainButton({
  orderId,
  number,
  variant,
}: {
  orderId: string;
  number: string;
  variant: 'primary' | 'outline';
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
    const leftOut = outcome.data.leftOut.map(leftOutSentence);
    if (added === 0) {
      const text = 'None of these dishes can be ordered right now.';
      setStatus({ tone: 'info', lines: [text, ...leftOut] });
      announce(text);
      return;
    }
    if (leftOut.length) setStatus({ tone: 'info', lines: leftOut });
    openCart(buttonRef.current);
    announce([addedText(added), ...leftOut].join(' '));
  }

  return (
    <div className="flex flex-col items-center gap-1">
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
        onClick={() => void reorder()}
        className={cn(variant === 'primary' ? 'uppercase' : 'bg-white')}
      >
        {slow ? (
          <>
            <Spinner className="motion-reduce:animate-none" />
            Adding…
          </>
        ) : (
          <>
            Order again<span className="sr-only">: order {number}</span>
          </>
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
