'use client';

import {
  Ban,
  Bike,
  Clock,
  LocateOff,
  type LucideIcon,
  MapPinCheck,
  MapPinOff,
  Navigation,
  PowerOff,
  SatelliteDish,
  SignalLow,
  Smartphone,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { HelpCard } from '@/lib/partner/sharing';
import { type LocationLineState, locationLine } from '@/lib/partner/text';
import { cn } from '@/lib/utils';
import { IconDisc } from '../shell';

/*
 * The pieces of the partner home (F6 design 6): the kitchen chip, the location explainer shown
 * before the browser's prompt, the help cards for a blocked, approximate or missing location,
 * the location line, and the suspension cover.
 */

// ------------------------------------------------------------------ kitchen chip (6.1)

export function KitchenChip({ open, line }: { open: boolean; line: string }) {
  return (
    <p
      className={cn(
        'inline-flex min-h-9 items-start gap-1.5 rounded-lg px-3 py-2 text-left text-body-5 font-medium text-strong',
        open ? 'bg-success-soft' : 'bg-muted',
      )}
    >
      <Store
        className={cn(
          'mt-0.5 size-4 shrink-0',
          open ? 'text-success-mark' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      {line}
    </p>
  );
}

// ------------------------------------------------------------------ explainer (6.2)

export function LocationExplainer({
  open,
  onContinue,
  onDismiss,
  returnFocus,
}: {
  open: boolean;
  onContinue: () => void;
  onDismiss: () => void;
  returnFocus: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const continued = useRef(false);
  const items: { icon: LucideIcon; text: string }[] = [
    {
      icon: Bike,
      text: 'We use it to send you orders near you and, during a delivery, to show the customer where their food is.',
    },
    {
      icon: PowerOff,
      text: "We stop the moment you go offline. We never track you while you're offline.",
    },
    {
      icon: Smartphone,
      text: "Keep Foodz open on screen while you're online. If you switch apps or lock your phone, we can't see where you are.",
    },
  ];
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !continued.current) onDismiss();
      }}
    >
      <SheetContent
        className="inset-x-0 bottom-0 mx-auto max-w-md rounded-t-2xl bg-card px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          continued.current = false;
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!continued.current) returnFocus();
        }}
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-xl bg-success-soft"
        >
          <Navigation className="size-6 text-success-mark" />
        </span>
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="mt-4 font-heading text-title-1 text-strong outline-none"
        >
          Share your location while you&apos;re online
        </SheetTitle>
        <SheetDescription className="sr-only">
          Why Foodz asks for your location before you go online.
        </SheetDescription>
        <ul className="mt-4 space-y-3 text-body-4 text-foreground">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.text} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                {item.text}
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          size="dock"
          className="mt-6"
          onClick={() => {
            continued.current = true;
            onContinue();
          }}
        >
          Continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="kitchen"
          className="mt-2 w-full text-strong"
          onClick={onDismiss}
        >
          Not now
        </Button>
      </SheetContent>
    </Sheet>
  );
}

// ------------------------------------------------------------------ help cards (6.2)

type Phone = 'iphone' | 'android' | 'unknown';

function phoneKind(): Phone {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  return 'unknown';
}

const IPHONE_ALLOW =
  'Settings › Privacy & Security › Location Services › Safari Websites: choose While Using the App, and turn on Precise Location';
const ANDROID_ALLOW = 'Tap the icon left of the address, then Permissions › Location › Allow';
const OTHER_ALLOW = "Open your browser's settings for this site and allow Location.";
const IPHONE_PRECISE =
  'Settings › Privacy & Security › Location Services › Safari Websites: turn on Precise Location';

const CARDS: Record<HelpCard, { icon: LucideIcon; tone: string; title: string; body: string }> = {
  blocked: {
    icon: MapPinOff,
    tone: 'text-danger-mark',
    title: 'Location is blocked for Foodz',
    body: "You can't go online without sharing your location while you're online.",
  },
  turnedOff: {
    icon: MapPinOff,
    tone: 'text-danger-mark',
    title: "Location was turned off for Foodz, so you're offline.",
    body: "You can't go online without sharing your location while you're online.",
  },
  approximate: {
    icon: LocateOff,
    tone: 'text-warning-mark',
    title: 'Your phone is sharing an approximate location',
    body: 'Turn on Precise Location for your browser, then try again.',
  },
  notFound: {
    icon: SatelliteDish,
    tone: 'text-warning-mark',
    title: "We can't find your location",
    body: 'Go outside or near a window, check that Location is on, and try again.',
  },
};

