'use client';

import {
  Banknote,
  CircleCheck,
  CreditCard,
  type LucideIcon,
  MapPin,
  ShoppingBag,
  Store,
  WifiOff,
  X,
} from 'lucide-react';
import { gsap } from 'gsap';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/announce';
import type { OfferCard as Card } from '@/lib/partner/dispatch';
import {
  acceptName,
  OFFER_COPY,
  offerKindLine,
  offerSummary,
  offerTitle,
  payLabel,
  secondsLeft,
  yoursText,
} from '@/lib/partner/offer-text';
import { PARTNER_COPY } from '@/lib/partner/text';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { IconDisc, PinnedBanner } from '../shell';
import { CountdownRing } from './countdown-ring';
import { type SlideState, SlideToAccept } from './slide-to-accept';

/*
 * The full-screen offer (F7 design 1.2, 1.3): the band, the countdown, the pay as the largest
 * text, the facts, then Decline above the slider in the dock. It covers the whole partner
 * column, tab bar included; everything behind is inert. The frame and countdown show from the
 * event alone; the pay and facts fill in, and accepting waits for them (P35.6). Escape never
 * closes it: Decline is the only way to say no (lead decision 3). Under 700 px of height the
 * countdown sits beside the pay so the whole card fits at 320 × 568 (D3).
 */

/** True while the element's content is taller than the element (200% text, short phones). */
function useScrollable(ref: React.RefObject<HTMLElement | null>): boolean {
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setScrollable(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(check);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    check();
    return () => observer.disconnect();
  }, [ref]);
  return scrollable;
}

/** Re-renders every 250 ms so the seconds change on the second. */
function useSecondsLeft(expiresAt: string, offset: number, running: boolean) {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt, offset));
  useEffect(() => {
    if (!running) return undefined;
    const tick = () => setLeft(secondsLeft(expiresAt, offset));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [expiresAt, offset, running]);
  return left;
}

function FactRow({
  icon: Icon,
  label,
  value,
  cash = false,
  iconClassName,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  cash?: boolean;
  iconClassName?: string;
}) {
  return (
    // dt and dd sit right in the row (a valid dl group); the icon is drawn inside the dt.
    <div
      className={cn(
        'relative min-h-14 py-3 pr-4 pl-12 [@media(max-height:700px)]:min-h-12 [@media(max-height:700px)]:py-2',
        cash && 'bg-warning-soft first:rounded-t-2xl last:rounded-b-2xl',
      )}
    >
      <dt className={cn('text-body-5', cash ? 'text-foreground' : 'text-muted-foreground')}>
        <Icon
          className={cn(
            'absolute top-3.5 left-4 size-5 [@media(max-height:700px)]:top-2',
            iconClassName ?? 'text-muted-foreground',
          )}
          aria-hidden
        />
        {/* On short screens the icon carries the row; the label stays for screen readers. */}
        <span className="[@media(max-height:700px)]:sr-only">{label}</span>
      </dt>
      <dd className="text-body-3 font-medium text-strong [overflow-wrap:anywhere] [@media(max-height:700px)]:text-body-4">
        {value}
      </dd>
    </div>
  );
}

