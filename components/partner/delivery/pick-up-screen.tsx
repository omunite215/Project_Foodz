'use client';

import { useSelector } from '@tanstack/react-store';
import {
  Banknote,
  Clock,
  CreditCard,
  type LucideIcon,
  MapPin,
  MapPinCheck,
  Navigation,
  Phone,
  ShoppingBag,
  Store,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PartnerDeliveryF8 } from '@/server/modules/tracking/schema';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { distanceMeters, type Point } from '@/lib/map-geometry';
import { useMotion } from '@/lib/motion';
import {
  confirmPickUp,
  dispatchStore,
  loadDelivery,
  mapsWarned,
  rememberMapsWarned,
} from '@/lib/partner/dispatch';
import {
  callName,
  counterText,
  DELIVERY_COPY,
  farDescription,
  farTitle,
  mapsName,
  mapsWarning,
  notReadyText,
  pickedUpAnnouncement,
} from '@/lib/partner/delivery-text';
import {
  earnWords,
  GIVE_BACK_COPY,
  isApplePhone,
  kitchenLine,
  mapsHref,
  phoneDisplay,
  pickUpPaymentWords,
  pickUpTitle,
  telHref,
  withoutThen,
} from '@/lib/partner/offer-text';
import { cn } from '@/lib/utils';
import { type SlideState, SlideToConfirm } from '../offers/slide-to-accept';
import { Dock, IconDisc } from '../shell';
import { LocationHelpCard } from '../home/home-parts';

/*
 * The pick-up screen (F8 design 2.2, extending F7 1.12): the map to the kitchen with "Open in
 * Maps" in its footer, then the counter card with the big order number once he's there, the
 * kitchen card and the facts. The slider holds the dock from acceptance, so it works from far
 * away with the 300 m check. Before pickup nothing of the customer shows (P29.3).
 */

const subscribeNothing = () => () => {};
const applePhone = () => isApplePhone(navigator.userAgent, navigator.maxTouchPoints ?? 0);

/** Apple Maps on iPhone and iPad, Google Maps elsewhere; decided in the browser (D14). */
export function useMapsHref(point: { lat: number; lng: number }, bicycle: boolean): string {
  const apple = useSyncExternalStore(subscribeNothing, applePhone, () => false);
  return mapsHref(point, { apple, bicycle });
}

export const FAR_M = 300;

export function CallKitchenLink({
  phone,
  variant = 'outline',
}: {
  phone: string;
  variant?: 'outline' | 'default';
}) {
  const display = phoneDisplay(phone);
  return (
    <Button
      asChild
      variant={variant}
      size="kitchen"
      className={cn('w-full', variant === 'outline' && 'bg-card text-strong')}
    >
      <a href={telHref(phone)} aria-label={callName('Foodz Kitchen', display)}>
        <Phone className="size-5" aria-hidden />
        {DELIVERY_COPY.callKitchen}
      </a>
    </Button>
  );
}

export function Fact({
  icon: Icon,
  label,
  children,
  cash = false,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  cash?: boolean;
}) {
  return (
    // dt and dd sit right in the row (a valid dl group); the icon is drawn inside the dt.
    <div
      className={cn(
        'relative min-h-14 py-3 pr-4 pl-12',
        cash && 'bg-warning-soft first:rounded-t-2xl last:rounded-b-2xl',
      )}
    >
      <dt className={cn('text-body-5', cash ? 'text-foreground' : 'text-muted-foreground')}>
        <Icon
          className={cn(
            'absolute top-3.5 left-4 size-5',
            cash ? 'text-warning-mark' : 'text-muted-foreground',
          )}
          aria-hidden
        />
        {label}
      </dt>
      <dd className="text-body-3 font-medium text-strong [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function PaymentFact({
  payment,
  words,
}: {
  payment: PartnerDeliveryF8['payment'];
  words: string;
}) {
  const cash = payment.kind === 'cash';
  return (
    <Fact icon={cash ? Banknote : CreditCard} label="Payment" cash={cash}>
      {words}
    </Fact>
  );
}

const LINK_BUTTON =
  'inline-flex h-12 items-center justify-center px-2 text-button-2 font-medium text-muted-foreground underline underline-offset-4';

// ------------------------------------------------------------------ Open in Maps (2.4)

/**
 * "Open in Maps" in the map card's footer. The first press per delivery asks first (U10); "Open
 * Maps" is the link itself. Its name says where to (WCAG 2.5.3 starts with the visible words).
 */