function Steps({ card, phone }: { card: HelpCard; phone: Phone }) {
  if (card === 'notFound') return null;
  if (card === 'approximate') {
    if (phone === 'android') return null;
    return (
      <ol className="mt-3 space-y-1 rounded-xl bg-muted p-3 text-body-5 text-strong">
        <li>{IPHONE_PRECISE}</li>
      </ol>
    );
  }
  if (phone === 'iphone' || phone === 'android') {
    return (
      <ol className="mt-3 space-y-1 rounded-xl bg-muted p-3 text-body-5 text-strong">
        <li>{phone === 'iphone' ? IPHONE_ALLOW : ANDROID_ALLOW}</li>
      </ol>
    );
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-muted p-3 text-body-5 text-strong">
      <div>
        <p className="font-medium">On iPhone</p>
        <p>{IPHONE_ALLOW}</p>
      </div>
      <div>
        <p className="font-medium">On Android</p>
        <p>{ANDROID_ALLOW}</p>
      </div>
      <p>{OTHER_ALLOW}</p>
    </div>
  );
}

export function LocationHelpCard({ card, onRetry }: { card: HelpCard; onRetry: () => void }) {
  const id = useId();
  const content = CARDS[card];
  const Icon = content.icon;
  return (
    <section
      aria-labelledby={id}
      className="rounded-2xl border border-border bg-card p-4 text-left"
    >
      <div className="flex gap-3">
        <Icon className={cn('mt-0.5 size-6 shrink-0', content.tone)} aria-hidden />
        <h3 id={id} className="text-body-3 font-semibold text-strong">
          {content.title}
        </h3>
      </div>
      <p className="mt-2 text-body-4 text-foreground">{content.body}</p>
      <Steps card={card} phone={phoneKind()} />
      <Button type="button" variant="outline" size="kitchen" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </section>
  );
}

// ------------------------------------------------------------------ the location line (6.3)

const LINE_ICONS: Record<LocationLineState['kind'], { icon: LucideIcon; tone: string }> = {
  shared: { icon: MapPinCheck, tone: 'text-success-mark' },
  weak: { icon: SignalLow, tone: 'text-warning-mark' },
  looking: { icon: SatelliteDish, tone: 'text-muted-foreground' },
  stale: { icon: MapPinOff, tone: 'text-danger-mark' },
  queued: { icon: Clock, tone: 'text-muted-foreground' },
  demo: { icon: MapPinCheck, tone: 'text-success-mark' },
};

export function LocationLine({ state }: { state: LocationLineState }) {
  const { line, sub } = locationLine(state);
  const { icon: Icon, tone } = LINE_ICONS[state.kind];
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <Icon className={cn('size-5 shrink-0', tone)} aria-hidden />
      <div className="min-w-0">
        <p className="text-body-4 font-medium text-strong">{line}</p>
        {sub ? <p className="text-body-5 text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ suspension cover (5.9)

export function SuspensionCover({ how }: { how: 'event' | 'signedOut' }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The one time the app moves focus by itself: everything behind it is gone.
    titleRef.current?.focus();
  }, []);
  const event = how === 'event';
  return (
    <section
      aria-labelledby="suspension-title"
      className="fixed inset-y-0 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col bg-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div className="flex-1 px-4 pt-16 text-center">
        <IconDisc icon={Ban} tone="error" />
        <h2
          id="suspension-title"
          ref={titleRef}
          tabIndex={-1}
          className="mt-6 font-heading text-h4 text-strong outline-none"
        >
          {event ? 'Your partner account has been suspended' : "You've been signed out"}
        </h2>
        <p className="mt-3 text-body-4 text-muted-foreground">
          {event ? "You've been signed out." : 'Sign in again to use the partner app.'}
        </p>
      </div>
      <div className="border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button asChild size="dock">
          <Link href={{ pathname: '/sign-in', query: { callbackUrl: '/partner' } }}>
            {event ? 'Sign in to see the details' : 'Sign in'}
          </Link>
        </Button>
      </div>
    </section>
  );
}
