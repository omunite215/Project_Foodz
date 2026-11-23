import {
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock,
  CookingPot,
  type LucideIcon,
  PackageCheck,
  ShoppingBag,
  TimerOff,
  TriangleAlert,
  Truck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import type { Ref } from 'react';
import type { OrderStatusWord, OrderSummary } from '@/server/modules/orders/schema';
import { formatPrice } from '@/lib/format';
import {
  dishesText,
  methodWord,
  MONEY_FLAG_WORDS,
  orderDateText,
  orderHref,
  STATUS_WORDS,
} from '@/lib/order-text';
import { arrivalText } from '@/lib/order-progress';
import { cn } from '@/lib/utils';
import { OrderAgainButton } from './use-reorder';

/*
 * One order in the list (F4 design 4.2, 4.3, D37, D40): the whole card is one link, its text the
 * name (number, status, date, payment, dishes, total). Stacked below 1280 px, one line from there.
 */

const CHIPS: Record<OrderStatusWord, { icon: LucideIcon; className: string; iconClass: string }> = {
  waitingForPayment: { icon: Clock, className: 'bg-tag-6-bg', iconClass: 'text-tag-6' },
  placed: { icon: CircleDot, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  accepted: { icon: ClipboardCheck, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  preparing: { icon: CookingPot, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  ready: { icon: PackageCheck, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  pickedUp: { icon: Truck, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  delivered: { icon: Check, className: 'bg-brand-soft', iconClass: 'text-brand-strong' },
  cancelled: { icon: X, className: 'bg-tag-2-bg', iconClass: 'text-destructive' },
  expired: { icon: TimerOff, className: 'bg-neutral-7', iconClass: 'text-neutral-3' },
};

/** F5 design 7.1: each in-progress status has its word and its own icon; "Collected" for U23. */
export function StatusChip({
  word,
  collected = false,
}: {
  word: OrderStatusWord;
  collected?: boolean;
}) {
  const chip = CHIPS[word];
  const Icon = word === 'pickedUp' && collected ? ShoppingBag : chip.icon;
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1',
        chip.className,
      )}
    >
      <Icon className={cn('size-3.5', chip.iconClass)} aria-hidden />
      {word === 'pickedUp' && collected ? 'Collected' : STATUS_WORDS[word]}
    </span>
  );
}

export function MoneyChip({ flag }: { flag: NonNullable<OrderSummary['moneyFlag']> }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-neutral-7 px-2 text-caption font-medium whitespace-nowrap text-neutral-1">
      {MONEY_FLAG_WORDS[flag]}
    </span>
  );
}

export function OrderRow({
  order,
  now,
  timeZone,
  linkRef,
}: {
  order: OrderSummary;
  now: Date;
  timeZone: string;
  linkRef?: Ref<HTMLAnchorElement>;
}) {
  const date = `${orderDateText(order.createdAt, now, timeZone)} · ${methodWord(order.method)}`;
  const dishes = dishesText(order.dishes, order.moreCount);
  // F5 design 7.2: the order page's arrival on rows in progress.
  const arrival = arrivalText(order.arrival, null, timeZone);
  const metaId = `row-${order.id}-meta`;
  // F5 D24: a card with one stretched link, so "Order again" can sit on it. The link is named
  // "Order 1042" and described by the rest, in the spoken order (status, date, payment,
  // arrival, dishes, total); the grid places the status chip at the top right, and lays
  // everything on one line from 1280 px.
  return (
    <div
      data-order-row
      className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-2xl border border-neutral-6 bg-white p-4 transition-colors has-[a:hover]:border-neutral-5 has-[a:hover]:bg-neutral-8 md:p-5 xl:grid-cols-[9.5rem_minmax(0,1fr)_7.5rem_10.5rem_auto] xl:items-center xl:gap-x-6"
    >
      <Link
        ref={linkRef}
        href={orderHref(order.id)}
        aria-describedby={metaId}
        className="col-start-1 row-start-1 block rounded-md text-body-3 font-semibold text-neutral-1 tabular-nums after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-offset-4"
      >
        Order {order.number}
      </Link>
      <div id={metaId} className="contents">
        <span className="col-start-2 row-span-2 row-start-1 xl:col-start-4 xl:row-span-2 xl:self-center">
          <StatusChip word={order.statusWord} collected={order.collected} />
          <span className="sr-only">,</span>
        </span>
        <span className="col-start-1 row-start-2 mt-0.5 block text-body-5 text-neutral-3">
          {date}
          <span className="sr-only">,</span>
          {arrival ? (
            <span className="mt-1 flex items-center gap-1.5 text-body-5 text-neutral-1 tabular-nums">
              {arrival.tone === 'late' ? (
                <TriangleAlert className="size-3.5 text-warning-strong" aria-hidden />
              ) : (
                <Clock className="size-3.5 text-neutral-3" aria-hidden />
              )}
              <span aria-hidden>{arrival.headline}</span>
              <span className="sr-only">{arrival.spoken},</span>
            </span>
          ) : null}
        </span>
        <span className="col-span-2 row-start-3 mt-3 line-clamp-2 block text-body-5 text-neutral-2 [overflow-wrap:anywhere] xl:col-span-1 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:mt-0 xl:line-clamp-1">
          {dishes}
          <span className="sr-only">,</span>
        </span>
        <span className="col-start-1 row-start-4 mt-3 flex flex-wrap items-center gap-2 xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:mt-0">
          <span className="text-body-3 font-semibold text-neutral-1 tabular-nums">
            {formatPrice(order.totalCents)}
          </span>
          {order.moneyFlag ? <MoneyChip flag={order.moneyFlag} /> : null}
        </span>
      </div>
      {order.reorderable ? (
        <OrderAgainButton
          orderId={order.id}
          number={order.number}
          variant="outline"
          onRow
          className="relative z-10 col-start-2 row-start-4 mt-3 self-center justify-self-end xl:col-start-5 xl:row-span-2 xl:row-start-1 xl:mt-0"
        />
      ) : (
        <ChevronRight
          className="col-start-2 row-start-4 mt-3 size-5 self-center justify-self-end text-neutral-3 group-has-[a:hover]:text-neutral-1 xl:col-start-5 xl:row-span-2 xl:row-start-1 xl:mt-0"
          aria-hidden
        />
      )}
    </div>
  );
}
