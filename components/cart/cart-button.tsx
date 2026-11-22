'use client';

import { ShoppingBag } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { closeCart, openCart, takeCartOpener, useCartOpen } from '@/lib/cart-dialog';
import { cartButtonLabel } from '@/lib/cart-text';
import { useCart } from '@/lib/data/cart';
import { useDialogHistory } from '@/lib/dialog-history';
import { cartBadgeText } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { takeCartReopen } from '@/lib/sign-in-reason';
import { CartPanel } from './cart-panel';

/*
 * The header's bag (F3 design 1.1, 2.1, 2.2): always drawn in the same 44 px slot, with the item
 * count as a badge, and the trigger of the cart dialog. The cart is full screen on phones and a
 * 440 px panel from 768 px. Opening adds a history entry, so Back closes it; focus starts on
 * its heading and returns to whatever opened it.
 */

export function CartButton({
  signedIn,
  phone,
}: {
  signedIn: boolean;
  phone: { display: string; tel: string } | null;
}) {
  const { itemCount, isReady } = useCart();
  const open = useCartOpen();
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const shownCount = useRef<number | null>(null);
  const leftPage = useRef(false);
  const history = useDialogHistory('foodzCart', open, closeCart);

  useMotion(
    (motion) => {
      const previous = shownCount.current;
      shownCount.current = itemCount;
      if (previous === null || previous === itemCount || motion.reduced) return;
      motion.fromTo(
        '[data-cart-badge]',
        { scale: 1.25 },
        { scale: 1, duration: 0.3, ease: 'back.out(2)' },
      );
    },
    { scope: slotRef, dependencies: [itemCount] },
  );

  const latest = useRef({ open, history });
  useEffect(() => {
    latest.current = { open, history };
  });

  // A new page closes the cart without stepping back (its entry was replaced), and the cart
  // opens again on return from signing in for it (B1, S4.8).
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== shownPath.current) {
      shownPath.current = pathname;
      if (latest.current.open) {
        leftPage.current = true;
        latest.current.history.forget();
        closeCart();
      }
    }
    if (takeCartReopen()) openCart(null);
  }, [pathname]);

  /** A link inside the cart replaces its history entry and leaves the page. */
  const navigating = () => {
    leftPage.current = true;
    history.forget();
    closeCart();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? openCart(null) : history.close())}>
      <SheetTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={cartButtonLabel(isReady ? itemCount : null)}
          className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-2 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid active:bg-neutral-6"
        >
          <span ref={slotRef} aria-hidden className="flex items-center justify-center">
            <ShoppingBag className="size-6" />
            {isReady && itemCount > 0 ? (
              <span
                data-cart-badge
                className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-strong px-1 text-caption font-semibold text-white tabular-nums"
              >
                {cartBadgeText(itemCount)}
              </span>
            ) : null}
          </span>
        </button>
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = takeCartOpener();
          if (leftPage.current) {
            leftPage.current = false;
            document.getElementById('main')?.focus();
            return;
          }
          (opener?.isConnected ? opener : triggerRef.current)?.focus();
        }}
        overlayClassName="bg-transparent md:bg-neutral-1/40"
        className="inset-0 h-dvh w-full bg-neutral-8 data-[state=closed]:duration-160 data-[state=closed]:slide-out-to-bottom-6 data-[state=open]:duration-240 data-[state=open]:slide-in-from-bottom-6 md:inset-y-0 md:right-0 md:left-auto md:w-[440px] md:max-w-[calc(100vw-3rem)] md:border-l md:border-neutral-6 md:shadow-raised md:data-[state=closed]:duration-200 md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:slide-out-to-right-full md:data-[state=open]:duration-280 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:slide-in-from-right-full motion-reduce:data-[state=closed]:duration-120 motion-reduce:data-[state=closed]:slide-out-to-bottom-0 motion-reduce:data-[state=open]:duration-120 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:md:data-[state=closed]:slide-out-to-right-0 motion-reduce:md:data-[state=open]:slide-in-from-right-0"
      >
        <CartPanel
          signedIn={signedIn}
          phone={phone}
          onMenu={pathname === '/menu'}
          titleRef={titleRef}
          onClose={history.close}
          onNavigate={navigating}
          onCheckoutPage={pathname === '/checkout'}
        />
      </SheetContent>
    </Sheet>
  );
}
