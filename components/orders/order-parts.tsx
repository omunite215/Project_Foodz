'use client';

import {
  Banknote,
  Check,
  ClipboardCheck,
  CookingPot,
  PackageCheck,
  ShoppingBag,
  Truck,
  Clock,
  Copy,
  CreditCard,
  Info,
  type LucideIcon,
  MapPin,
  MessageSquareText,
  Phone,
  TimerOff,
  Undo2,
  UserRound,
  X,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useState } from 'react';
import type { OrderView, TimelineKind } from '@/server/modules/orders/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { discountLabel, discountText, taxRateText } from '@/lib/cart-text';
import { formatPrice } from '@/lib/format';
import {
  arrivingText,
  CONFIRMING_SLOW,
  countdownText,
  eventTimeText,
  type MoneyNotice,
  ORDER_HEADINGS,
  type OrderState,
  orderLine,
  paymentLine,
  placedAtText,
  timelineLabel,
} from '@/lib/order-text';
import {
  currentStep,
  deliveredByLine,
  isCollected,
  type ProgressStep,
  stepHeading,
  stepLine,
} from '@/lib/order-progress';
import { cn } from '@/lib/utils';
import { WithPhone } from './order-progress';
import { SuccessMark } from './success-mark';

/*
 * The parts of the order page (F4 design 3.2 to 3.9). Every figure is the order's snapshot,
 * never quoted again. Server-rendered with the page; only the confirming state polls.
 */

// ------------------------------------------------------------------ hero (3.2, 3.3)

const STEP_MARKS: Partial<Record<ProgressStep, LucideIcon>> = {
  accepted: ClipboardCheck,
  preparing: CookingPot,
  ready: PackageCheck,
  pickedUp: Truck,
};

export function OrderHero({
  view,
  state,
  play,
  headingRef,
  slow,
  now,
  markHiddenOnPhone = false,
}: {
  view: OrderView;
  state: OrderState;
  play: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Confirming for 30 s: say so (design 3.9). */
  slow: boolean;
  now: number;
  /** F8 (design 1.2): on its way with tracking, phones leave the 96 px mark out. */
  markHiddenOnPhone?: boolean;
}) {
  // F5: in progress and delivered, the step's mark, h1 and line (design 6.3).
  const step = state === 'placed' || state === 'delivered' ? currentStep(view) : null;
  if (step) {
    const collected = isCollected(view);
    const Mark = step === 'pickedUp' && collected ? ShoppingBag : STEP_MARKS[step];
    return (
      <div className="text-center">
        {Mark ? (
          <span
            aria-hidden
            className={cn(
              'mx-auto flex size-24 items-center justify-center rounded-full bg-brand-soft',
              markHiddenOnPhone && 'max-md:hidden',
            )}
          >
            <Mark className="size-10 text-brand-strong" />
          </span>
        ) : (
          <SuccessMark state={state} play={play} />
        )}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className={cn(
            'mt-4 font-heading text-h4 leading-tight text-balance text-neutral-2 focus:outline-none md:text-h3',
            markHiddenOnPhone && 'max-md:mt-0',
          )}
        >
          {stepHeading(step, collected)}
        </h1>
        <p className="mt-3 text-body-4 text-neutral-3 md:text-body-3">
          <WithPhone
            text={stepLine(view, step, collected).replace(view.store.phone, '{phone}')}
            phone={view.store.phone}
          />
        </p>
        {deliveredByLine(view) ? (
          <p className="mt-1 text-body-4 text-neutral-3 md:text-body-3">{deliveredByLine(view)}</p>
        ) : null}
      </div>
    );
  }
  const line = state === 'confirming' ? (slow ? CONFIRMING_SLOW : null) : orderLine(view, state);
  const countdown =
    state === 'waiting' && view.expiresAt ? countdownText(view.expiresAt, now) : null;
  return (
    <div className="text-center">
      <SuccessMark state={state} play={play} />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 font-heading text-h4 leading-tight text-balance text-neutral-2 focus:outline-none md:text-h3"
      >
        {ORDER_HEADINGS[state]}
      </h1>
      {line ? <p className="mt-3 text-body-4 text-neutral-3 md:text-body-3">{line}</p> : null}
      {countdown ? (
        <p className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-tag-6-bg px-3 text-body-5 font-medium text-neutral-1 tabular-nums">
          <Clock className="size-3.5 text-tag-6" aria-hidden />
          {countdown}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ order number (3.4)

export function OrderNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
      <p id="order-number" className="font-heading text-h4 text-neutral-1 tabular-nums">
        Order {number}
      </p>
      <Button
        type="button"
        variant="outline"
        size="touch"
        aria-label={`Copy order number ${number}`}
        onClick={() => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(number);
              setCopied(true);
              announce('Copied');
            } catch {
              // Clipboard blocked: the number stays on screen to read out.
            }
          })();
        }}
        className="border-neutral-6 bg-white text-neutral-2 hover:bg-neutral-7"
      >
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ status card and timeline (3.5)

