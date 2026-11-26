'use client';

import { CircleCheck, Hourglass, MapPinOff, TriangleAlert, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useId } from 'react';
import type { StaffTrackingDetail } from '@/server/modules/tracking/schema';
import { MapFrame, type MapHandle } from '@/components/map/map-frame';
import {
  CourierDisc,
  LabelChip,
  mountMarker,
  PinWithLabel,
  TeardropPin,
} from '@/components/map/markers';
import { RouteLine } from '@/components/map/route-line';
import { Button } from '@/components/ui/button';
import { useSlowPending } from '@/components/forms/submit-button';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/announce';
import { MAP_PALETTES } from '@/lib/map/colors';
import { boundsOf, routeFrom } from '@/lib/map/maplibre';
import { boardClock } from '@/lib/board/text';
import { STUCK_LABELS, type StuckAction, stepsOf } from '@/lib/board/tracking-text';
import { ageSeconds, isStale, staffUpdatedWords, freshnessFor } from '@/lib/tracking/freshness';
import { House, Truck } from 'lucide-react';

/*
 * The detail's tracking (F8 design 3.12, A53): a small map that takes no touch, with the
 * courier, the drop-off pin and the route, fitted to both; the estimate and the point's age; the
 * steps with their times; and, when a delivery is stuck, Confirm hand-over, Ask to wait and
 * Cancel and bring it back. The map never blocks the section: it fails into "Map unavailable".
 */

const LIGHT = MAP_PALETTES.light;

function DetailLayers({
  handle,
  point,
  stale,
  dropoff,
  orderNumber,
  route,
}: {
  handle: MapHandle;
  point: { lat: number; lng: number } | null;
  stale: boolean;
  dropoff: { lat: number; lng: number };
  orderNumber: string;
  route: StaffTrackingDetail['route'];
}) {
  const { map } = handle;
  useEffect(() => {
    const pin = mountMarker(
      handle,
      dropoff,
      <PinWithLabel
        pin={
          <TeardropPin
            fill={LIGHT.door}
            stroke={LIGHT.doorStroke}
            glyph={House}
            glyphColor={LIGHT.doorGlyph}
            width={24}
          />
        }
        label={<LabelChip text={orderNumber} palette={LIGHT} />}
      />,
      { anchor: 'bottom' },
    );
    const courier = point
      ? mountMarker(
          handle,
          point,
          <CourierDisc fill={stale ? LIGHT.stale : '#141416'} icon={Truck} size={32} />,
        )
      : null;
    const bounds = boundsOf(point ? [point, dropoff] : [dropoff]);
    if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 16, duration: 0 });
    return () => {
      pin.remove();
      courier?.remove();
    };
  }, [handle, map, point, stale, dropoff, orderNumber]);
  return (
    <RouteLine
      handle={handle}
      coordinates={routeFrom(route?.geojson?.coordinates ?? null, point, dropoff)}
      palette={LIGHT}
      stale={stale}
    />
  );
}

/** A50 on the detail: what a stuck delivery offers, from its steps (U5, U6). */
export function stuckFromSteps(
  steps: StaffTrackingDetail['steps'],
  serverNowMs: number,
  waitSeconds = 300,
): StuckAction[] {
  if (steps.deliveredAt) return [];
  if (steps.codeLockedAt) return ['confirmHandover', 'askToWait', 'cancelUnreachable'];
  if (steps.noAnswerSince && serverNowMs - Date.parse(steps.noAnswerSince) >= waitSeconds * 1000) {
    return ['confirmHandover', 'askToWait', 'cancelUnreachable'];
  }
  if (steps.problem && steps.problem !== 'no-answer') return ['cancelUnreachable'];
  return [];
}

const STUCK_ICONS = {
  confirmHandover: CircleCheck,
  askToWait: Hourglass,
  cancelUnreachable: Undo2,
} as const;

