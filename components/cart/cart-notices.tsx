'use client';

import {
  CircleCheck,
  Clock,
  CreditCard,
  Info,
  type LucideIcon,
  PackageX,
  ShoppingBag,
  TicketPercent,
  WifiOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useRef } from 'react';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import {
  cartFullText,
  type CartLimit,
  priceChangedNoticeText,
  removedNoticeText,
  soldOutNoticeText,
} from '@/lib/cart-text';
import { useMotion } from '@/lib/motion';
import { orderHref } from '@/lib/order-text';

/*
 * What changed, at the top of the cart, in a fixed order (F3 design 2.4). Each says why in words;
 * the lines carry the details. "Sold out" can't be dismissed: it blocks checkout until the
 * dishes are removed.
 */

export type CartNotice =
  /** F4 S7.6: a card order is waiting for its payment. Shown first. */
  | { kind: 'unpaid'; orderId: string; number: string }
  /** F4 B16: an order just emptied the cart. */
  | { kind: 'placed'; orderId: string; number: string }
  | { kind: 'closed'; text: string }
  | { kind: 'soldOut'; count: number }
  | { kind: 'removed'; count: number }
  | { kind: 'priceChanged'; count: number }
  | { kind: 'codeEnded'; text: string }
  | { kind: 'full'; limit: CartLimit; phone: string | null; tel: string | null }
  | { kind: 'offline' };

export type CartNoticeKind = CartNotice['kind'];

export const OFFLINE_NOTICE = "You're offline. Your total will update when you're back online.";

/** The notice's words, as announced once when it first appears. */
export function noticeText(notice: CartNotice): string {
  switch (notice.kind) {
    case 'unpaid':
      return `You have an unpaid order ${notice.number}.`;
    case 'placed':
      return `Order ${notice.number} is placed. Your cart has been emptied.`;
    case 'closed':
    case 'codeEnded':
      return notice.text;
    case 'soldOut':
      return soldOutNoticeText(notice.count);
    case 'removed':
      return removedNoticeText(notice.count);
    case 'priceChanged':
      return priceChangedNoticeText(notice.count);
    case 'full':
      return cartFullText(notice.limit, notice.phone);
    case 'offline':
      return OFFLINE_NOTICE;
    default:
      return '';
  }
}

const LOOKS: Record<
  CartNoticeKind,
  { variant: 'warning' | 'error' | 'info'; icon: LucideIcon; dismissible: boolean }
> = {
  unpaid: { variant: 'warning', icon: CreditCard, dismissible: false },
  placed: { variant: 'info', icon: CircleCheck, dismissible: true },
  closed: { variant: 'warning', icon: Clock, dismissible: false },
  soldOut: { variant: 'error', icon: PackageX, dismissible: false },
  removed: { variant: 'info', icon: Info, dismissible: true },
  priceChanged: { variant: 'info', icon: Info, dismissible: true },
  codeEnded: { variant: 'warning', icon: TicketPercent, dismissible: true },
  full: { variant: 'warning', icon: ShoppingBag, dismissible: false },
  offline: { variant: 'info', icon: WifiOff, dismissible: false },
};

/** The id of the cart-full notice, which describes every blocked "+". */
export const CART_FULL_NOTICE_ID = 'cart-full-notice';

function FullText({ notice }: { notice: Extract<CartNotice, { kind: 'full' }> }) {
  const text = cartFullText(notice.limit, notice.phone);
  if (!notice.phone || !notice.tel) return <>{text}</>;
  const [before] = text.split(notice.phone);
  return (
    <>
      {before}
      <a href={`tel:${notice.tel}`} className="font-medium text-neutral-1 underline">
        {notice.phone}
      </a>
      .
    </>
  );
}

export function CartNotices({
  notices,
  onDismiss,
  onRemoveSoldOut,
  onNavigate,
}: {
  notices: readonly CartNotice[];
  onDismiss: (kind: CartNoticeKind) => void;
  onRemoveSoldOut: () => void;
  /** A link in a notice is about to replace the cart's history entry with its page. */
  onNavigate?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const kinds = notices.map((notice) => notice.kind).join(',');

  useMotion(
    (motion) => {
      const last = ref.current?.lastElementChild;
      if (!last || motion.reduced) return;
      motion.from(last, { y: -4, opacity: 0, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref, dependencies: [kinds] },
  );

  if (notices.length === 0) return null;
  return (
    <div ref={ref} className="space-y-3">
      {notices.map((notice) => {
        const look = LOOKS[notice.kind];
        let body: ReactNode = noticeText(notice);
        if (notice.kind === 'full') body = <FullText notice={notice} />;
        if (notice.kind === 'unpaid' || notice.kind === 'placed') {
          body = (
            <>
              {noticeText(notice)}{' '}
              <Link
                href={orderHref(notice.orderId)}
                replace
                onClick={onNavigate}
                className="inline-flex h-11 items-center font-medium text-neutral-1 underline underline-offset-4"
              >
                {notice.kind === 'unpaid' ? 'Finish paying' : 'View your order'}
              </Link>
            </>
          );
        }
        return (
          <div
            key={notice.kind}
            id={notice.kind === 'full' ? CART_FULL_NOTICE_ID : undefined}
            className="relative"
          >
            <FormAlert
              variant={look.variant}
              icon={look.icon}
              className={look.dismissible ? 'pr-14' : undefined}
              action={
                notice.kind === 'soldOut' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="bg-white"
                    onClick={onRemoveSoldOut}
                  >
                    Remove sold-out dishes
                  </Button>
                ) : null
              }
            >
              {body}
            </FormAlert>
            {look.dismissible ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                aria-label="Dismiss"
                onClick={() => onDismiss(notice.kind)}
                className="absolute top-1.5 right-1.5 text-neutral-1 hover:bg-white/60"
              >
                <X className="size-5" aria-hidden />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
