'use client';

import {
  Banknote,
  Check,
  CircleCheck,
  ClipboardCheck,
  Clock,
  CookingPot,
  CreditCard,
  House,
  Info,
  type LucideIcon,
  PackageCheck,
  Receipt,
  RefreshCw,
  ShoppingBag,
  TicketPercent,
  TimerOff,
  TriangleAlert,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { type ReactNode, type Ref, type RefObject, useRef } from 'react';
import type { OrderView } from '@/server/modules/orders/schema';
import type { OrderStep, StepKey } from '@/server/modules/orders/progress-schema';
import { SignInAgain } from '@/components/forms/sign-in-again';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/lib/motion';
import {
  arrivalText,
  cancellationMoney,
  cancellationOpener,
  cancellationReason,
  codeReleasedText,
  progressTimelineLabel,
  REFUND_SLOW_TEXT,
  stepSpoken,
  stepTime,
  stepWord,
  timelineTime,
} from '@/lib/order-progress';
import { telOf, timelineLabel } from '@/lib/order-text';
import { cn } from '@/lib/utils';

/*
 * The live parts of the customer's order page (F5 design 6.4 to 6.9): the stepper, the arrival
 * row and its late lines, the connection line, the cancellation card and the timeline card.
 * Never a staff name, role, note or reason code (S5.6).
 */

/**
 * A phone number inside a sentence, as a 44 px target (S8.5): padding grows the link's box to
 * 44 px tall and the same negative margin gives the space back, so the line doesn't move.
 */
export const PHONE_LINK_TARGET = 'inline-block py-3 -my-3';

/** A sentence with "{phone}" turned into a tap-to-call link (inline, underlined). */
export function WithPhone({ text, phone }: { text: string; phone: string }) {
  const [before, after] = text.split('{phone}');
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <a
        href={`tel:${telOf(phone)}`}
        className={cn('font-medium text-neutral-1 underline underline-offset-4', PHONE_LINK_TARGET)}
      >
        {phone}
      </a>
      {after}
    </>
  );
}

const STEP_ICONS: Record<StepKey, LucideIcon> = {
  placed: Receipt,
  accepted: ClipboardCheck,
  preparing: CookingPot,
  ready: PackageCheck,
  pickedUp: Truck,
  delivered: House,
};

function StepDisc({ step }: { step: OrderStep }) {
  const Icon = step.key === 'pickedUp' && step.collected ? ShoppingBag : STEP_ICONS[step.key];
  if (step.state === 'done') {
    return (
      <span
        aria-hidden
        className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-strong"
      >
        <Check data-check="" className="size-4 text-white" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full',
        step.state === 'current' ? 'bg-brand-soft' : 'border-2 border-neutral-4 bg-white',
      )}
    >
      {step.state === 'current' ? (
        <span data-ring="" className="absolute inset-0 rounded-full ring-2 ring-brand-strong" />
      ) : null}
      <Icon
        className={cn('size-4', step.state === 'current' ? 'text-brand-strong' : 'text-neutral-4')}
      />
    </span>
  );
}

/** "ddcuuu": each step's state by its first letter, to tell what a live change did. */
function stepStates(steps: readonly OrderStep[]): string {
  return steps.map((step) => step.state.charAt(0)).join('');
}

/**
 * A step reached while the page is open (motion table): the connector into the newly done
 * step fills, that disc's check scales in, then the next disc's ring fades in, about 600 ms.
 * A step taken back crossfades its discs; nothing runs backwards. Reduced motion: all swap.
 * Never on first paint.
 */
