'use client';

import { ChevronDown, Pencil, ShoppingBag } from 'lucide-react';
import { type ReactNode, type Ref, useRef } from 'react';
import type { Quote } from '@/server/modules/cart/schema';
import { UndoRow } from '@/components/cart/cart-line';
import {
  figuresHidden,
  Money,
  PriceBreakdown,
  type QuoteStatus,
  TotalRow,
} from '@/components/cart/price-breakdown';
import { DishPlate } from '@/components/dish/dish-plate';
import { Button } from '@/components/ui/button';
import { droppedFlavorText, priceChangeText, unitLabel, unitText } from '@/lib/cart-text';
import { itemsText, orderLinesLabel } from '@/lib/checkout-text';
import { formatPrice } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * The Summary (F4 design 2.6, D4, D30): one disclosure row on phones and tablets ("Summary · 3
 * items · $53.97 · Show"), an open card from 1024 px that stays in view and scrolls on its own.
 * Lines are plain text (nothing takes her out of checkout), with Remove and its in-place Undo;
 * "Edit in cart" opens the cart for quantities and extras.
 */

export interface SummaryLineView {
  key: string;
  title: string | null;
  /** "Remove Gimbap with Gochujang" when two lines share a dish. */
  suffix: string;
  image: string | null;
  quantity: number;
  unitCents: number | null;
  flavors: readonly string[];
  note?: string;
  soldOut: boolean;
  priceChange: { nowCents: number; wasCents: number } | null;
  droppedFlavors: readonly string[];
}

export interface CheckoutSummaryProps {
  lines: readonly SummaryLineView[];
  /** The line just removed, shown as an undo row in its place. */
  undo: { key: string; title: string } | null;
  itemCount: number;
  quote: Quote | null;
  status: QuoteStatus;
  dim: boolean;
  open: boolean;
  onToggle: () => void;
  onRemove: (key: string) => void;
  onUndo: () => void;
  onEditCart: (button: HTMLButtonElement) => void;
  /** Notices above the lines (press refusals first, then the F3 quote notices). */
  notices: ReactNode;
  promo: ReactNode;
  undoRef?: Ref<HTMLButtonElement>;
  removeRef?: (key: string, element: HTMLButtonElement | null) => void;
  editCartRef?: Ref<HTMLButtonElement>;
  /** The cart hasn't loaded from this device yet. */
  loading: boolean;
  /** While a press is on its way nothing here can change (D21). */
  inert?: boolean;
}

function SummaryTotal({
  quote,
  status,
  dim,
}: {
  quote: Quote | null;
  status: QuoteStatus;
  dim: boolean;
}) {
  if (figuresHidden(status)) {
    return (
      <span className="text-body-3 font-semibold text-neutral-1">
        <span aria-hidden>—</span>
      </span>
    );
  }
  if (!quote) {
    return (
      <span
        aria-hidden
        className="inline-block h-6 w-16 rounded-sm bg-neutral-7 animate-skeleton motion-reduce:animate-none"
      />
    );
  }
  return (
    <Money
      cents={quote.totalCents}
      className={cn(
        'text-body-3 font-semibold text-neutral-1 transition-opacity duration-150',
        dim && 'opacity-75',
      )}
    />
  );
}

export function CheckoutSummary({
  lines,
  undo,
  itemCount,
  quote,
  status,
  dim,
  open,
  onToggle,
  onRemove,
  onUndo,
  onEditCart,
  notices,
  promo,
  undoRef,
  removeRef,
  editCartRef,
  loading,
  inert = false,
}: CheckoutSummaryProps) {
  // "Show" below 1024 px: the body fades in from 4 px up; no height tween (F1 accordion rule).
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  useMotion(
    (motion) => {
      const opened = open && !wasOpen.current;
      wasOpen.current = open;
      if (!opened || motion.reduced || !bodyRef.current) return;
      motion.from(bodyRef.current, { y: -4, opacity: 0, duration: 0.15, ease: 'power2.out' });
    },
    { scope: bodyRef, dependencies: [open] },
  );

  const totalWords =
    figuresHidden(status) || !quote
      ? ''
      : `, ${quote.totalKind === 'final' ? '' : 'before delivery '}${formatPrice(quote.totalCents)}`;

  return (
    <section
      aria-labelledby="summary-title"
      inert={inert}
      className={cn(
        '-mx-6 border-y border-neutral-6 bg-white px-6',
        'md:mx-0 md:rounded-2xl md:border md:px-5',
        'lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:p-6',
        'xl:col-span-5 xl:col-start-8 min-[90rem]:-ml-6',
      )}
    >
      <h2
        id="summary-title"
        className="hidden font-heading text-title-2 text-neutral-2 lg:block xl:text-h4"
      >
        Summary
      </h2>
      {notices ? <div className="pt-3 lg:mt-4 lg:pt-0">{notices}</div> : null}
      <h2 className="lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="summary-body"
          onClick={onToggle}
          className="flex min-h-14 w-full items-center gap-3 rounded-lg py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <ShoppingBag className="size-5 shrink-0 text-neutral-3" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-body-4 font-semibold text-neutral-1">
              Summary
              {loading ? null : <span className="sr-only">,</span>}
            </span>
            <span className="block text-body-5 text-neutral-3">
              {loading ? null : itemsText(itemCount)}
              {totalWords ? <span className="sr-only">,</span> : null}
            </span>
          </span>
          <SummaryTotal quote={quote} status={status} dim={dim} />
          <span
            aria-hidden
            className="inline-flex items-center gap-1 text-body-5 font-medium text-brand-strong"
          >
            {open ? 'Hide' : 'Show'}
            <ChevronDown
              className={cn(
                'size-5 transition-transform duration-200 motion-reduce:transition-none',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </span>
        </button>
      </h2>

      <div
        ref={bodyRef}
        id="summary-body"
        className={cn(open ? 'block' : 'hidden', 'pb-6 lg:block lg:pb-0')}
      >
        {loading ? (
          <div aria-busy="true" className="space-y-4 py-4">
            <p className="sr-only">Loading your order</p>
            {[0, 1].map((row) => (
              <div key={row} className="flex gap-3">
                <span className="size-16 shrink-0 rounded-full bg-neutral-7 animate-skeleton motion-reduce:animate-none" />
                <span className="flex-1 space-y-2">
                  <span className="block h-5 w-2/3 rounded-sm bg-neutral-7 animate-skeleton motion-reduce:animate-none" />
                  <span className="block h-4 w-1/3 rounded-sm bg-neutral-7 animate-skeleton motion-reduce:animate-none" />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <ul aria-label={orderLinesLabel(itemCount)} className="divide-y divide-neutral-6">
            {lines.map((line) => {
              if (undo?.key === line.key) {
                return (
                  <li key={line.key} className="py-3">
                    <UndoRow title={undo.title} onUndo={onUndo} undoRef={undoRef} />
                  </li>
                );
              }
              const title = line.title ?? 'This dish';
              const lineTotal = line.unitCents === null ? null : line.unitCents * line.quantity;
              return (
                <li
                  key={line.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-4 md:gap-x-4"
                >
                  <span aria-hidden>
                    <DishPlate
                      src={line.image}
                      sizes="72px"
                      soldOut={line.soldOut}
                      className="size-16 md:size-18"
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-heading text-body-3 leading-tight text-neutral-2 [overflow-wrap:anywhere]">
                        {title}
                      </p>
                      {lineTotal === null ? null : (
                        <Money
                          cents={lineTotal}
                          className={cn(
                            'font-heading text-body-3 text-brand-strong transition-opacity duration-150',
                            dim && 'opacity-75',
                            line.soldOut && 'text-neutral-3 line-through',
                          )}
                        />
                      )}
                    </div>
                    {line.unitCents === null ? null : (
                      <p className="mt-1 text-body-5 text-neutral-3 tabular-nums">
                        <span aria-hidden>{unitText(line.quantity, line.unitCents)}</span>
                        <span className="sr-only">{unitLabel(line.quantity, line.unitCents)}</span>
                      </p>
                    )}
                    {line.flavors.length > 0 ? (
                      <p className="mt-1 text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
                        Extras: {line.flavors.join(', ')}
                      </p>
                    ) : null}
                    {line.note ? (
                      <p className="mt-1 line-clamp-2 text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
                        Note: {line.note}
                      </p>
                    ) : null}
                    {line.soldOut ? (
                      <p className="mt-1 text-body-5 font-medium text-destructive">
                        Sold out today
                      </p>
                    ) : null}
                    {line.priceChange ? (
                      <p className="mt-1 text-body-5 text-neutral-1">
                        {priceChangeText(line.priceChange.nowCents, line.priceChange.wasCents)}
                      </p>
                    ) : null}
                    {line.droppedFlavors.length > 0 ? (
                      <p className="mt-1 text-body-5 text-neutral-1">
                        {droppedFlavorText(line.droppedFlavors, title)}
                      </p>
                    ) : null}
                    <Button
                      ref={(element) => removeRef?.(line.key, element)}
                      type="button"
                      variant="ghost"
                      onClick={() => onRemove(line.key)}
                      className="-ml-2 h-11 px-2 text-button-2 font-medium text-destructive hover:bg-neutral-7 hover:text-destructive"
                    >
                      Remove
                      <span className="sr-only">
                        {' '}
                        {title}
                        {line.suffix}
                      </span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Button
          ref={editCartRef}
          type="button"
          variant="ghost"
          onClick={(event) => onEditCart(event.currentTarget)}
          className="h-11 px-2 text-button-2 font-medium text-brand-strong hover:bg-neutral-7 hover:text-brand-strong"
        >
          <Pencil className="size-4" aria-hidden />
          Edit in cart
        </Button>
        {promo}
        <PriceBreakdown
          quote={quote}
          status={status}
          dim={dim}
          variant="checkout"
          headingId="checkout-price-title"
          className="mt-6"
        />
        <div className="mt-2">
          <TotalRow quote={quote} status={status} dim={dim} />
        </div>
      </div>
    </section>
  );
}
