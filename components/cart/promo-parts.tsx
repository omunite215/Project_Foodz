'use client';

import {
  Check,
  CircleCheck,
  CircleExclamationPoint,
  Clock,
  Info,
  TicketPercent,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { useId, useRef } from 'react';
import type { Quote, QuoteOffer, QuotePromo } from '@/server/modules/cart/schema';
import { OfferCountdown } from '@/components/dish/offer-countdown';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { compareText, isMinimumReason, joinWords, shortfallText } from '@/lib/cart-text';
import { CUISINE_LABELS, formatPrice } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * What the cart's promo code section shows (F3 design 2.10 to 2.14): the message under the field,
 * the applied-code chip, the compare card and the offers. Presentational: the logic is in
 * promo.tsx.
 */

export type PromoMessage =
  | { tone: 'success' | 'neutral'; text: string }
  | { tone: 'error'; text: string; invalid: boolean; signInCode?: string }
  | { tone: 'limited' | 'offline'; text: string };

export type CompareState =
  | { status: 'loading'; code: string }
  | { status: 'failed'; code: string }
  | {
      status: 'ready';
      current: { code: string; totalCents: number };
      next: { code: string; totalCents: number };
      nextQuote: Quote;
    };

// ------------------------------------------------------------------ presentational parts

const MESSAGE_ICONS = {
  success: CircleCheck,
  neutral: Info,
  error: CircleExclamationPoint,
  limited: Clock,
  offline: WifiOff,
} as const;

const MESSAGE_COLOURS = {
  success: 'text-brand-strong',
  neutral: 'text-neutral-3',
  error: 'text-destructive',
  limited: 'text-neutral-3',
  offline: 'text-neutral-3',
} as const;

export function PromoMessageLine({
  id,
  message,
  signInHref,
  onSignIn,
}: {
  id: string;
  message: PromoMessage | null;
  signInHref?: React.ComponentProps<typeof Link>['href'];
  onSignIn?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current?.firstElementChild || motion.reduced) return;
      motion.from(ref.current.firstElementChild, {
        y: -4,
        opacity: 0,
        duration: 0.15,
        ease: 'power2.out',
      });
    },
    { scope: ref, dependencies: [message] },
  );
  const Icon = message ? MESSAGE_ICONS[message.tone] : null;
  return (
    <div ref={ref} id={id} className="mt-2 min-h-6 text-body-5">
      {message && Icon ? (
        <p className={cn('flex items-start gap-1.5', MESSAGE_COLOURS[message.tone])}>
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {message.text}
            {message.tone === 'error' && message.signInCode && signInHref ? (
              <>
                {' '}
                <Link
                  href={signInHref}
                  replace
                  onClick={onSignIn}
                  className="-my-3 inline-block py-3 font-medium text-brand-strong underline underline-offset-4"
                >
                  Sign in
                </Link>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** The code attached to the cart (design 2.11): "Applied" or "Not applied yet", with Remove. */
export function PromoChip({
  code,
  promo,
  onRemove,
}: {
  code: string;
  /** The quote's answer for this code; null while it is being checked. */
  promo: Pick<QuotePromo, 'status' | 'description' | 'reason'> | null;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const applied = promo?.status === 'applied';
  const waiting = promo?.status === 'notApplied';

  useMotion(
    (motion) => {
      if (!ref.current || !applied) return;
      motion.from(ref.current, {
        scale: 0.96,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.2,
        ease: 'power2.out',
      });
      const check = ref.current.querySelector('[data-applied-check]');
      if (check && !motion.reduced) {
        motion.from(check, { scale: 0.6, duration: 0.25, ease: 'back.out(2)' });
      }
    },
    { scope: ref, dependencies: [applied] },
  );

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-start gap-3 rounded-xl border border-dashed p-3',
        waiting ? 'border-neutral-4 bg-neutral-7' : 'border-brand-strong bg-brand-soft',
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white">
        <TicketPercent
          className={cn('size-5', waiting ? 'text-neutral-3' : 'text-brand-strong')}
          aria-hidden
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-body-4 font-semibold tracking-wider text-neutral-1 select-all">
            {code}
          </span>
          {applied ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-md bg-white px-2 text-caption font-medium text-neutral-1">
              <Check data-applied-check className="size-3 text-brand-strong" aria-hidden />
              Applied
            </span>
          ) : waiting ? (
            <span className="inline-flex h-6 items-center rounded-md bg-white px-2 text-caption font-medium text-neutral-1">
              Not applied yet
            </span>
          ) : null}
        </div>
        {promo?.description ? (
          <p className="mt-0.5 text-body-5 text-neutral-3">{promo.description}</p>
        ) : null}
        {waiting && isMinimumReason(promo.reason) ? (
          <p className="mt-1 text-body-5 text-neutral-3">
            {shortfallText(promo.reason)} to use it.
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="touch"
        onClick={onRemove}
        className="-my-1.5 px-2 text-button-2 font-medium text-neutral-1 underline-offset-4 hover:bg-white/60 hover:underline"
      >
        Remove<span className="sr-only"> {code}</span>
      </Button>
    </div>
  );
}

/** One code per order (S4.7, U6): both real totals, the cheaper choice first. */
export function PromoCompare({
  state,
  onKeep,
  onUse,
  onRetry,
}: {
  state: CompareState;
  onKeep: () => void;
  onUse: () => void;
  onRetry: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const slow = useSlowPending(state.status === 'loading');
  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: ref },
  );

  let body: React.ReactNode = null;
  if (state.status === 'loading') {
    body = slow ? (
      <p className="mt-1 flex items-center gap-2 text-body-5 text-neutral-3">
        <Spinner className="size-4 motion-reduce:animate-none" />
        Comparing totals…
      </p>
    ) : null;
  } else if (state.status === 'failed') {
    body = (
      <>
        <p className="mt-1 text-body-5 text-neutral-3">We couldn&apos;t compare the totals.</p>
        <Button type="button" variant="outline" size="touch" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      </>
    );
  } else {
    const { current, next } = state;
    const nextCheaper = next.totalCents < current.totalCents;
    const equal = next.totalCents === current.totalCents;
    const tiles = [current, next];
    const keep = (
      <Button
        key="keep"
        type="button"
        size="touch"
        variant={nextCheaper ? 'outline' : 'default'}
        onClick={onKeep}
      >
        Keep {current.code}
      </Button>
    );
    const use = (
      <Button
        key="use"
        type="button"
        size="touch"
        variant={nextCheaper ? 'default' : 'outline'}
        onClick={onUse}
      >
        Use {next.code}
      </Button>
    );
    body = (
      <>
        <p className="mt-1 text-body-5 text-neutral-3">{compareText(current, next)}</p>
        <ul aria-hidden className="mt-3 grid grid-cols-2 gap-2">
          {tiles.map((tile) => {
            const cheaper =
              !equal && tile.totalCents === Math.min(current.totalCents, next.totalCents);
            return (
              <li
                key={tile.code}
                className={cn(
                  'rounded-lg p-3',
                  cheaper ? 'border-2 border-brand-strong bg-brand-soft' : 'bg-neutral-7',
                )}
              >
                <span className="block text-body-5 font-semibold tracking-wider text-neutral-1 [overflow-wrap:anywhere]">
                  {tile.code}
                </span>
                <span className="block text-body-2 font-semibold whitespace-nowrap text-neutral-1 tabular-nums">
                  {formatPrice(tile.totalCents)}
                </span>
                {cheaper ? (
                  <span className="mt-1 inline-flex h-6 items-center gap-1 rounded-md bg-white px-2 text-caption font-medium text-neutral-1">
                    <Check className="size-3 text-brand-strong" aria-hidden />
                    Saves more
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-col gap-2 min-[400px]:flex-row">
          {nextCheaper ? [use, keep] : [keep, use]}
        </div>
      </>
    );
  }

  return (
    <section
      ref={ref}
      aria-labelledby={`${id}-title`}
      className="mt-3 rounded-xl border border-neutral-6 bg-white p-4"
    >
      <h3 id={`${id}-title`} className="text-body-4 font-semibold text-neutral-1">
        One promo code per order
      </h3>
      {body}
    </section>
  );
}

function offerReason(offer: QuoteOffer): string | null {
  if (offer.status === 'notApplied' && isMinimumReason(offer.reason)) {
    return shortfallText(offer.reason);
  }
  if (offer.reason?.code === 'notForTheseDishes') {
    return `Add a ${joinWords(
      offer.reason.cuisines.map((cuisine) => CUISINE_LABELS[cuisine]),
      'or',
    )} dish`;
  }
  return null;
}

/** Running campaigns with a public code (S4.10, B18), each one tap away. */
export function CartOffers({
  offers,
  appliedCode,
  onApply,
}: {
  offers: readonly QuoteOffer[];
  appliedCode: string | null;
  onApply: (code: string) => void;
}) {
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="cart-offers-title" className="mt-8">
      <h3 id="cart-offers-title" className="text-body-3 font-semibold text-neutral-1">
        Offers
      </h3>
      <ul className="mt-3 space-y-3">
        {offers.map((offer) => {
          const reason = offerReason(offer);
          return (
            <li
              key={offer.code}
              className="flex items-start gap-3 rounded-lg border border-neutral-6 bg-white p-3"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft"
              >
                <TicketPercent className="size-5 text-brand-strong" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-4 font-semibold tracking-wider text-neutral-1 select-all [overflow-wrap:anywhere]">
                  {offer.code}
                </p>
                {offer.description ? (
                  <p className="text-body-5 text-neutral-3">{offer.description}</p>
                ) : null}
                <OfferCountdown endsAt={offer.endsAt} size="compact" className="mt-2" />
                {reason ? <p className="mt-1 text-body-5 text-neutral-3">{reason}</p> : null}
              </div>
              {appliedCode === offer.code ? (
                <span className="inline-flex h-11 items-center gap-1 text-body-5 font-medium text-neutral-1">
                  <Check className="size-4 text-brand-strong" aria-hidden />
                  Applied
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  onClick={() => onApply(offer.code)}
                  className="bg-white"
                >
                  Apply<span className="sr-only"> {offer.code}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
