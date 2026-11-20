import { HandCoins } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Quote } from '@/server/modules/cart/schema';
import {
  deliveryRowLabel,
  discountLabel,
  discountText,
  feeRangeText,
  taxRateText,
} from '@/lib/cart-text';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The price details and the total (F3 design 2.16, 2.17; Figma Checkout "Price" and "Total
 * (USD)"). Every figure is the server's. While a new answer is on its way the old figures stay,
 * dimmed to 75 % (still AA); after a failure they are hidden ("—"), never shown as current.
 * Reused by F4's checkout summary.
 */

/** Where the quote is (see useQuote). */
export type QuoteStatus =
  'loading' | 'ready' | 'updating' | 'failed' | 'rateLimited' | 'offline' | 'tooBig';

/** A money figure: two decimals, tabular, never wrapped; discounts read "minus $4.80". */
export function Money({
  cents,
  negative = false,
  className,
}: {
  cents: number;
  negative?: boolean;
  className?: string;
}) {
  const classes = cn('tabular-nums whitespace-nowrap', className);
  if (!negative) return <span className={classes}>{formatPrice(cents)}</span>;
  return (
    <span className={classes}>
      <span aria-hidden>{discountText(cents)}</span>
      <span className="sr-only">{discountLabel(cents)}</span>
    </span>
  );
}

function Placeholder({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-5 w-16 rounded-sm bg-neutral-7 align-middle animate-skeleton motion-reduce:animate-none',
        className,
      )}
    />
  );
}

function NotAvailable() {
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">not available</span>
    </>
  );
}

/** Figures are hidden after a failure, offline, or when the cart was refused. */
export const figuresHidden = (status: QuoteStatus) =>
  status === 'failed' || status === 'offline' || status === 'tooBig';

function Row({ label, value, dim }: { label: ReactNode; value: ReactNode; dim: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="min-w-0 text-body-5 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right text-body-5 font-medium whitespace-nowrap text-neutral-2 tabular-nums transition-opacity duration-150',
          dim && 'opacity-75',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export interface PriceBreakdownProps {
  quote: Quote | null;
  status: QuoteStatus;
  /** A new answer has been on its way for 150 ms. */
  dim: boolean;
  /** The label of an address checked without saving it ("Your address"). */
  checkedLabel?: string | null;
  headingId?: string;
}

export function PriceBreakdown({
  quote,
  status,
  dim,
  checkedLabel,
  headingId = 'price-details-title',
}: PriceBreakdownProps) {
  const hidden = figuresHidden(status);
  const loading = !quote && !hidden;
  const show = (value: ReactNode) =>
    hidden ? <NotAvailable /> : loading ? <Placeholder /> : value;
  const shown = hidden ? null : quote;

  const promo = shown?.promo?.status === 'applied' ? shown.promo : null;
  const delivery = shown?.delivery ?? quote?.delivery ?? null;
  const unknownDelivery = !delivery || delivery.status === 'unknown';

  let deliveryValue: ReactNode = null;
  if (shown && delivery) {
    if (delivery.status === 'outside') {
      deliveryValue = (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">not available</span>
        </>
      );
    } else if (delivery.status === 'unknown' || delivery.feeCents === null) {
      deliveryValue = feeRangeText(delivery.feeRange);
    } else if (promo?.freeDelivery) {
      deliveryValue = (
        <span className="flex flex-col items-end">
          <span aria-hidden className="text-brand-strong">
            Free
          </span>
          <span aria-hidden className="text-caption text-muted-foreground line-through">
            {formatPrice(delivery.feeCents)}
          </span>
          <span className="sr-only">free, was {formatPrice(delivery.feeCents)}</span>
        </span>
      );
    } else {
      deliveryValue = <Money cents={delivery.feeCents} />;
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h3 id={headingId} className="text-body-3 font-semibold text-neutral-1">
        Price details
      </h3>
      {loading ? <p className="sr-only">Working out your total</p> : null}
      <dl aria-busy={loading || undefined} className="mt-3">
        <Row
          label="Subtotal"
          value={show(shown && <Money cents={shown.subtotalCents} />)}
          dim={dim}
        />
        {promo ? (
          <Row
            label={`Promo · ${promo.code}`}
            value={
              promo.freeDelivery ? (
                <span className="text-brand-strong">Free delivery</span>
              ) : (
                <Money cents={promo.foodDiscountCents} negative className="text-brand-strong" />
              )
            }
            dim={dim}
          />
        ) : null}
        <Row
          label={
            <>
              {delivery ? deliveryRowLabel(delivery, checkedLabel) : 'Delivery'}
              {unknownDelivery ? (
                <span className="block text-caption text-muted-foreground">
                  depending on distance
                </span>
              ) : null}
            </>
          }
          value={show(deliveryValue)}
          dim={dim}
        />
        <Row
          label={quote ? `Tax (${taxRateText(quote.tax.rateBps)})` : 'Tax'}
          value={show(shown && <Money cents={shown.tax.cents} />)}
          dim={dim}
        />
      </dl>
      <p className="flex items-start gap-2 px-3 py-2 text-body-5 text-neutral-3">
        <HandCoins className="mt-0.5 size-4 shrink-0" aria-hidden />
        You can add a tip at checkout. All of it goes to your courier.
      </p>
    </section>
  );
}

export function TotalRow({
  quote,
  status,
  dim,
}: {
  quote: Quote | null;
  status: QuoteStatus;
  dim: boolean;
}) {
  const hidden = figuresHidden(status);
  const final = quote?.totalKind !== 'beforeDelivery';
  return (
    <div
      data-total-row
      className="flex items-baseline justify-between gap-4 rounded-lg bg-neutral-7 px-3 py-2"
    >
      <span className="text-body-4 font-medium text-neutral-2">
        {final ? 'Total' : 'Total before delivery'}
      </span>
      <span
        className={cn(
          'text-body-2 font-semibold text-neutral-1 transition-opacity duration-150',
          dim && 'opacity-75',
        )}
      >
        {hidden ? (
          <NotAvailable />
        ) : quote ? (
          <Money cents={quote.totalCents} />
        ) : (
          <Placeholder className="h-7 w-24" />
        )}
      </span>
    </div>
  );
}
