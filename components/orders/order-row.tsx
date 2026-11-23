import {
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  type LucideIcon,
  TimerOff,
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
import { cn } from '@/lib/utils';

/*
 * One order in the list (F4 design 4.2, 4.3, D37, D40): the whole card is one link, its text the
 * name (number, status, date, payment, dishes, total). Stacked below 1280 px, one line from there.
 */

const CHIPS: Record<OrderStatusWord, { icon: LucideIcon; className: string; iconClass: string }> = {
  waitingForPayment: { icon: Clock, className: 'bg-tag-6-bg', iconClass: 'text-tag-6' },
  placed: { icon: CircleDot, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  accepted: { icon: CircleDot, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  preparing: { icon: CircleDot, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  ready: { icon: CircleDot, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  pickedUp: { icon: Truck, className: 'bg-tag-3-bg', iconClass: 'text-tag-3' },
  delivered: { icon: Check, className: 'bg-brand-soft', iconClass: 'text-brand-strong' },
  cancelled: { icon: X, className: 'bg-tag-2-bg', iconClass: 'text-destructive' },
  expired: { icon: TimerOff, className: 'bg-neutral-7', iconClass: 'text-neutral-3' },
};

export function StatusChip({ word }: { word: OrderStatusWord }) {
  const chip = CHIPS[word];
  const Icon = chip.icon;
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1',
        chip.className,
      )}
    >
      <Icon className={cn('size-3.5', chip.iconClass)} aria-hidden />
      {STATUS_WORDS[word]}
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
  const when = orderDateText(order.createdAt, now, timeZone);
  const method = methodWord(order.method);
  const dishes = dishesText(order.dishes, order.moreCount);
  // The DOM order is the spoken order (number, status, date, payment, dishes, total). Below 768 px
  // the status chip sits in the bottom row by the chevron, so the number and the date keep the
  // whole width; from 768 px it moves to the top right; from 1280 px everything is on one line,
  // with the payment word under the total.
  return (
    <Link
      ref={linkRef}
      href={orderHref(order.id)}
      data-order-row
      className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 rounded-2xl border border-neutral-6 bg-white p-4 transition-colors hover:border-neutral-5 hover:bg-neutral-8 focus-visible:outline-offset-2 md:p-5 xl:grid-cols-[10.5rem_minmax(0,1fr)_7.5rem_10.5rem_1.25rem] xl:items-center xl:gap-x-6"
    >
      <span className="col-span-3 col-start-1 row-start-1 block text-body-3 font-semibold whitespace-nowrap text-neutral-1 tabular-nums md:col-span-1">
        Order {order.number}
        <span className="sr-only">,</span>
      </span>
      <span className="col-start-2 row-start-4 mt-3 self-center md:col-span-2 md:col-start-2 md:row-span-2 md:row-start-1 md:mt-0 md:self-start md:justify-self-end xl:col-span-1 xl:col-start-4 xl:self-center xl:justify-self-start">
        <StatusChip word={order.statusWord} />
        <span className="sr-only">,</span>
      </span>
      <span className="col-span-3 col-start-1 row-start-2 mt-0.5 block text-body-5 whitespace-nowrap text-neutral-3 md:col-span-1">
        {when}
        <span className="xl:hidden"> · {method}</span>
        <span className="sr-only">,</span>
      </span>
      <span className="col-span-3 row-start-3 mt-3 line-clamp-2 block text-body-5 text-neutral-2 [overflow-wrap:anywhere] xl:col-span-1 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:mt-0 xl:line-clamp-1">
        {dishes}
        <span className="sr-only">,</span>
      </span>
      <span className="col-start-1 row-start-4 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:mt-0">
        <span className="text-body-3 font-semibold whitespace-nowrap text-neutral-1 tabular-nums">
          {formatPrice(order.totalCents)}
        </span>
        {order.moneyFlag ? <MoneyChip flag={order.moneyFlag} /> : null}
        <span className="hidden w-full text-body-5 text-neutral-3 xl:block">
          <span className="sr-only">, </span>
          {method}
        </span>
      </span>
      <ChevronRight
        className="col-start-3 row-start-4 mt-3 size-5 self-center justify-self-end text-neutral-3 group-hover:text-neutral-1 xl:col-start-5 xl:row-span-2 xl:row-start-1 xl:mt-0"
        aria-hidden
      />
    </Link>
  );
}