function FactsSkeleton() {
  return (
    <div className="mt-6 space-y-px overflow-hidden rounded-2xl border border-border bg-card">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex min-h-14 items-center gap-3 px-4 py-3 [@media(max-height:700px)]:min-h-12"
        >
          <Skeleton className="size-5 rounded-full motion-reduce:animate-none" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-48 max-w-full motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OfferCardView({
  card,
  offset,
  noConnection,
  exiting = false,
  onAccept,
  onDecline,
  onBackToWaiting,
  onTouch,
}: {
  card: Card;
  offset: number;
  /** F6's pinned "No connection…" banner shows inside the card (P28.1). */
  noConnection: boolean;
  /** The card is leaving (160 ms fade): nothing in it reacts any more. */
  exiting?: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onBackToWaiting: () => void;
  onTouch: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollable = useScrollable(bodyRef);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const summaryId = useId();
  const detail = card.detail;
  const kind = detail?.kind ?? null;
  const counting = card.phase === 'open' || card.phase === 'accepting';
  const left = useSecondsLeft(card.expiresAt, offset, counting && !exiting);
  const total = detail?.totalSeconds ?? Math.max(30, card.openedWith);
  const practice = kind === 'practice';
  const finished = card.phase === 'offlineExpired' || card.phase === 'practiceAccepted';

  // The description says the seconds left when the details arrived (P35.3), then stays put.
  const [summaryLeft, setSummaryLeft] = useState<number | null>(null);
  if (detail && summaryLeft === null) setSummaryLeft(left);
  const summary = offerSummary(detail?.summary ?? null, summaryLeft ?? left);

  // The card takes focus on its title when it opens (P19.1); each offer mounts its own card.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    if (finished) titleRef.current?.focus();
  }, [finished]);

  // "10 seconds left", once (P21.2).
  const tenSaid = useRef(false);
  useEffect(() => {
    if (card.phase === 'open' && left <= 10 && left > 0 && !tenSaid.current) {
      tenSaid.current = true;
      announce(OFFER_COPY.tenLeft);
    }
  }, [left, card.phase]);

  // In: rise 24 px and fade (220 ms); the band flashes white twice (never under reduced motion).
  useMotion(
    (motion) => {
      const root = rootRef.current;
      if (!root) return;
      motion.from(root, {
        y: 24,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.22,
        ease: 'power3.out',
      });
      const flash = root.querySelector('[data-flash]');
      if (flash && !motion.reduced) {
        gsap.fromTo(
          flash,
          { opacity: 0 },
          { opacity: 0.6, duration: 0.12, ease: 'power1.inOut', yoyo: true, repeat: 3 },
        );
      }
    },
    { scope: rootRef, dependencies: [card.offerId] },
  );

  // Out: fade to nothing (160 ms); removed at once under reduced motion by the layer.
  useMotion(
    (motion) => {
      if (!exiting || !rootRef.current || motion.reduced) return;
      gsap.to(rootRef.current, { opacity: 0, duration: 0.16, ease: 'power2.in' });
    },
    { scope: rootRef, dependencies: [exiting] },
  );

  // Focus stays inside: Tab cycles between the card's controls. Escape does nothing.
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab' || !rootRef.current) return;
    const focusable = [
      ...rootRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex="0"]'),
    ].filter((element) => !element.closest('[inert]'));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === titleRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const slideState: SlideState =
    card.phase === 'accepted'
      ? 'accepted'
      : card.phase === 'accepting'
        ? card.waitingForConnection
          ? 'waiting'
          : 'accepting'
        : detail
          ? 'ready'
          : 'blocked';

  const cash = detail?.payment.kind === 'cash';

  return (
    // A modal layer drawn by the app (the native <dialog> can't sit under the suspension cover
    // and over Radix's portals); Tab is kept inside it here.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={rootRef}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      data-offer={card.offerId}
      inert={exiting || undefined}
      onKeyDown={trapFocus}
      className="fixed inset-0 z-[55] mx-auto flex w-full max-w-md flex-col bg-background md:border-x md:border-border"
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 [@media(max-height:700px)]:pt-[max(0.75rem,env(safe-area-inset-top))] [@media(max-height:700px)]:pb-3',
          practice ? 'bg-tag-8 text-white' : 'bg-status-online text-status-online-foreground',
        )}
      >
        <h2
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          className="text-body-2 font-semibold outline-none"
        >
          {offerTitle(kind)}
          {practice ? null : <span className="sr-only">{OFFER_COPY.offerSuffix}</span>}
        </h2>
        {offerKindLine(kind) ? (
          <p className="mt-1 text-body-4 [@media(max-height:700px)]:mt-0.5 [@media(max-height:700px)]:text-body-5">
            {offerKindLine(kind)}
          </p>
        ) : null}
        <span
          data-flash=""
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-white opacity-0"
        />
      </div>
      {noConnection ? (
        <PinnedBanner tone="warning" icon={WifiOff}>
          {PARTNER_COPY.noConnection}
        </PinnedBanner>
      ) : null}

      {/* Only the body scrolls (design 1.2): band and dock never move or shrink. While it
          scrolls it takes focus, so the keyboard can scroll it too. */}
      <div
        ref={bodyRef}
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? 'region' : undefined}
        aria-label={scrollable ? 'Offer details' : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-6 pb-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [@media(max-height:700px)]:pt-4"
      >
        {card.phase === 'offlineExpired' ? (
          <div className="pt-6 text-center">
            <IconDisc icon={WifiOff} />
            <h3 className="mt-6 font-heading text-title-1 text-strong">
              {OFFER_COPY.offlineExpired}
            </h3>
          </div>
        ) : card.phase === 'practiceAccepted' ? (
          <div className="pt-6 text-center">
            <IconDisc icon={CircleCheck} tone="success" />
            <h3 className="mt-6 font-heading text-title-1 text-strong">
              {OFFER_COPY.practiceAccepted}
            </h3>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center [@media(max-height:700px)]:flex-row [@media(max-height:700px)]:gap-4">
              <CountdownRing left={left} total={total} running={card.phase === 'open'} />
              <div className="mt-5 text-center [@media(max-height:700px)]:mt-0 [@media(max-height:700px)]:text-left">
                <p className="text-body-3 text-foreground">{payLabel(kind)}</p>
                {detail ? (
                  <p className="font-sans text-h2 leading-none font-semibold text-strong tabular-nums">
                    {detail.payText}
                  </p>
                ) : (
                  <Skeleton
                    aria-hidden
                    className="mx-auto mt-1 h-12 w-36 motion-reduce:animate-none [@media(max-height:700px)]:mx-0"
                  />
                )}
                {detail?.tipText ? (
                  <p className="mt-2 text-body-4 text-muted-foreground [@media(max-height:700px)]:mt-1">
                    {detail.tipText}
                  </p>
                ) : null}
              </div>
            </div>
            {detail ? (
              <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card [@media(max-height:700px)]:mt-4">
                <FactRow icon={Store} label={OFFER_COPY.pickup} value={detail.pickupText} />
                <FactRow icon={MapPin} label={OFFER_COPY.dropoff} value={detail.dropoffText} />
                <FactRow icon={ShoppingBag} label={OFFER_COPY.items} value={detail.itemsText} />
                <FactRow
                  icon={cash ? Banknote : CreditCard}
                  label={OFFER_COPY.payment}
                  value={detail.payment.text}
                  cash={cash}
                  iconClassName={cash ? 'text-warning-mark' : undefined}
                />
              </dl>
            ) : card.detailFailed ? (
              <p className="mt-6 text-body-4 text-foreground">{OFFER_COPY.detailsFailed}</p>
            ) : (
              <FactsSkeleton />
            )}
          </>
        )}
        <p id={summaryId} className="sr-only">
          {finished ? '' : summary}
        </p>
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {finished ? (
          <Button type="button" size="dock" onClick={onBackToWaiting}>
            {OFFER_COPY.backToWaiting}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="kitchen"
              aria-label={OFFER_COPY.declineName}
              aria-disabled={card.phase !== 'open' || undefined}
              onPointerDown={onTouch}
              onClick={() => {
                if (card.phase !== 'open') return;
                onDecline();
              }}
              className="w-full bg-card text-strong"
            >
              <X className="size-5" aria-hidden />
              {OFFER_COPY.decline}
            </Button>
            <div className="h-2" />
            <SlideToAccept
              state={slideState}
              name={acceptName(detail)}
              describedBy={summaryId}
              acceptedLabel={card.orderNumber ? yoursText(card.orderNumber) : undefined}
              onAccept={onAccept}
              onTouch={onTouch}
            />
          </>
        )}
      </div>
    </div>
  );
}
