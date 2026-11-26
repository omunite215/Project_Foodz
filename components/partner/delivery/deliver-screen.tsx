'use client';

import {
  AlarmClock,
  Ban,
  CircleHelp,
  KeyRound,
  type LucideIcon,
  Phone,
  SearchX,
  ShoppingBag,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import type { PartnerDeliveryF8, ProblemKind } from '@/server/modules/tracking/schema';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { tellNobodyAnswered } from '@/lib/partner/dispatch';
import {
  askedToWaitText,
  callName,
  clockLeft,
  DELIVERY_COPY,
  locationOffTitle,
  problemNotice,
  secondsLeft,
  waitingOneMinute,
  waitingStart,
  waitingTitle,
  waitingTold,
} from '@/lib/partner/delivery-text';
import { deliverPaymentWords, deliverTitle, phoneDisplay, telHref } from '@/lib/partner/offer-text';
import { cn } from '@/lib/utils';
import { LocationHelpCard } from '../home/home-parts';
import { Dock, DockButton, PartnerNotice } from '../shell';
import { CallKitchenLink, Fact, PaymentFact } from './pick-up-screen';

/*
 * The deliver screen (F8 design 2.5, replacing F7's interim screen): the map to her door, the
 * drop-off with her first name, address and phone (only now, P39), the cash or card line, the
 * problem link and "Enter delivery code" in the dock. No "Go offline" and no give-back after
 * pickup: "I can't finish this delivery" is the way out (P45.1).
 */

/** U6: the wait before staff decide; the server says when it's reportable. */
export const NO_ANSWER_SECONDS = 300;

export function CallCustomerLink({
  firstName,
  phone,
  className,
}: {
  firstName: string;
  phone: string;
  className?: string;
}) {
  const display = phoneDisplay(phone);
  return (
    <Button
      asChild
      variant="outline"
      size="kitchen"
      className={cn('w-full bg-card text-strong', className)}
    >
      <a href={telHref(phone)} aria-label={callName(firstName, display)}>
        <Phone className="size-5" aria-hidden />
        Call {firstName}
      </a>
    </Button>
  );
}

// ------------------------------------------------------------------ waiting (2.9)

export function WaitingCard({
  delivery,
  serverNow,
  askedToWait,
}: {
  delivery: PartnerDeliveryF8;
  serverNow: number;
  /** Staff asked him to wait (the event, or the DTO's restart time). */
  askedToWait: boolean;
}) {
  const noAnswer = delivery.noAnswer;
  const first = delivery.dropoff?.firstName ?? 'the customer';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = noAnswer ? secondsLeft(noAnswer.since, NO_ANSWER_SECONDS, serverNow) : 0;
  const up = Boolean(noAnswer && (noAnswer.reportable || left === 0));
  const told = Boolean(noAnswer?.told);

  // Spoken once each (P48.2): the start, one minute left, and the told line. What was already
  // there when the screen opened isn't read out.
  const since = noAnswer?.since ?? null;
  const saidStart = useRef<string | null>(since);
  useEffect(() => {
    if (!since || saidStart.current === since) return;
    saidStart.current = since;
    announce(askedToWait ? askedToWaitText(first) : waitingStart(first));
  }, [since, askedToWait, first]);
  const oneMinute = !told && left > 0 && left <= 60;
  const saidMinute = useRef<string | null>(null);
  useEffect(() => {
    if (!oneMinute || !since || saidMinute.current === since) return;
    saidMinute.current = since;
    announce(waitingOneMinute(first));
  }, [oneMinute, since, first]);
  const saidTold = useRef(told);
  useEffect(() => {
    if (!told || saidTold.current) return;
    saidTold.current = true;
    announce(DELIVERY_COPY.told);
  }, [told]);

  if (!noAnswer) return null;
  const phone = delivery.dropoff?.phone ?? null;
  return (
    <section
      aria-labelledby="wait-title"
      data-waiting-card=""
      className="rounded-2xl bg-warning-soft p-4"
    >
      <div className="flex items-start gap-3">
        <AlarmClock className="mt-0.5 size-6 shrink-0 text-warning-mark" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="wait-title" className="text-body-3 font-semibold text-strong">
            {waitingTitle(first)}
          </h2>
          {askedToWait && !told ? (
            <p className="mt-1 text-body-4 font-medium text-strong">{askedToWaitText(first)}</p>
          ) : null}
          {told ? null : (
            <p role="timer" className="text-title-2 font-semibold text-strong tabular-nums">
              {up ? '0:00' : clockLeft(noAnswer.since, NO_ANSWER_SECONDS, serverNow)}
            </p>
          )}
        </div>
      </div>
      <p className="mt-2 text-body-4 text-strong">
        {told ? DELIVERY_COPY.told : waitingTold(first)}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-body-4 text-danger-mark">
          {error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-2">
        {up && !told ? (
          <SubmitButton
            type="button"
            size="kitchen"
            className="w-full"
            pending={pending}
            pendingLabel={DELIVERY_COPY.telling}
            onClick={() => {
              if (pending) return;
              setPending(true);
              setError(null);
              void (async () => {
                const outcome = await tellNobodyAnswered();
                setPending(false);
                if (outcome === 'offline')
                  setError("You're offline. It will send when you're back.");
                else if (outcome === 'limit') setError(DELIVERY_COPY.problemLimit);
                else if (outcome === 'failed') setError('Something went wrong. Please try again.');
              })();
            }}
          >
            {DELIVERY_COPY.tellNobody}
          </SubmitButton>
        ) : null}
        {phone ? <CallCustomerLink firstName={first} phone={phone} /> : null}
        <CallKitchenLink phone={delivery.kitchen.phone} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ problem outcomes (2.8)

const PROBLEM_ICONS: Record<Exclude<ProblemKind, 'no-answer'>, LucideIcon> = {
  address: SearchX,
  refused: Ban,
  'cant-finish': TriangleAlert,
  other: CircleHelp,
};

export function ProblemOutcome({ delivery }: { delivery: PartnerDeliveryF8 }) {
  const kind = delivery.problem?.kind ?? null;
  const first = delivery.dropoff?.firstName ?? 'the customer';
  const words = kind && kind !== 'no-answer' ? problemNotice(kind, first) : null;
  // Read once when reported while the screen is open (not on load).
  const said = useRef<string | null>(words?.text ?? null);
  useEffect(() => {
    if (!words || said.current === words.text) return;
    said.current = words.text;
    announce(words.text);
  }, [words]);
  if (!kind || kind === 'no-answer' || !words) return null;
  const phone = delivery.dropoff?.phone ?? null;
  return (
    <PartnerNotice
      tone={words.tone === 'success' ? 'muted' : words.tone}
      icon={PROBLEM_ICONS[kind]}
      action={
        <div className="grid gap-2">
          {words.callCustomer && phone ? (
            <CallCustomerLink firstName={first} phone={phone} />
          ) : null}
          <CallKitchenLink
            phone={delivery.kitchen.phone}
            variant={kind === 'cant-finish' ? 'default' : 'outline'}
          />
        </div>
      }
    >
      {words.text}
    </PartnerNotice>
  );
}

// ------------------------------------------------------------------ the screen (2.5)

export function DeliverScreen({
  delivery,
  notices,
  mapCard,
  locationOff,
  serverNow,
  askedToWaitAt,
  onRetryLocation,
  onOpenProblems,
  problemRef,
}: {
  delivery: PartnerDeliveryF8;
  notices?: ReactNode;
  mapCard: ReactNode;
  locationOff: boolean;
  serverNow: number;
  /** F8 P43.4: the "asked to wait" event's time, if it reached this phone. */
  askedToWaitAt: string | null;
  onRetryLocation: () => void;
  onOpenProblems: () => void;
  problemRef?: Ref<HTMLButtonElement>;
}) {
  const dropoff = delivery.dropoff;
  const first = dropoff?.firstName ?? 'the customer';
  const noAnswer = delivery.noAnswer;
  const restarted = noAnswer?.waitRestartedAt ?? null;
  const askedToWait = Boolean(
    noAnswer &&
    ((restarted && Date.parse(restarted) >= Date.parse(noAnswer.since) - 1_000) ||
      (askedToWaitAt && Date.parse(askedToWaitAt) >= Date.parse(noAnswer.since) - 1_000)),
  );

  return (
    <div className="space-y-5">
      <h1
        data-deliver-h1=""
        data-partner-h1=""
        tabIndex={-1}
        className="font-heading text-h4 text-strong outline-none"
      >
        {deliverTitle(delivery.orderNumber)}
      </h1>
      {/* Design 2.8 (amended): the sheet closes onto this, scrolled into view. */}
      <div data-delivery-outcome="" className="scroll-mt-24 space-y-5 empty:hidden">
        <WaitingCard delivery={delivery} serverNow={serverNow} askedToWait={askedToWait} />
        <ProblemOutcome delivery={delivery} />
      </div>
      {notices}
      {locationOff ? (
        <LocationHelpCard
          card="turnedOff"
          title={locationOffTitle(delivery.orderNumber, first)}
          onRetry={onRetryLocation}
        />
      ) : null}
      {mapCard}
      {dropoff ? (
        <section
          aria-labelledby="dropoff-title"
          className="rounded-2xl border border-border bg-card p-4"
        >
          <h2 id="dropoff-title" className="text-body-5 text-muted-foreground">
            {DELIVERY_COPY.dropoff}
          </h2>
          <p className="text-body-3 font-semibold text-strong [overflow-wrap:anywhere]">
            {dropoff.firstName}
          </p>
          <p className="text-body-4 text-foreground [overflow-wrap:anywhere]">
            {dropoff.addressText}
          </p>
          {dropoff.apt ? (
            <p className="text-body-4 text-foreground [overflow-wrap:anywhere]">{dropoff.apt}</p>
          ) : null}
          {dropoff.instructions ? (
            <p className="mt-2 text-body-4 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
              <span className="sr-only">Instructions: </span>
              {dropoff.instructions}
            </p>
          ) : null}
          <div className="mt-4">
            {dropoff.phone ? (
              <CallCustomerLink firstName={dropoff.firstName} phone={dropoff.phone} />
            ) : (
              <CallKitchenLink phone={delivery.kitchen.phone} />
            )}
          </div>
        </section>
      ) : null}
      <dl className="divide-y divide-border rounded-2xl border border-border bg-card">
        <PaymentFact
          payment={delivery.payment}
          words={
            delivery.payment.kind === 'cash'
              ? deliverPaymentWords(delivery.payment).replace(' in cash.', ' in cash at the door.')
              : 'Paid by card'
          }
        />
        <Fact icon={ShoppingBag} label="Items">
          {delivery.itemsText}
        </Fact>
      </dl>
      <div className="mt-2 text-center">
        <button
          ref={problemRef}
          type="button"
          onClick={onOpenProblems}
          className="inline-flex h-12 items-center justify-center px-2 text-button-2 font-medium text-muted-foreground underline underline-offset-4"
        >
          {DELIVERY_COPY.problemTrigger}
        </button>
      </div>
    </div>
  );
}

export function DeliverDock({
  onEnterCode,
  buttonRef,
}: {
  onEnterCode: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <Dock withTabBar>
      <DockButton icon={KeyRound} buttonRef={buttonRef} onPress={onEnterCode}>
        {DELIVERY_COPY.enterCode}
      </DockButton>
    </Dock>
  );
}