function useStepperMotion(list: RefObject<HTMLOListElement | null>, states: string) {
  const seen = useRef<string | null>(null);
  useMotion(
    (motion) => {
      const before = seen.current;
      seen.current = states;
      const root = list.current;
      if (!root || before === null || before === states || motion.reduced) return;
      const pick = (selector: string) => root.querySelector<HTMLElement | SVGElement>(selector);
      const done = (from: string, index: number) => from.charAt(index) === 'd';
      const forward = states
        .split('')
        .some((state, index) => state === 'd' && !done(before, index));
      if (!forward) {
        const changed = states
          .split('')
          .map((state, index) => (state === before.charAt(index) ? null : index))
          .filter((index) => index !== null);
        for (const index of changed) {
          const item = pick(`[data-step="${index}"]`);
          if (item) gsap.from(item, { opacity: 0.3, duration: 0.15, ease: 'power2.out' });
        }
        return;
      }
      const wide = window.matchMedia('(min-width: 48rem)').matches;
      const timeline = gsap.timeline();
      let at = 0;
      const connectors: Element[] = [];
      const checks: Element[] = [];
      for (let index = 0; index < states.length; index += 1) {
        if (!done(states, index) || done(before, index)) continue;
        const check = pick(`[data-step="${index}"] [data-check]`);
        if (check) checks.push(check);
        // The connector into this step fills when the step before it is done too.
        if (index > 0 && done(states, index - 1)) {
          const connector = pick(`[data-connector="${index - 1}"]`);
          if (connector) connectors.push(connector);
        }
      }
      if (connectors.length > 0) {
        timeline.fromTo(
          connectors,
          wide
            ? { scaleX: 0, transformOrigin: 'left center' }
            : { scaleY: 0, transformOrigin: 'center top' },
          { scaleX: 1, scaleY: 1, duration: 0.4, ease: 'power2.out' },
          0,
        );
        at = 0.4;
      }
      if (checks.length > 0) {
        timeline.fromTo(
          checks,
          { scale: 0.6, transformOrigin: '50% 50%' },
          { scale: 1, duration: 0.2, ease: 'back.out(2)' },
          at,
        );
        at += 0.2;
      }
      const ring = pick('[data-ring]');
      const current = states.indexOf('c');
      if (ring && current !== before.indexOf('c')) {
        timeline.fromTo(
          ring,
          { opacity: 0 },
          { opacity: 1, duration: 0.15, ease: 'power2.out' },
          at,
        );
      }
    },
    { scope: list, dependencies: [states] },
  );
}