export function TrackingDetail({
  tracking,
  orderNumber,
  courierName,
  courierId,
  courierFirst,
  timeZone,
  serverNowMs,
  level,
  stuck,
  readOnly,
  offline,
  asking,
  onStuck,
}: {
  tracking: StaffTrackingDetail;
  orderNumber: string;
  courierName: string | null;
  courierId: string | null;
  courierFirst: string;
  timeZone: string;
  serverNowMs: number;
  level: 'h3' | 'h4';
  stuck: readonly StuckAction[];
  readOnly: boolean;
  offline: boolean;
  asking: boolean;
  onStuck: (item: StuckAction) => void;
}) {
  const captionId = useId();
  const Heading = level;
  const seconds = ageSeconds(tracking.point?.at ?? null, serverNowMs);
  const stale = seconds !== null && isStale(freshnessFor(seconds));
  const updated = staffUpdatedWords(seconds);
  const steps = stepsOf(tracking.steps, (iso) => boardClock(iso, timeZone));
  const minutes = tracking.etaAt
    ? Math.max(0, Math.ceil((Date.parse(tracking.etaAt) - serverNowMs) / 60_000))
    : null;
  const arriving = tracking.etaAt
    ? `${boardClock(tracking.etaAt, timeZone)}${minutes ? ` · in ${minutes} min` : ''}${tracking.estimated ? ' (estimated)' : ''}`
    : null;
  const mapHref: Route = courierId
    ? (`/admin/map?courier=${encodeURIComponent(courierId)}` as Route)
    : '/admin/map';
  const active = tracking.steps.pickedUpAt !== null && tracking.steps.deliveredAt === null;
  const blocked = readOnly || offline;
  const caption = readOnly ? 'Read-only in the demo' : offline ? "You're offline." : null;
  const slow = useSlowPending(asking);

  return (
    <div data-tracking-detail="">
      {tracking.dropoffPoint && active ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-neutral-6">
          <MapFrame
            boxClassName="h-48 bg-neutral-7"
            options={{
              theme: 'light',
              center: tracking.point ?? tracking.dropoffPoint,
              zoom: 14,
              gestures: 'none',
            }}
            failure={
              <>
                <MapPinOff className="size-6 text-neutral-3" aria-hidden />
                <p className="text-body-5 text-neutral-1">Map unavailable right now.</p>
              </>
            }
          >
            {(handle) => (
              <DetailLayers
                handle={handle}
                point={tracking.point}
                stale={stale}
                dropoff={tracking.dropoffPoint ?? { lat: 0, lng: 0 }}
                orderNumber={orderNumber}
                route={tracking.route}
              />
            )}
          </MapFrame>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-neutral-6 px-3 py-1.5 text-caption text-neutral-3">
            <span>Map © OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</span>
            <Link
              href={mapHref}
              aria-label={courierName ? `Open on the live map, ${courierName}` : undefined}
              className="inline-flex min-h-11 items-center text-body-5 text-neutral-1 underline underline-offset-4"
            >
              Open on the live map
            </Link>
          </div>
        </div>
      ) : null}
      {active ? (
        <dl className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-4">
          {arriving ? (
            <>
              <dt className="text-neutral-3">Arriving</dt>
              <dd className="text-neutral-1 tabular-nums">
                {arriving}
                {tracking.late ? (
                  <span className="mt-1 flex items-center gap-1.5 text-body-5 font-medium text-destructive">
                    <TriangleAlert className="size-4" aria-hidden />
                    More than 10 minutes past the promised time
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          <dt className="text-neutral-3">Location</dt>
          <dd className="text-neutral-1">
            <span aria-hidden>{updated.text}</span>
            <span className="sr-only">{updated.spoken}</span>
          </dd>
        </dl>
      ) : null}
      {steps.length > 0 ? (
        <>
          <Heading className="mt-3 text-body-5 font-medium text-neutral-2">Steps</Heading>
          <ol className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-body-5 text-neutral-1 tabular-nums">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                {step}
                {index < steps.length - 1 ? <span aria-hidden>·</span> : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {stuck.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            {stuck.map((item) => {
              const Icon = STUCK_ICONS[item];
              const busy = item === 'askToWait' && asking;
              return (
                <Button
                  key={item}
                  type="button"
                  size="kitchen"
                  variant="outline"
                  aria-disabled={blocked || busy ? true : undefined}
                  aria-describedby={blocked ? captionId : undefined}
                  className={
                    item === 'cancelUnreachable'
                      ? 'border-destructive bg-white text-destructive hover:bg-tag-4-bg hover:text-destructive'
                      : 'bg-white'
                  }
                  onClick={() => {
                    if (busy) return;
                    if (blocked) {
                      announce(caption ?? '');
                      return;
                    }
                    onStuck(item);
                  }}
                >
                  {busy && slow ? <Spinner aria-hidden /> : <Icon className="size-5" aria-hidden />}
                  {busy && slow ? 'Asking…' : STUCK_LABELS[item](courierFirst)}
                </Button>
              );
            })}
          </div>
          {caption ? (
            <p id={captionId} className="text-caption text-neutral-3">
              {caption}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