export function OpenInMapsButton({
  deliveryId,
  point,
  bicycle,
  customerFirst,
}: {
  deliveryId: string;
  point: Point;
  bicycle: boolean;
  /** After pickup: "Open directions to Priya's door in Maps". */
  customerFirst: string | null;
}) {
  const href = useMapsHref(point, bicycle);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);
  const name = mapsName(customerFirst);
  return (
    <>
      <Button asChild variant="outline" size="kitchen" className="bg-card text-strong">
        <a
          ref={triggerRef}
          href={href}
          target="_blank"
          rel="noopener"
          aria-label={name}
          onClick={(event) => {
            if (mapsWarned(deliveryId)) return;
            event.preventDefault();
            setOpen(true);
          }}
        >
          <Navigation className="size-5" aria-hidden />
          {DELIVERY_COPY.openInMaps}
        </a>
      </Button>
      <AlertDialog open={open && !offerOpen} onOpenChange={setOpen}>
        <AlertDialogContent
          className="border border-border bg-card text-foreground"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            stayRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <AlertDialogTitle className="font-heading text-title-2 text-strong">
            {DELIVERY_COPY.mapsTitle}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-3 text-body-4 text-foreground">
            {mapsWarning(customerFirst !== null)}
          </AlertDialogDescription>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              ref={stayRef}
              type="button"
              variant="outline"
              size="kitchen"
              className="w-full bg-card text-strong"
              onClick={() => setOpen(false)}
            >
              {DELIVERY_COPY.stayInFoodz}
            </Button>
            <Button asChild size="kitchen" className="w-full">
              <a
                href={href}
                target="_blank"
                rel="noopener"
                onClick={() => {
                  rememberMapsWarned(deliveryId);
                  setOpen(false);
                }}
              >
                {DELIVERY_COPY.openMaps}
              </a>
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------------------------------------------------------------------ the 300 m check (2.3, 2.6)

export function FarCheckDialog({
  open,
  step,
  orderNumber,
  meters,
  onCancel,
  onConfirm,
  returnFocus,
}: {
  open: boolean;
  step: 'pickUp' | 'handOver';
  orderNumber: string;
  meters: number;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocus?: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent
        className="border border-border bg-card text-foreground"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return;
          event.preventDefault();
          returnFocus();
        }}
      >
        <AlertDialogTitle className="font-heading text-title-2 text-strong">
          {farTitle(step, orderNumber)}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-3 text-body-4 text-foreground">
          {farDescription(step, meters)}
        </AlertDialogDescription>
        <div className="mt-6 flex flex-col gap-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="kitchen"
            className="w-full bg-card text-strong"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="button" size="kitchen" className="w-full" onClick={onConfirm}>
            {step === 'pickUp' ? 'Yes, I have it' : 'Yes, hand it over'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ------------------------------------------------------------------ the counter card (2.2)

export function CounterCard({ orderNumber, live }: { orderNumber: string; live: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const text = counterText(orderNumber);
  useMotion(
    (motion) => {
      if (!live || !ref.current) return;
      motion.from(ref.current, { opacity: 0, duration: motion.reduced ? 0 : 0.2 });
    },
    { scope: ref },
  );
  // Read once when he arrives while the screen is open (never on load).
  const said = useRef(!live);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    announce(text);
  }, [text]);
  return (
    <section
      ref={ref}
      aria-label="At the kitchen"
      data-counter-card=""
      className="rounded-2xl bg-success-soft p-4 text-center"
    >
      <MapPinCheck className="mx-auto size-6 text-success-mark" aria-hidden />
      <p className="mt-2 text-body-4 text-strong">{text}</p>
      <p aria-hidden className="mt-3 font-heading text-h3 text-strong tabular-nums">
        {orderNumber}
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ the screen

export function PickUpScreen({
  delivery,
  distance,
  locationOff,
  notices,
  mapCard,
  atKitchenAtLoad,
  onGiveBack,
  onGoOffline,
  onRetryLocation,
}: {
  delivery: PartnerDeliveryF8;
  /** From his own latest fix to the kitchen point (F7 1.12); null before a fix. */
  distance: { atKitchen: boolean; km: number } | null;
  /** Location turned off while he holds it (P29.5). */
  locationOff: boolean;
  /** The notice slot: the kitchen moved it back, and the like (P31). */
  notices?: ReactNode;
  /** The map card (2.1), until he's at the kitchen. */
  mapCard: ReactNode;
  /** He was already at the kitchen when the screen opened: the counter card isn't read out. */
  atKitchenAtLoad: boolean;
  onGiveBack: () => void;
  onGoOffline: () => void;
  onRetryLocation: () => void;
}) {
  const atKitchen = delivery.stage === 'atKitchen';
  return (
    <div className="space-y-5">
      <h1
        data-pickup-h1=""
        data-partner-h1=""
        tabIndex={-1}
        className="font-heading text-h4 text-strong outline-none"
      >
        {pickUpTitle(delivery.orderNumber)}
      </h1>
      {notices}
      {locationOff ? (
        <LocationHelpCard
          card="turnedOff"
          title={`You still have order ${delivery.orderNumber}. Turn location back on so Foodz knows you're coming.`}
          onRetry={onRetryLocation}
        />
      ) : null}
      {atKitchen ? (
        <CounterCard orderNumber={delivery.orderNumber} live={!atKitchenAtLoad} />
      ) : (
        mapCard
      )}
      <section aria-label="Pickup" className="rounded-2xl border border-border bg-card p-4">
        <div className="flex gap-3">
          <span className="shrink-0">
            <IconDisc icon={Store} tone="success" size="md" />
          </span>
          <div className="min-w-0">
            <p className="text-body-3 font-semibold text-strong [overflow-wrap:anywhere]">
              {kitchenLine(delivery.kitchen.addressText)}
            </p>
            {distance?.atKitchen || atKitchen ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-2.5 py-1 text-body-4 font-medium text-strong">
                <MapPinCheck className="size-4 text-success-mark" aria-hidden />
                You&apos;re at the kitchen
              </p>
            ) : distance ? (
              <p className="mt-1 text-body-4 text-foreground">
                <span className="text-title-2 font-semibold text-strong tabular-nums">
                  {distance.km.toFixed(1)} km
                </span>{' '}
                from you
              </p>
            ) : null}
          </div>
        </div>
      </section>
      <dl className="divide-y divide-border rounded-2xl border border-border bg-card">
        <Fact icon={MapPin} label="Then">
          {withoutThen(delivery.dropoffText)}
        </Fact>
        <Fact icon={Wallet} label="You earn">
          {earnWords(delivery.payText, delivery.tipText)}
        </Fact>
        <PaymentFact payment={delivery.payment} words={pickUpPaymentWords(delivery.payment)} />
        <Fact icon={ShoppingBag} label="Items">
          {delivery.itemsText}
        </Fact>
      </dl>
      <CallKitchenLink phone={delivery.kitchen.phone} />
      {delivery.canGiveBack ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6">
          <button type="button" onClick={onGiveBack} className={LINK_BUTTON}>
            {GIVE_BACK_COPY.trigger}
          </button>
          <button type="button" onClick={onGoOffline} className={LINK_BUTTON}>
            Go offline
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the slider in the dock (2.3)

const PICKUP_SLIDE = {
  slide: DELIVERY_COPY.slide,
  tapAgain: DELIVERY_COPY.tapAgain,
  blocked: DELIVERY_COPY.slide,
  busy: DELIVERY_COPY.confirming,
  busyOffline: DELIVERY_COPY.confirmingOffline,
};

const RETRY_MS = 2_000;
const DONE_HOLD_MS = 800;

/** Focus the deliver screen's h1 after his own slide (it's his action). */
const focusScreen = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-partner-h1]')?.focus());

export function PickUpDock({
  delivery,
  position,
}: {
  delivery: PartnerDeliveryF8;
  /** His latest fix, for the 300 m check (P38.3). */
  position: Point | null;
}) {
  const [state, setState] = useState<SlideState>('ready');
  const [far, setFar] = useState<number | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasonId = 'pickup-dock-reason';
  const blocked = !delivery.orderReady;

  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );

  const send = async (confirmFar: boolean) => {
    const outcome = await confirmPickUp(confirmFar);
    if (outcome === 'offline') {
      setState('waiting');
      retry.current = setTimeout(() => void send(confirmFar), RETRY_MS);
      return;
    }
    if (outcome === 'done') {
      setState('accepted');
      retry.current = setTimeout(() => {
        void (async () => {
          const next = await loadDelivery();
          announce(pickedUpAnnouncement(delivery.orderNumber, next?.dropoff?.firstName ?? null));
          focusScreen();
        })();
      }, DONE_HOLD_MS);
      return;
    }
    // Moved back, released or cancelled a moment before: it springs back; the notices say why.
    setState('ready');
  };

  const confirm = (confirmFar: boolean) => {
    setFar(null);
    setState('accepting');
    void send(confirmFar);
  };

  return (
    <Dock
      withTabBar
      reason={blocked ? notReadyText(delivery.orderNumber) : null}
      reasonIcon={Clock}
      reasonId={reasonId}
    >
      <SlideToConfirm
        state={blocked && state === 'ready' ? 'blocked' : state}
        name={`picked up order ${delivery.orderNumber}`}
        describedBy={blocked ? reasonId : undefined}
        acceptedLabel={DELIVERY_COPY.pickedUp}
        copy={PICKUP_SLIDE}
        onAccept={() => {
          const meters = position ? distanceMeters(position, delivery.kitchen.point) : null;
          if (meters !== null && meters > FAR_M && delivery.stage !== 'atKitchen') {
            setFar(Math.round(meters));
            return;
          }
          confirm(false);
        }}
      />
      <FarCheckDialog
        open={far !== null}
        step="pickUp"
        orderNumber={delivery.orderNumber}
        meters={far ?? 0}
        onCancel={() => setFar(null)}
        onConfirm={() => confirm(true)}
      />
    </Dock>
  );
}