/** Six steps with their times: vertical below 768 px, horizontal from there (design 6.4). */
export function OrderStepper({
  steps,
  now,
  timeZone,
}: {
  steps: readonly OrderStep[];
  now: Date;
  timeZone: string;
}) {
  const current = steps.find((step) => step.state === 'current');
  const last = steps.at(-1);
  const delivered = last?.state === 'done';
  const currentKey = delivered ? last?.key : current?.key;
  const listRef = useRef<HTMLOListElement>(null);
  useStepperMotion(listRef, stepStates(steps));
  return (
    <div>
      {current && !delivered ? (
        <p className="text-body-4 text-neutral-3">
          Now:{' '}
          <span className="font-semibold text-neutral-1">
            {stepWord(current.key, current.collected)}
          </span>
        </p>
      ) : null}
      <ol ref={listRef} aria-label="Order progress" className="mt-4 md:grid md:grid-cols-6">
        {steps.map((step, index) => {
          const next = steps[index + 1];
          const time =
            step.at && step.state !== 'upcoming' ? stepTime(step.at, now, timeZone) : null;
          const filled = step.state === 'done' && next?.state === 'done';
          return (
            <li
              key={step.key}
              data-step={index}
              aria-current={step.key === currentKey ? 'step' : undefined}
              className="relative flex min-h-12 gap-3 pb-4 last:pb-0 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
            >
              {next ? (
                <span
                  aria-hidden
                  data-connector={index}
                  className={cn(
                    'absolute top-9 bottom-0 left-4 w-0.5 md:top-4 md:right-[calc(-50%+1rem)] md:bottom-auto md:left-[calc(50%+1rem)] md:h-0.5 md:w-auto',
                    filled ? 'bg-brand-strong' : 'bg-neutral-6',
                  )}
                />
              ) : null}
              <StepDisc step={step} />
              <span aria-hidden className="min-w-0">
                <span
                  className={cn(
                    'block text-body-4 md:text-body-5',
                    step.state === 'upcoming'
                      ? 'text-muted-foreground'
                      : step.state === 'current'
                        ? 'font-semibold text-neutral-1'
                        : 'font-medium text-neutral-1',
                  )}
                >
                  {stepWord(step.key, step.collected)}
                </span>
                {time ? (
                  <span className="block text-body-5 text-neutral-3 tabular-nums md:text-caption">
                    {time.date ? <span className="block">{time.date}</span> : null}
                    {time.clock}
                  </span>
                ) : null}
              </span>
              <span className="sr-only">{stepSpoken(step, now, timeZone)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The arrival row and at most one amber note box (design 6.5). */
export function ArrivalRow({ view }: { view: OrderView }) {
  const text = arrivalText(
    view.progress.arrival,
    view.progress.deliveredAt,
    view.store.timeZone,
    view.progress.asOf,
  );
  if (!text) return null;
  const late = text.tone === 'late';
  const Icon = late ? TriangleAlert : text.tone === 'done' ? Check : Clock;
  return (
    <div className="mt-5 border-t border-neutral-6 pt-5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full',
            late ? 'bg-tag-6-bg' : 'bg-brand-soft',
          )}
        >
          <Icon className={cn('size-6', late ? 'text-warning-strong' : 'text-brand-strong')} />
        </span>
        <p className="text-body-3 font-semibold text-neutral-1 tabular-nums md:text-body-2">
          <span aria-hidden>{text.headline}</span>
          <span className="sr-only">{text.spoken}</span>
        </p>
      </div>
      {text.note ? (
        <p className="mt-3 flex gap-2 rounded-lg bg-tag-6-bg px-3 py-2 text-body-5 text-neutral-1">
          {late ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          ) : (
            <Clock className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          )}
          <span>
            <WithPhone text={text.note.text} phone={view.store.phone} />
          </span>
        </p>
      ) : null}
    </div>
  );
}

export type LiveLine = 'live' | 'behind' | 'signedOut' | 'hidden';

/** "This page updates by itself." and its other states (design 6.6). */
export function ConnectionLine({ state, returnPath }: { state: LiveLine; returnPath: string }) {
  if (state === 'hidden') return null;
  if (state === 'signedOut') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 text-body-5 text-neutral-1">
        <span>Sign in again to keep this page up to date.</span>
        <SignInAgain returnPath={returnPath} />
      </div>
    );
  }
  if (state === 'behind') {
    return (
      <p className="mt-4 flex items-center gap-2 text-body-5 text-neutral-1">
        <RefreshCw className="size-4 text-neutral-3" aria-hidden />
        Reconnecting… This page may be a little behind.
      </p>
    );
  }
  return <p className="mt-4 text-body-5 text-muted-foreground">This page updates by itself.</p>;
}

/** The status card: the stepper, the arrival and the connection line (design 6.4 to 6.6). */
export function ProgressCard({
  view,
  now,
  live,
}: {
  view: OrderView;
  now: Date;
  live: { state: LiveLine; returnPath: string };
}) {
  const steps = view.progress.steps;
  if (!steps) return null;
  return (
    <section
      aria-label="Order status"
      className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6"
    >
      <OrderStepper steps={steps} now={now} timeZone={view.store.timeZone} />
      <ArrivalRow view={view} />
      <ConnectionLine state={live.state} returnPath={live.returnPath} />
    </section>
  );
}

/** Cancelled by the kitchen or support (design 6.8): opener, reason, money, code. */
export function CancellationCard({
  view,
  headingRef,
  orderAgain,
  animateIn = false,
}: {
  view: OrderView;
  headingRef?: Ref<HTMLHeadingElement>;
  orderAgain?: ReactNode;
  /** Fade in when it arrives live; off when it is in the server's HTML (nothing first painted hides). */
  animateIn?: boolean;
}) {
  const notice = view.progress.cancellation;
  const ref = useRef<HTMLElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current || !animateIn || motion.reduced) return;
      motion.from(ref.current, { opacity: 0, duration: 0.2, ease: 'power2.out' });
    },
    { scope: ref },
  );
  if (!notice || notice.by !== 'store') return null;
  const tz = view.store.timeZone;
  const MoneyIcon =
    notice.moneyLine === 'refunded'
      ? CircleCheck
      : notice.moneyLine === 'refunding'
        ? CreditCard
        : notice.moneyLine === 'sample'
          ? Info
          : Banknote;
  return (
    <section
      ref={ref}
      aria-labelledby="cancel-title"
      className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6"
    >
      <h2
        id="cancel-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-body-2 font-semibold text-neutral-1 focus:outline-none"
      >
        {cancellationOpener(view.number, notice)}
      </h2>
      <p className="mt-2 text-body-4 text-neutral-2">
        <WithPhone
          text={cancellationReason(notice.reasonLine, notice.dishes)}
          phone={view.store.phone}
        />
      </p>
      <ul className="mt-4 space-y-3 border-t border-neutral-6 pt-4">
        <li className="flex gap-3 text-body-4 text-neutral-1">
          <MoneyIcon
            className={cn(
              'mt-0.5 size-5 shrink-0',
              notice.moneyLine === 'refunded' ? 'text-brand-strong' : 'text-neutral-3',
            )}
            aria-hidden
          />
          {cancellationMoney(notice, tz)}
        </li>
        {notice.codeReleased ? (
          <li className="flex gap-3 text-body-4 text-neutral-1">
            <TicketPercent className="mt-0.5 size-5 shrink-0 text-neutral-3" aria-hidden />
            {codeReleasedText(notice.codeReleased)}
          </li>
        ) : null}
        {notice.refundSlow ? (
          <li className="flex gap-3 text-body-4 text-neutral-1">
            <Clock className="mt-0.5 size-5 shrink-0 text-warning-strong" aria-hidden />
            <span>
              <WithPhone text={REFUND_SLOW_TEXT} phone={view.store.phone} />
            </span>
          </li>
        ) : null}
      </ul>
      <div className="mt-6 flex flex-col gap-3 max-sm:*:w-full sm:flex-row">
        <Button asChild size="touch" className="uppercase">
          <Link href="/menu">Browse the menu</Link>
        </Button>
        {orderAgain}
      </div>
    </section>
  );
}

