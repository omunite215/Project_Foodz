'use client';

import { useSelector } from '@tanstack/react-store';
import {
  AlarmClock,
  BellRing,
  Hourglass,
  Info,
  type LucideIcon,
  Route,
  Smartphone,
  Timer,
} from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { dispatchStore, refreshSoundState, sendPracticeOffer } from '@/lib/partner/dispatch';
import { alertOnce, canVibrate, unlockOfferSound } from '@/lib/partner/offer-sound';
import { howOffersWorkItems, OFFER_COPY } from '@/lib/partner/offer-text';
import { IconDisc } from '../shell';

/*
 * The idle additions (F7 design 1.8, 1.10, 1.16): "How offers work" (a link and its sheet, on
 * the online and the offline home), Riley's practice card, and Profile's "Offer alerts".
 */

const ITEM_ICONS: Record<ReturnType<typeof howOffersWorkItems>[number]['key'], LucideIcon> = {
  route: Route,
  wait: Hourglass,
  timer: Timer,
  alarm: AlarmClock,
  phone: Smartphone,
};

export function HowOffersWorkSheet({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const numbers = useSelector(dispatchStore, (state) => state.howOffersWork);
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // An offer closes the sheet under it without sending focus back (design 1.1).
  const shown = open && !offerOpen;
  return (
    <Sheet open={shown} onOpenChange={onOpenChange}>
      <SheetContent
        className="inset-x-0 bottom-0 mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-2xl bg-card px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!dispatchStore.state.card) returnFocus();
        }}
      >
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="font-heading text-title-1 text-strong outline-none"
        >
          {OFFER_COPY.howOffersWork}
        </SheetTitle>
        <SheetDescription className="sr-only">
          How Foodz chooses who gets an offer, and how long you have to answer.
        </SheetDescription>
        <ul className="mt-4 space-y-4 text-body-4 text-foreground">
          {howOffersWorkItems(numbers).map((item) => {
            const Icon = ITEM_ICONS[item.key];
            return (
              <li key={item.key} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                {item.text}
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="dock"
          className="mt-6 bg-card text-strong"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/** The link under the facts card (online) or the kitchen chip (offline). */
export function HowOffersWorkLink() {
  const [open, setOpen] = useState(false);
  const linkRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={linkRef}
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex h-12 items-center gap-2 text-button-2 font-medium text-primary underline underline-offset-4"
      >
        <Info className="size-4" aria-hidden />
        {OFFER_COPY.howOffersWork}
      </button>
      <HowOffersWorkSheet
        open={open}
        onOpenChange={setOpen}
        returnFocus={() => linkRef.current?.focus()}
      />
    </>
  );
}

/** Riley only: "Send a practice offer" (P34). */
export function PracticeOfferCard() {
  const practice = useSelector(dispatchStore, (state) => state.practice);
  const limitId = useId();
  return (
    <section aria-label="Practice offers" className="rounded-2xl border border-border bg-card p-4">
      <div className="flex gap-3">
        <span className="shrink-0">
          <IconDisc icon={BellRing} size="md" />
        </span>
        <p className="text-body-4 text-foreground">{OFFER_COPY.practiceTry}</p>
      </div>
      <SubmitButton
        type="button"
        variant="outline"
        size="kitchen"
        pending={practice.pending}
        pendingLabel={OFFER_COPY.practiceSending}
        blocked={Boolean(practice.limit)}
        aria-describedby={practice.limit ? limitId : undefined}
        onClick={() => void sendPracticeOffer()}
        className="mt-3 w-full bg-card text-strong"
      >
        {OFFER_COPY.practiceSend}
      </SubmitButton>
      {practice.limit ? (
        <p id={limitId} className="mt-2 text-body-5 text-foreground">
          {practice.limit}
        </p>
      ) : null}
    </section>
  );
}

const subscribeNothing = () => () => {};

/** Profile › "Offer alerts" (P19.3, P19.5). */
export function OfferAlertsSection() {
  const id = useId();
  const [tested, setTested] = useState(false);
  const vibrates = useSyncExternalStore(subscribeNothing, canVibrate, () => true);
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-body-3 font-semibold text-strong">
        {OFFER_COPY.offerAlerts}
      </h2>
      <Button
        type="button"
        variant="outline"
        size="kitchen"
        className="mt-3 w-full bg-card text-strong"
        onClick={() => {
          void (async () => {
            await unlockOfferSound();
            refreshSoundState();
            alertOnce();
          })();
          setTested(true);
        }}
      >
        <BellRing className="size-5" aria-hidden />
        {OFFER_COPY.testAlert}
      </Button>
      {tested ? (
        <output className="mt-2 block text-body-5 text-foreground">
          {OFFER_COPY.testAlertHint}
        </output>
      ) : null}
      {vibrates ? null : (
        <p className="mt-2 flex gap-2 text-body-5 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {OFFER_COPY.noVibrate}
        </p>
      )}
    </section>
  );
}