const DOTS: Record<TimelineKind, { icon: LucideIcon; className: string }> = {
  placed: { icon: Check, className: 'bg-brand-strong' },
  revived: { icon: Check, className: 'bg-brand-strong' },
  cancelled: { icon: X, className: 'bg-neutral-3' },
  expired: { icon: TimerOff, className: 'bg-neutral-3' },
  refunded: { icon: Undo2, className: 'bg-neutral-3' },
  disputeOpened: { icon: Info, className: 'bg-tag-6' },
  disputeClosed: { icon: Info, className: 'bg-tag-6' },
  accepted: { icon: Check, className: 'bg-brand-strong' },
  preparing: { icon: Check, className: 'bg-brand-strong' },
  ready: { icon: Check, className: 'bg-brand-strong' },
  pickedUp: { icon: Check, className: 'bg-brand-strong' },
  delivered: { icon: Check, className: 'bg-brand-strong' },
};

/**
 * A time window or a minutes range with its unit kept on one line: "Arriving about 6:12–6:22 am"
 * may wrap before the times, never inside them.
 */
export function RangeText({ text }: { text: string }) {
  const parts = /^(.*?)(\d[\d:]*–\d[\d:]*\s(?:am|pm|min))(.*)$/.exec(text);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[1]}
      <span className="whitespace-nowrap">{parts[2]}</span>
      {parts[3]}
    </>
  );
}

