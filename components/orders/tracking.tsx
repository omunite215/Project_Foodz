'use client';

import {
  BellRing,
  Bike,
  Car,
  Check,
  Clock,
  LocateFixed,
  type LucideIcon,
  MapPin,
  MapPinOff,
  Motorbike,
  Navigation,
  Scooter,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';
import type { OrderStep } from '@/server/modules/orders/progress-schema';
import type { CourierPoint, CustomerTracking } from '@/server/modules/tracking/schema';
import {
  MapAttribution,
  MapFrame,
  type MapHandle,
  type MapState,
} from '@/components/map/map-frame';
import {
  CourierDisc,
  DoorPin,
  LabelChip,
  mountMarker,
  PinWithLabel,
} from '@/components/map/markers';
import { RouteLine } from '@/components/map/route-line';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { MAP_PALETTES } from '@/lib/map/colors';
import { createGlider, type Glider } from '@/lib/map/glide';
import { boundsOf, inView, routeFrom } from '@/lib/map/maplibre';
import { distanceMeters } from '@/lib/map-geometry';
import { prefersReducedMotion, useMotion } from '@/lib/motion';
import { stepSpoken, stepWord } from '@/lib/order-progress';
import {
  atDoorText,
  codeHelpText,
  codeShown,
  codeSpoken,
  distanceSentence,
  grewALot,
  LATER_NOTE,
  mapFailedText,
  pausedWords,
  trackingArrival,
} from '@/lib/order-tracking';
import { ageSeconds, freshnessFor, isStale, updatedWords } from '@/lib/tracking/freshness';
import { useCourierPoint, useServerNow } from '@/lib/tracking/live-point';
import { cn } from '@/lib/utils';
import { WithPhone } from './with-phone';

/*
 * The customer's live delivery (F8 design 1): the map card, the arrival row from pickup, the
 * code card, the at-the-door banner and the compact progress row. The map is a picture with a
 * text twin; the arrival row and the code never wait for it, and nothing here is a live region
 * except the lines named in the design, announced once.
 */

const LIGHT = MAP_PALETTES.light;
const REFIT_EVERY_MS = 60_000;
const TOUCH_QUIET_MS = 60_000;

const VEHICLE_ICONS: Record<string, LucideIcon> = { Bicycle: Bike, Motorbike, Car, Scooter };
export const vehicleIcon = (vehicleWords: string | null | undefined): LucideIcon =>
  VEHICLE_ICONS[vehicleWords?.split(' ')[0] ?? 'Scooter'] ?? Scooter;

// ------------------------------------------------------------------ the map card (1.3, 1.7)

function FreshnessLine({
  point,
  now,
  timeZone,
}: {
  point: CourierPoint | null;
  now: number;
  timeZone: string;
}) {
  const seconds = ageSeconds(point?.at ?? null, now);
  if (seconds === null || !point) {
    return <p className="text-body-5 text-neutral-3">Waiting for the first location</p>;
  }
  if (isStale(freshnessFor(seconds))) {
    return (
      <p className="flex items-center gap-1.5 text-body-5 text-neutral-1">
        <MapPinOff className="size-4 shrink-0 text-neutral-3" aria-hidden />
        {pausedWords(point.at, timeZone)}
      </p>
    );
  }
  const words = updatedWords(seconds);
  if (words.text === 'Live') {
    return (
      <p className="flex items-center gap-1.5 text-body-5 text-neutral-3">
        <span aria-hidden className="size-2 rounded-full bg-brand-strong" />
        Live
      </p>
    );
  }
  return (
    <p className="text-body-5 text-neutral-1">
      <span aria-hidden>{words.text}</span>
      <span className="sr-only">{words.spoken}</span>
    </p>
  );
}

/** Draws his marker, her door and the route; moves the camera by the design's rules. */
function TrackingLayers({
  handle,
  point,
  stale,
  dropoff,
  route,
  vehicleWords,
  follow,
  recenter,
  onUserMove,
}: {
  handle: MapHandle;
  point: CourierPoint | null;
  stale: boolean;
  dropoff: { lat: number; lng: number };
  route: CustomerTracking['route'];
  vehicleWords: string | null;
  follow: boolean;
  recenter: number;
  onUserMove: () => void;
}) {
  const { map } = handle;
  const courier = useRef<{ mounted: ReturnType<typeof mountMarker>; glider: Glider } | null>(null);
  const lastTouch = useRef(0);
  const lastRefit = useRef(0);
  const latest = useRef({ point, dropoff, follow, onUserMove });
  useEffect(() => {
    latest.current = { point, dropoff, follow, onUserMove };
  });
  const Icon = vehicleIcon(vehicleWords);

  const fitBoth = (animate: boolean) => {
    const { point: at, dropoff: door } = latest.current;
    const bounds = boundsOf(at ? [at, door] : [door]);
    if (!bounds) return;
    const wide = window.matchMedia('(min-width: 48rem)').matches;
    map.fitBounds(bounds, {
      padding: wide ? 56 : 40,
      maxZoom: 17,
      duration: animate && !prefersReducedMotion() ? 600 : 0,
    });
    lastRefit.current = Date.now();
  };

  // Her door and the first view, once.
  useEffect(() => {
    const door = mountMarker(
      handle,
      dropoff,
      <PinWithLabel
        pin={<DoorPin palette={LIGHT} />}
        label={<LabelChip text="You" palette={LIGHT} />}
      />,
      { anchor: 'bottom', offset: [0, 0] },
    );
    fitBoth(false);
    // A pan or zoom by her (not by the camera's own moves) turns Follow off.
    const touched = (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      lastTouch.current = Date.now();
      latest.current.onUserMove();
    };
    map.on('dragstart', touched);
    map.on('zoomstart', touched);
    return () => {
      map.off('dragstart', touched);
      map.off('zoomstart', touched);
      door.remove();
    };
    // Once per map.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [map]);

  // His marker: glides to each new point; gray when stale; no notch without a heading.
  useEffect(() => {
    if (!point) return;
    const node = (
      <CourierDisc
        fill={stale ? LIGHT.stale : LIGHT.courier}
        icon={Icon}
        heading={stale ? null : point.heading}
      />
    );
    if (!courier.current) {
      const mounted = mountMarker(handle, point, node);
      courier.current = { mounted, glider: createGlider(mounted.marker, point) };
    } else {
      courier.current.mounted.render(node);
      courier.current.glider.to(point, { reduced: prefersReducedMotion() });
    }
    const reduced = prefersReducedMotion();
    if (latest.current.follow) {
      const target = { center: [point.lng, point.lat] as [number, number], zoom: 16 };
      if (reduced) map.jumpTo(target);
      else map.easeTo({ ...target, duration: 600 });
    } else if (
      !inView(map, point) &&
      Date.now() - lastTouch.current > TOUCH_QUIET_MS &&
      Date.now() - lastRefit.current > REFIT_EVERY_MS
    ) {
      fitBoth(true);
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [point?.at, stale]);

  useEffect(
    () => () => {
      courier.current?.glider.kill();
      courier.current?.mounted.remove();
      courier.current = null;
    },
    [],
  );

  // Follow on: center on him now.
  useEffect(() => {
    const at = latest.current.point;
    if (!follow || !at) return;
    const target = { center: [at.lng, at.lat] as [number, number], zoom: 16 };
    if (prefersReducedMotion()) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 600 });
  }, [follow, map]);

  useEffect(() => {
    if (recenter > 0) fitBoth(true);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [recenter]);

  const coordinates = route?.geojson?.coordinates ?? null;
  return (
    <RouteLine
      handle={handle}
      coordinates={routeFrom(coordinates, point, dropoff)}
      palette={LIGHT}
      stale={stale}
    />
  );
}

export function TrackingMapCard({
  orderId,
  tracking,
  courierFirst,
  vehicleWords,
  asOf,
  timeZone,
  className,
  boxClassName = 'h-60 md:h-72',
  headingId,
  nowLineRef,
  active = true,
}: {
  orderId: string;
  tracking: CustomerTracking;
  courierFirst: string;
  vehicleWords: string | null;
  asOf: string;
  timeZone: string;
  className?: string;
  boxClassName?: string;
  headingId: string;
  /** The status card's "Now" line: focus goes there if a focused map button disappears. */
  nowLineRef?: React.RefObject<HTMLElement | null>;
  /**
   * The card is drawn in the status card below 1024 px and beside it from there; only the
   * visible one loads a map (the other keeps its box).
   */
  active?: boolean;
}) {
  const point = useCourierPoint(orderId, tracking.courierPoint);
  const now = useServerNow(asOf, 5_000);
  const [follow, setFollow] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [mapState, setMapState] = useState<MapState>('loading');
  const seconds = ageSeconds(point?.at ?? null, now);
  const stale = seconds !== null && isStale(freshnessFor(seconds));
  const controlsRef = useRef<HTMLDivElement>(null);

  // A map that fails takes its buttons away; focus must not drop to the page (design 1.8).
  useEffect(() => {
    if (mapState !== 'failed') return;
    if (controlsRef.current?.contains(document.activeElement)) nowLineRef?.current?.focus();
  }, [mapState, nowLineRef]);

  // The text twin, refreshed at most once a minute (S1.5).
  const meters = point
    ? Math.round(distanceMeters(point, tracking.dropoffPoint))
    : (tracking.route?.distanceM ?? null);
  const [twin, setTwin] = useState(() => distanceSentence(courierFirst, meters));
  const twinAt = useRef(0);
  useEffect(() => {
    const next = distanceSentence(courierFirst, meters);
    if (next === twin || Date.now() - twinAt.current < 60_000) return undefined;
    const timer = setTimeout(() => {
      twinAt.current = Date.now();
      setTwin(next);
    }, 0);
    return () => clearTimeout(timer);
  }, [courierFirst, meters, twin]);

  return (
    <section
      aria-labelledby={headingId}
      data-tracking-map=""
      className={cn('overflow-hidden rounded-xl border border-neutral-6 bg-white', className)}
    >
      <h2 id={headingId} className="sr-only">
        Where {courierFirst} is
      </h2>
      <p className="sr-only">{twin}</p>
      {active ? (
        <MapFrame
          boxClassName={cn('bg-neutral-7', boxClassName)}
          options={{
            theme: 'light',
            center: point ?? tracking.dropoffPoint,
            zoom: 15,
            gestures: 'cooperative',
            maxZoom: 18,
          }}
          onState={setMapState}
          failure={
            <>
              <MapPinOff className="size-6 text-neutral-3" aria-hidden />
              <p className="text-body-4 text-neutral-1">{mapFailedText(courierFirst)}</p>
            </>
          }
        >
          {(handle) => (
            <TrackingLayers
              handle={handle}
              point={point}
              stale={stale}
              dropoff={tracking.dropoffPoint}
              route={tracking.route}
              vehicleWords={vehicleWords}
              follow={follow}
              recenter={recenter}
              onUserMove={() => setFollow(false)}
            />
          )}
        </MapFrame>
      ) : (
        <div aria-hidden className={cn('bg-neutral-7', boxClassName)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-neutral-6 px-3 py-2">
        <FreshnessLine point={point} now={now} timeZone={timeZone} />
        {mapState === 'failed' || !active ? null : (
          <div ref={controlsRef} className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="touch"
              aria-pressed={follow}
              onClick={() => setFollow((value) => !value)}
              className={cn(
                'h-11 bg-white px-3 text-button-2',
                follow && 'border-brand-strong bg-brand-soft hover:bg-brand-soft',
              )}
            >
              <Navigation className={cn('size-4', follow && 'text-brand-strong')} aria-hidden />
              Follow {courierFirst}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="touch"
              aria-label={`Recenter the map on ${courierFirst} and your door`}
              onClick={() => {
                setFollow(false);
                setRecenter((value) => value + 1);
              }}
              className="h-11 bg-white px-3 text-button-2"
            >
              <LocateFixed className="size-4" aria-hidden />
              Recenter
            </Button>
          </div>
        )}
      </div>
      <MapAttribution className="border-t border-neutral-6 px-3 py-1.5 text-neutral-3" />
    </section>
  );
}

// ------------------------------------------------------------------ the arrival row (1.4)

export function TrackingArrivalRow({
  orderId,
  tracking,
  courierFirst,
  asOf,
  timeZone,
  phone,
  fallback = null,
}: {
  orderId: string;
  tracking: CustomerTracking;
  courierFirst: string;
  asOf: string;
  timeZone: string;
  phone: string;
  /** Before the first estimate is ready, F5's window stands (it never says "unknown", S2.4). */
  fallback?: ReactNode;
}) {
  const point = useCourierPoint(orderId, tracking.courierPoint);
  const now = useServerNow(asOf, 15_000);
  const freshness = freshnessFor(ageSeconds(point?.at ?? null, now));
  const row = trackingArrival({
    tracking,
    courierFirst,
    // No point yet isn't "can't see": the estimate stands until the first one arrives.
    freshness: point ? freshness : 'live',
    serverNowMs: now,
    timeZone,
  });

  // S2.3: an estimate 5 minutes later than the one shown gets the note, said once.
  const etaAt = tracking.route?.etaAt ?? null;
  const shownEta = useRef(etaAt);
  const [later, setLater] = useState(false);
  useEffect(() => {
    const before = shownEta.current;
    shownEta.current = etaAt;
    if (!etaAt || before === etaAt) return undefined;
    const grew = grewALot(before, etaAt);
    const timer = setTimeout(() => setLater(grew), 0);
    if (grew) announce(LATER_NOTE);
    return () => clearTimeout(timer);
  }, [etaAt]);

  // The 2-minute sentence and "almost there" are read once when they appear (design 1.7).
  const kind = row?.kind ?? null;
  const saidKind = useRef(kind);
  useEffect(() => {
    const before = saidKind.current;
    saidKind.current = kind;
    if (!row || before === kind) return;
    if (kind === 'cantSee' || kind === 'almost') announce(row.spoken);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [kind]);

  if (!row) return fallback;
  const note = row.note ?? (later && row.kind === 'eta' ? LATER_NOTE : null);
  const look =
    row.kind === 'overdue'
      ? { disc: 'bg-tag-6-bg', icon: TriangleAlert, mark: 'text-warning-strong' }
      : row.kind === 'cantSee'
        ? { disc: 'bg-neutral-7', icon: MapPinOff, mark: 'text-neutral-3' }
        : row.kind === 'almost'
          ? { disc: 'bg-brand-soft', icon: MapPin, mark: 'text-brand-strong' }
          : { disc: 'bg-brand-soft', icon: Clock, mark: 'text-brand-strong' };
  const Icon = look.icon;
  return (
    <div data-arrival={row.kind} className="mt-4 border-t border-neutral-6 pt-4 md:mt-5 md:pt-5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full',
            look.disc,
          )}
        >
          <Icon className={cn('size-6', look.mark)} />
        </span>
        {row.kind === 'cantSee' ? (
          <p className="text-body-4 font-medium text-neutral-1">{row.headline}</p>
        ) : (
          <p className="text-body-3 font-semibold text-neutral-1 tabular-nums md:text-body-2">
            <span aria-hidden>{row.headline}</span>
            <span className="sr-only">{row.spoken}</span>
          </p>
        )}
      </div>
      {note ? (
        <p className="mt-3 flex gap-2 rounded-lg bg-tag-6-bg px-3 py-2 text-body-5 text-neutral-1">
          {row.kind === 'overdue' ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          ) : (
            <Clock className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          )}
          <span>
            <WithPhone text={note} phone={phone} />
          </span>
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the code card (1.5)

export function DeliveryCodeCard({
  code,
  courierFirst,
  highlighted,
  animateIn = false,
}: {
  code: string;
  courierFirst: string;
  /** "Almost there" or the at-the-door banner (S3.4). */
  highlighted: boolean;
  animateIn?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  useMotion(
    (motion) => {
      if (!animateIn || !ref.current) return;
      motion.from(ref.current, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: ref },
  );
  return (
    <section
      ref={ref}
      aria-labelledby={id}
      data-code-card={highlighted ? 'highlighted' : 'normal'}
      className={cn(
        'mt-4 rounded-xl transition-colors duration-150 motion-reduce:transition-none',
        highlighted
          ? 'border-2 border-brand-strong bg-brand-soft p-[15px]'
          : 'border border-neutral-6 bg-neutral-8 p-4',
      )}
    >
      <h2
        id={id}
        className={cn('text-body-5 font-medium', highlighted ? 'text-neutral-1' : 'text-neutral-3')}
      >
        Your delivery code
      </h2>
      <p
        aria-hidden
        className="mt-2 font-sans text-h3 font-semibold tracking-[0.25em] text-neutral-1 tabular-nums select-none"
      >
        {codeShown(code)}
      </p>
      <span className="sr-only">{codeSpoken(code)}</span>
      <p className="mt-2 text-body-5 text-neutral-2">{codeHelpText(courierFirst)}</p>
    </section>
  );
}

// ------------------------------------------------------------------ at the door (1.6)

export function AtDoorBanner({
  courierFirst,
  code,
  phone,
  live,
}: {
  courierFirst: string;
  code: string | null;
  phone: string;
  /** It appeared while the page was open: it slides in and is read once (never on load). */
  live: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const first = atDoorText(courierFirst);
  useMotion(
    (motion) => {
      if (!ref.current || !live) return;
      motion.from(ref.current, { y: -4, opacity: 0, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref },
  );
  // Said once when it appears (design 1.6).
  const said = useRef(!live);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    announce(first.replace('{phone}', phone));
  }, [first, phone]);
  return (
    <section
      ref={ref}
      aria-label="Your courier is at the door"
      data-at-door=""
      className="sticky top-0 z-20 -mx-6 mb-4 border-b border-tag-6 bg-tag-6-bg px-6 py-3 md:mx-0 md:rounded-xl md:border md:px-4"
    >
      <div className="flex gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-warning-strong" aria-hidden />
        <div className="min-w-0">
          <p className="text-body-4 font-medium text-neutral-1">
            <WithPhone text={first} phone={phone} />
          </p>
          {code ? (
            <p className="mt-1 text-body-5 text-neutral-1">
              Your code:{' '}
              <span className="font-semibold tracking-[0.2em] tabular-nums" aria-hidden>
                {codeShown(code)}
              </span>
              <span className="sr-only">{codeSpoken(code)}</span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ compact progress (1.2)

/** Moodboard §3.2's peek: "Now: On its way" and six small discs, on phones while on its way. */
export function CompactProgress({
  steps,
  now,
  timeZone,
  nowLineRef,
}: {
  steps: readonly OrderStep[];
  now: Date;
  timeZone: string;
  nowLineRef?: Ref<HTMLParagraphElement>;
}) {
  const current = steps.find((step) => step.state === 'current');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p ref={nowLineRef} tabIndex={-1} className="text-body-4 text-neutral-3 outline-none">
        Now:{' '}
        <span className="font-semibold text-neutral-1">
          {current ? stepWord(current.key, current.collected) : ''}
        </span>
      </p>
      <ol aria-label="Order progress" className="flex items-center">
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex items-center"
          >
            {index > 0 ? (
              <span
                aria-hidden
                className={cn(
                  'h-0.5 w-2.5',
                  step.state === 'upcoming' ? 'bg-neutral-6' : 'bg-brand-strong',
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                'flex size-4 items-center justify-center rounded-full',
                step.state === 'done'
                  ? 'bg-brand-strong'
                  : step.state === 'current'
                    ? 'bg-brand-soft ring-2 ring-brand-strong'
                    : 'border-2 border-neutral-4 bg-white',
              )}
            >
              {step.state === 'done' ? (
                <Check className="size-2.5 text-white" strokeWidth={3.5} />
              ) : null}
            </span>
            <span className="sr-only">{stepSpoken(step, now, timeZone)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