const DOTS: Record<string, { icon: LucideIcon; className: string }> = {
  placed: { icon: Check, className: 'bg-brand-strong' },
  revived: { icon: Check, className: 'bg-brand-strong' },
  accepted: { icon: ClipboardCheck, className: 'bg-brand-strong' },
  preparing: { icon: CookingPot, className: 'bg-brand-strong' },
  ready: { icon: PackageCheck, className: 'bg-brand-strong' },
  pickedUp: { icon: Truck, className: 'bg-brand-strong' },
  delivered: { icon: House, className: 'bg-brand-strong' },
  cancelled: { icon: X, className: 'bg-neutral-3' },
  expired: { icon: TimerOff, className: 'bg-neutral-3' },
  refunded: { icon: Undo2, className: 'bg-neutral-3' },
  disputeOpened: { icon: Info, className: 'bg-neutral-3' },
  disputeClosed: { icon: Info, className: 'bg-neutral-3' },
};

/** The timeline in its own card with an h2 (design 6.9). */
export function TimelineCard({ view, now }: { view: OrderView; now: Date }) {
  if (view.timeline.length === 0) return null;
  return (
    <section
      aria-labelledby="timeline-title"
      className="mt-6 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6"
    >
      <h2 id="timeline-title" className="text-body-2 font-semibold text-neutral-1">
        Timeline
      </h2>
      <ol aria-labelledby="timeline-title" className="mt-4">
        {view.timeline.map((entry, index) => {
          const dot = DOTS[entry.kind] ?? { icon: Check, className: 'bg-neutral-3' };
          const Icon = entry.kind === 'pickedUp' && entry.collected ? ShoppingBag : dot.icon;
          const last = index === view.timeline.length - 1;
          const label =
            progressTimelineLabel(entry) ?? timelineLabel(entry.kind, entry.amountCents, view);
          return (
            <li key={`${entry.kind}-${entry.at}`} className="relative flex gap-3 pb-5 last:pb-0">
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
                <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
                  {label}
                </span>
                <span className="block text-body-5 text-neutral-3 tabular-nums">
                  {timelineTime(entry.at, now, view.store.timeZone)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