export function OrderStatusCard({
  view,
  state,
  now,
  statusRef,
  timeline = true,
}: {
  view: OrderView;
  state: OrderState;
  now: Date;
  statusRef?: Ref<HTMLParagraphElement>;
  /** F5 shows the timeline in its own card (design 6.9). */
  timeline?: boolean;
}) {
  const showArrival = (state === 'placed' || state === 'confirming') && view.arrival !== null;
  const showTimeline = timeline && state !== 'confirming' && view.timeline.length > 0;
  if (!showArrival && !showTimeline) return null;
  const arriving =
    view.arrival?.from && view.arrival.to
      ? arrivingText(view.arrival.from, view.arrival.to, view.store.timeZone)
      : view.arrival
        ? {
            text: `Arriving in about ${view.arrival.fromMinutes}–${view.arrival.toMinutes} min`,
            spoken: `Arriving in about ${view.arrival.fromMinutes} to ${view.arrival.toMinutes} minutes`,
          }
        : null;

  return (
    <div className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6">
      {showArrival && arriving ? (
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft"
          >
            <Clock className="size-6 text-brand-strong" />
          </span>
          <div className="min-w-0">
            <p className="text-body-3 font-semibold text-neutral-1 tabular-nums md:text-body-2">
              <span aria-hidden>
                <RangeText text={arriving.text} />
              </span>
              <span className="sr-only">{arriving.spoken}</span>
            </p>
            {state === 'placed' ? (
              <p
                id="order-status"
                ref={statusRef}
                tabIndex={-1}
                className="mt-1 text-body-5 text-neutral-3 focus:outline-none"
              >
                Placed. The kitchen will confirm it shortly.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {showTimeline ? (
        <ol
          aria-label="Order timeline"
          className={cn(showArrival && 'mt-5 border-t border-neutral-6 pt-5')}
        >
          {view.timeline.map((event, index) => {
            const dot = DOTS[event.kind];
            const Icon = dot.icon;
            const last = index === view.timeline.length - 1;
            return (
              <li key={`${event.kind}-${event.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                {last ? null : (
                  <span aria-hidden className="absolute top-7 bottom-0 left-3 w-px bg-neutral-6" />
                )}
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full',
                    dot.className,
                  )}
                >
                  <Icon className="size-3.5 text-white" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-body-4 font-medium text-neutral-1">
                    {timelineLabel(event.kind, event.amountCents, view)}
                  </span>
                  <span className="block text-body-5 text-neutral-3 tabular-nums">
                    {eventTimeText(event.at, now, view.store.timeZone)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ money notices (3.9)

export function MoneyNotices({ notices }: { notices: readonly MoneyNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="mt-6 space-y-3">
      {notices.map((notice) => (
        <FormAlert key={notice.key} variant={notice.variant}>
          {notice.text}
        </FormAlert>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ receipt (3.6)

function Row({ label, value, spoken }: { label: string; value: ReactNode; spoken?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <dt className="min-w-0 text-body-5 text-muted-foreground">{label}</dt>
      <dd className="text-right text-body-5 font-medium whitespace-nowrap text-neutral-2 tabular-nums">
        {spoken ? (
          <>
            <span aria-hidden>{value}</span>
            <span className="sr-only">{spoken}</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function Receipt({ view, state }: { view: OrderView; state: OrderState }) {
  const { breakdown } = view;
  const promo = breakdown.promo;
  const deliveryLabel = view.delivery.label
    ? `Delivery to ${view.delivery.label} · ${view.delivery.distanceKm.toFixed(1)} km`
    : 'Delivery';
  const pay = paymentLine(view, state);
  const refunded = view.refunds.refundedCents;
  const PayIcon = view.payment.method === 'card' ? CreditCard : Banknote;

  return (
    <section aria-labelledby="receipt-title" className="receipt-paper mt-6">
      <div className="receipt-sheet bg-white px-5 pt-5 md:px-6 md:pt-6">
        <h2 id="receipt-title" className="text-body-2 font-semibold text-neutral-1">
          Receipt
        </h2>
        <p className="mt-1 text-body-5 text-neutral-3">
          {placedAtText(view.placedAt ?? view.createdAt, view.store.timeZone)}
        </p>
        <ul className="mt-4 divide-y divide-dashed divide-neutral-6">
          {view.lines.map((line, index) => (
            <li
              // Snapshot lines have no id of their own; their order never changes.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0 text-body-4 text-neutral-1 [overflow-wrap:anywhere]">
                <span aria-hidden>
                  {line.quantity} × {line.title}
                </span>
                <span className="sr-only">
                  {line.quantity} times {line.title}
                </span>
                {line.flavors.length > 0 ? (
                  <span className="block text-body-5 text-neutral-3">
                    Extra: {line.flavors.join(', ')}
                  </span>
                ) : null}
                {line.note ? (
                  <span className="block text-body-5 text-neutral-3">Note: {line.note}</span>
                ) : null}
              </div>
              <span className="text-body-4 font-medium whitespace-nowrap text-neutral-1 tabular-nums">
                {formatPrice(line.lineTotalCents)}
              </span>
            </li>
          ))}
        </ul>
        {view.kitchenNote ? (
          <p className="mt-1 text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
            Note for the kitchen: {view.kitchenNote}
          </p>
        ) : null}
        <dl className="mt-3 border-t border-dashed border-neutral-6 pt-2">
          <Row label="Subtotal" value={formatPrice(breakdown.subtotalCents)} />
          {promo && promo.foodDiscountCents > 0 ? (
            <Row
              label={`Promo · ${promo.code}`}
              value={
                <span className="text-brand-strong">{discountText(promo.foodDiscountCents)}</span>
              }
              spoken={discountLabel(promo.foodDiscountCents)}
            />
          ) : null}
          <Row
            label={deliveryLabel}
            value={
              breakdown.deliveryDiscountCents > 0 ? (
                <span className="text-brand-strong">
                  Free (was {formatPrice(breakdown.deliveryFeeCents)})
                </span>
              ) : (
                formatPrice(breakdown.deliveryFeeCents)
              )
            }
          />
          <Row
            label={
              breakdown.tax.rateBps === null ? 'Tax' : `Tax (${taxRateText(breakdown.tax.rateBps)})`
            }
            value={formatPrice(breakdown.tax.cents)}
          />
          <Row label="Tip for your courier" value={formatPrice(breakdown.tipCents)} />
        </dl>
        <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg bg-neutral-7 px-3 py-2">
          <span className="text-body-4 font-medium text-neutral-2">Total</span>
          <span className="text-body-2 font-semibold text-neutral-1 tabular-nums">
            {formatPrice(breakdown.totalCents)}
          </span>
        </div>
        {/* After the total, which stays what was charged, so the column above adds up (3.6). */}
        {refunded > 0 && view.payment.card ? (
          <dl className="mt-2">
            <Row
              label={`Refunded to ${view.payment.card.label}`}
              value={<span className="text-brand-strong">{discountText(refunded)}</span>}
              spoken={discountLabel(refunded)}
            />
          </dl>
        ) : null}
        <p className="mt-4 flex items-center gap-2 text-body-5 text-neutral-1">
          <PayIcon className="size-4 shrink-0" aria-hidden />
          {pay.text === pay.spoken ? (
            <span>{pay.text}</span>
          ) : (
            <>
              <span aria-hidden>{pay.text}</span>
              <span className="sr-only">{pay.spoken}</span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ delivery (3.7)

export function DeliveryCard({
  view,
  headingId = 'delivery-title',
  className = 'mt-6',
}: {
  view: OrderView;
  /** F8: the card is drawn once per column (one hidden by CSS), so each gets its own id. */
  headingId?: string;
  className?: string;
}) {
  const { delivery, contact } = view;
  const where = delivery.label ? `${delivery.label}, ${delivery.line1}` : delivery.line1;
  const more = [delivery.line2, delivery.city].filter(Boolean).join(', ');
  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-2xl border border-neutral-6 bg-white p-5 md:p-6', className)}
    >
      <h2 id={headingId} className="text-body-2 font-semibold text-neutral-1">
        Delivery
      </h2>
      <ul className="mt-3 space-y-2 text-body-4 text-neutral-1">
        <li className="flex gap-2">
          <MapPin className="mt-1 size-4 shrink-0 text-neutral-3" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Delivering to {where}
            {more ? <span className="block text-body-5 text-neutral-3">{more}</span> : null}
          </span>
        </li>
        {delivery.instructions ? (
          <li className="flex gap-2">
            <MessageSquareText className="mt-1 size-4 shrink-0 text-neutral-3" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="sr-only">Courier instructions: </span>
              {delivery.instructions}
            </span>
          </li>
        ) : null}
        <li className="flex gap-2">
          <Phone className="mt-1 size-4 shrink-0 text-neutral-3" aria-hidden />
          <span>
            Your courier will call <span className="whitespace-nowrap">{contact.phoneDisplay}</span>{' '}
            if needed.
          </span>
        </li>
        <li className="flex gap-2">
          <UserRound className="mt-1 size-4 shrink-0 text-neutral-3" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Name for the order: {contact.firstName}
          </span>
        </li>
      </ul>
    </section>
  );
}
