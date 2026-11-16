'use client';

import { ShoppingBag } from 'lucide-react';
import { useRef } from 'react';
import { useCart } from '@/lib/data/cart';
import { cartBadgeText, cartCountLabel } from '@/lib/format';
import { useMotion } from '@/lib/motion';

/**
 * How many items are in the cart. Not a control yet: the cart sheet arrives with checkout.
 * The slot is always reserved, so the header never shifts when the count appears.
 */
export function CartStatus() {
  const { itemCount, isReady } = useCart();
  const slotRef = useRef<HTMLDivElement>(null);
  const shownCount = useRef<number | null>(null);

  useMotion(
    (motion) => {
      const previous = shownCount.current;
      shownCount.current = itemCount;
      if (previous === null || previous === itemCount) return;
      motion.fromTo(
        '[data-cart-badge]',
        { scale: 1.25 },
        { scale: 1, duration: 0.3, ease: 'back.out(2)' },
      );
    },
    { scope: slotRef, dependencies: [itemCount] },
  );

  return (
    <div ref={slotRef} className="relative flex size-11 shrink-0 items-center justify-center">
      {isReady && itemCount > 0 ? (
        <p className="flex items-center justify-center">
          <ShoppingBag className="size-6 text-neutral-2" aria-hidden />
          <span
            data-cart-badge
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-strong px-1 text-caption font-semibold text-white tabular-nums"
          >
            {cartBadgeText(itemCount)}
          </span>
          <span className="sr-only">{cartCountLabel(itemCount)}</span>
        </p>
      ) : null}
    </div>
  );
}
