'use client';

import {
  Banknote,
  CreditCard,
  Info,
  type LucideIcon,
  MapPin,
  MapPinCheck,
  Navigation,
  Phone,
  ShoppingBag,
  Store,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useSyncExternalStore } from 'react';
import type { PartnerDelivery } from '@/server/modules/delivery/schema';
import { Button } from '@/components/ui/button';
import {
  deliverPaymentWords,
  deliverTitle,
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
import { IconDisc } from '../shell';
import { LocationHelpCard } from '../home/home-parts';

/*
 * After he says yes (F7 design 1.12, 1.13): one screen that says where to go and what he's
 * carrying, with "Open in Maps" in the dock. Before pickup it never shows the customer's name,
 * street, instructions or phone (P29.3); after ADMIN marks it picked up "by the assigned
 * courier", the interim screen (until F8) shows the first name, address and instructions as
 * plain text.
 */

const subscribeNothing = () => () => {};
const applePhone = () => isApplePhone(navigator.userAgent, navigator.maxTouchPoints ?? 0);

/** Apple Maps on iPhone and iPad, Google Maps elsewhere; decided in the browser (D14). */
export function useMapsHref(point: { lat: number; lng: number }, bicycle: boolean): string {
  const apple = useSyncExternalStore(subscribeNothing, applePhone, () => false);
  return mapsHref(point, { apple, bicycle });
}

/**
 * The dock's "Open in Maps": a link that looks like the dock button (P29.2). Its name starts
 * with the visible words, so speech input finds it (WCAG 2.5.3): "Open in Maps for directions to
 * Foodz Kitchen".
 */
export function OpenInMapsLink({ href, destination }: { href: string; destination: string }) {
  return (
    <Button asChild size="dock">
      <a href={href} target="_blank" rel="noopener">
        <Navigation className="size-5" aria-hidden />
        Open in Maps
        <span className="sr-only"> for directions to {destination}</span>
      </a>
    </Button>
  );
}

export function CallKitchenLink({ phone }: { phone: string }) {
  const display = phoneDisplay(phone);
  return (
    <Button asChild variant="outline" size="kitchen" className="w-full bg-card text-strong">
      <a href={telHref(phone)} aria-label={`Call Foodz Kitchen, ${display}`}>
        <Phone className="size-5" aria-hidden />
        Call Foodz Kitchen
      </a>
    </Button>
  );
}

function Fact({
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

function PaymentFact({ payment, words }: { payment: PartnerDelivery['payment']; words: string }) {
  const cash = payment.kind === 'cash';
  return (
    <Fact icon={cash ? Banknote : CreditCard} label="Payment" cash={cash}>
      {words}
    </Fact>
  );
}

const LINK_BUTTON =
  'inline-flex h-12 items-center justify-center px-2 text-button-2 font-medium text-muted-foreground underline underline-offset-4';

export function PickUpScreen({
  delivery,
  distance,
  locationOff,
  notices,
  onGiveBack,
  onGoOffline,
  onRetryLocation,
}: {
  delivery: PartnerDelivery;
  /** From his own latest fix to the kitchen point (design 1.12); null before a fix. */
  distance: { atKitchen: boolean; km: number } | null;
  /** Location turned off while he holds it (P29.5). */
  locationOff: boolean;
  /** The notice slot: the kitchen moved it back, and the like (P31). */
  notices?: ReactNode;
  onGiveBack: () => void;
  onGoOffline: () => void;
  onRetryLocation: () => void;
}) {
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
      <section aria-label="Pickup" className="rounded-2xl border border-border bg-card p-4">
        <div className="flex gap-3">
          <span className="shrink-0">
            <IconDisc icon={Store} tone="success" size="md" />
          </span>
          <div className="min-w-0">
            <p className="text-body-3 font-semibold text-strong [overflow-wrap:anywhere]">
              {kitchenLine(delivery.kitchen.addressText)}
            </p>
            {distance?.atKitchen ? (
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
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4">
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

export function DeliverScreen({
  delivery,
  notices,
}: {
  delivery: PartnerDelivery;
  notices?: ReactNode;
}) {
  const dropoff = delivery.dropoff;
  return (
    <div className="space-y-5">
      <h1
        data-pickup-h1=""
        data-partner-h1=""
        tabIndex={-1}
        className="font-heading text-h4 text-strong outline-none"
      >
        {deliverTitle(delivery.orderNumber)}
      </h1>
      {notices}
      {dropoff ? (
        <section aria-label="Drop-off" className="rounded-2xl border border-border bg-card p-4">
          <p className="text-body-5 text-muted-foreground">Drop-off</p>
          <p className="text-body-3 font-semibold text-strong [overflow-wrap:anywhere]">
            {dropoff.firstName}
          </p>
          <p className="text-body-4 text-foreground [overflow-wrap:anywhere]">
            {dropoff.addressText}
          </p>
          {dropoff.instructions ? (
            <p className="mt-2 text-body-4 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
              <span className="sr-only">Instructions: </span>
              {dropoff.instructions}
            </p>
          ) : null}
        </section>
      ) : null}
      <dl className="rounded-2xl border border-border bg-card">
        <PaymentFact payment={delivery.payment} words={deliverPaymentWords(delivery.payment)} />
      </dl>
      <p className="flex gap-2 text-body-4 text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Foodz support will mark it delivered.
      </p>
      <CallKitchenLink phone={delivery.kitchen.phone} />
    </div>
  );
}

/** The dock for either screen: directions to the kitchen, or to the drop-off after pickup. */
export function DeliveryDock({
  delivery,
  bicycle,
}: {
  delivery: PartnerDelivery;
  bicycle: boolean;
}) {
  const afterPickup = delivery.status === 'PICKED_UP' && delivery.dropoff;
  const point = afterPickup && delivery.dropoff ? delivery.dropoff.point : delivery.kitchen.point;
  const href = useMapsHref(point, bicycle);
  return (
    <OpenInMapsLink href={href} destination={afterPickup ? 'the drop-off' : 'Foodz Kitchen'} />
  );
}
