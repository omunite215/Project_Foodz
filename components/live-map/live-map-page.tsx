'use client';

import { Throttler } from '@tanstack/react-pacer';
import {
  ArrowLeft,
  Bike,
  Info,
  List,
  Map as MapIcon,
  Phone,
  Play,
  RefreshCw,
  Truck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { assignableCouriersAction, sendStaffOfferAction } from '@/server/modules/delivery/actions';
import { startDemoDeliveryAction } from '@/server/modules/tracking/actions';
import type {
  OpsMapCourier,
  OpsMapDelivery,
  OpsMapSnapshot,
} from '@/server/modules/tracking/schema';
import { MAP_STATES } from '@/server/modules/tracking/schema';
import { AdminPage } from '@/components/admin/admin-page';
import { DeliveryLineView } from '@/components/board/courier-parts';
import { orderHref } from '@/components/board/order-card';
import { SoundButton, useSound } from '@/components/board/sound-controls';
import { StuckBanners, useStuckChime } from '@/components/board/stuck-banners';
import { Banner } from '@/components/admin/banners';
import { showBoardNotice } from '@/components/admin/board-notices';
import { LiveChip } from '@/components/admin/status-chips';
import { FormAlert } from '@/components/forms/form-alert';
import { SubmitButton } from '@/components/forms/submit-button';
import { CourierDisc } from '@/components/map/markers';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { serverOffset } from '@/lib/board/clock';
import { boardClock, pausedText } from '@/lib/board/text';
import {
  DEMO_COPY,
  demoBusyText,
  demoLimitText,
  demoRunningText,
  lateChip,
  offerSentAnnouncement,
  readyFor,
  sortCouriers,
  sortDeliveries,
} from '@/lib/board/tracking-text';
import { useOpsMap, useOpsMapWriter } from '@/lib/data/ops-map';
import { STALE_FILL, STATE_FILLS } from '@/lib/map/colors';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent, useRealtimeStatus } from '@/lib/realtime/client';
import { ageSeconds, freshnessFor, isStale, staffUpdatedWords } from '@/lib/tracking/freshness';
import { useHydrated } from '@/lib/use-hydrated';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { LiveMapCanvas, markerLook, type Selection, stateIcon } from './live-map-canvas';

/*
 * The live map (F8 design 3.1 to 3.7, A46): a list column and the map. From 1024 px both show,
 * with the selected courier or delivery drilling into the list column; below that, one view at
 * a time with a List / Map toggle, and the selection in a bottom sheet. The list is the way in
 * for keyboard and screen-reader users; it never re-sorts under a pointer or focus. The demo
 * admin sees only demo couriers and orders, and can run the pretend delivery.
 */

const VIEW_KEY = 'foodz.live-map-view';
const TAB_KEY = 'foodz.live-map-tab';

type View = 'list' | 'map';
type Tab = 'couriers' | 'deliveries';

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.find((item) => item === value) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked: remembered for this visit only.
  }
}

/** The server's time, refreshed every 5 s (never a live region). */
function useServerClock(asOf: string, receivedAt: number): number {
  const offset = serverOffset(asOf, receivedAt);
  const [deviceNow, setDeviceNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setDeviceNow(Date.now()), 0);
    const timer = setInterval(() => setDeviceNow(Date.now()), 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return deviceNow === null ? Date.parse(asOf) : deviceNow + offset;
}

/**
 * A55.2: while a row is hovered or focused the order holds; it re-sorts 2 s after the pointer
 * and focus leave. Rows keep updating; a new id joins at the end; focus stays on its row by key.
 */
function useHeldOrder(ids: readonly string[]) {
  const [held, setHeld] = useState(false);
  const [frozen, setFrozen] = useState<readonly string[] | null>(null);
  const latest = useRef(ids);
  useEffect(() => {
    latest.current = ids;
  });
  useEffect(() => {
    if (held) return undefined;
    const timer = setTimeout(() => setFrozen(null), 2_000);
    return () => clearTimeout(timer);
  }, [held]);
  const hold = () => {
    setHeld(true);
    setFrozen((current) => current ?? latest.current);
  };
  const order = frozen
    ? [...frozen.filter((id) => ids.includes(id)), ...ids.filter((id) => !frozen.includes(id))]
    : ids;
  const handlers = {
    onPointerEnter: hold,
    onPointerLeave: () => setHeld(false),
    onFocus: hold,
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false);
    },
  };
  return { order, handlers };
}

function MiniMarker({ courier, serverNowMs }: { courier: OpsMapCourier; serverNowMs: number }) {
  const look = markerLook(courier, serverNowMs);
  return (
    <span aria-hidden className="shrink-0">
      <CourierDisc
        fill={look.fill}
        icon={stateIcon(courier.state, courier.vehicle)}
        size={32}
        hollow={look.hollow}
      />
    </span>
  );
}

function attentionChip(
  courier: OpsMapCourier,
  serverNowMs: number,
): { text: string; className: string } | null {
  const seconds = ageSeconds(courier.at, serverNowMs);
  if (courier.state === 'noAnswer') {
    // Review P5: "No answer · 4 min".
    const waited = ageSeconds(courier.stuckSince ?? null, serverNowMs);
    const text = waited === null ? 'No answer' : `No answer · ${Math.floor(waited / 60)} min`;
    return { text, className: 'bg-tag-6-bg' };
  }
  if (courier.state === 'locked') return { text: 'Code locked', className: 'bg-tag-4-bg' };
  if (courier.state === 'problem') return { text: 'Problem', className: 'bg-tag-4-bg' };
  if (seconds !== null && isStale(freshnessFor(seconds))) {
    return { text: `No location · ${Math.floor(seconds / 60)} min`, className: 'bg-neutral-7' };
  }
  return null;
}

/**
 * Review P10 (design Names): a row's parts read as a list, "Luis Moreno, Delivering 1042,
 * arriving 7:46 pm, Scooter, 7KT 342, Updated 12 seconds ago": the dots are hidden from screen
 * readers and a comma is spoken in their place. The name stays the row's own text.
 */
function Parts({ parts }: { parts: readonly ReactNode[] }) {
  return parts.map((part, index) => (
    // oxlint-disable-next-line react/no-array-index-key
    <Fragment key={index}>
      {index > 0 ? (
        <>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
        </>
      ) : null}
      {part}
    </Fragment>
  ));
}

const COMMA = <span className="sr-only">, </span>;

const ROW =
  'relative flex min-h-16 w-full gap-3 border-b border-neutral-6 px-4 py-3 text-left hover:bg-neutral-7 focus-visible:-outline-offset-2 aria-[current=true]:bg-brand-soft aria-[current=true]:before:absolute aria-[current=true]:before:inset-y-0 aria-[current=true]:before:left-0 aria-[current=true]:before:w-[3px] aria-[current=true]:before:bg-brand-strong';

function CourierRow({
  courier,
  delivery,
  selected,
  serverNowMs,
  timeZone,
  onSelect,
}: {
  courier: OpsMapCourier;
  delivery: OpsMapDelivery | null;
  selected: boolean;
  serverNowMs: number;
  timeZone: string;
  onSelect: (button: HTMLButtonElement) => void;
}) {
  const updated = staffUpdatedWords(ageSeconds(courier.at, serverNowMs));
  const chip = attentionChip(courier, serverNowMs);
  const arriving =
    courier.state === 'delivering' && delivery?.etaAt
      ? `arriving ${boardClock(delivery.etaAt, timeZone)}`
      : null;
  return (
    <li>
      {/* The row's name is its text, in reading order (design "Names"). */}
      {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
      <button
        type="button"
        data-row={courier.partnerId}
        aria-current={selected || undefined}
        onClick={(event) => onSelect(event.currentTarget)}
        className={ROW}
      >
        <MiniMarker courier={courier} serverNowMs={serverNowMs} />
        <span className="min-w-0 flex-1">
          <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
            {courier.fullName}
          </span>
          {COMMA}
          <span className="block text-body-5 text-neutral-1">
            <Parts parts={[...courier.words.split(' · '), ...(arriving ? [arriving] : [])]} />
          </span>
          {COMMA}
          <span className="block text-body-5 text-neutral-3">
            <Parts
              parts={[
                ...courier.vehicleWords.split(' · '),
                <Fragment key="updated">
                  <span aria-hidden>{updated.text}</span>
                  <span className="sr-only">{updated.spoken}</span>
                </Fragment>,
              ]}
            />
          </span>
        </span>
        {chip ? COMMA : null}
        {chip ? (
          <span
            className={cn(
              'inline-flex h-6 shrink-0 items-center self-start rounded-md px-2 text-caption font-medium text-neutral-1',
              chip.className,
            )}
          >
            {chip.text}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function DeliveryRow({
  delivery,
  selected,
  timeZone,
  onSelect,
}: {
  delivery: OpsMapDelivery;
  selected: boolean;
  timeZone: string;
  onSelect: (button: HTMLButtonElement) => void;
}) {
  const late = (delivery.lateMinutes ?? 0) > 0;
  return (
    <li>
      {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
      <button
        type="button"
        data-row={delivery.orderId}
        aria-current={selected || undefined}
        onClick={(event) => onSelect(event.currentTarget)}
        className={ROW}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-body-4 font-semibold text-neutral-1 tabular-nums">
              Order {delivery.number}
            </span>
            {COMMA}
            <span
              className={cn(
                'inline-flex h-6 items-center rounded-md px-2 text-caption font-medium text-neutral-1',
                late ? 'bg-tag-4-bg' : 'bg-neutral-7',
              )}
            >
              {lateChip(delivery.lateMinutes)}
            </span>
          </span>
          {COMMA}
          <span className="block text-body-5 text-neutral-1">
            <Parts
              parts={[
                delivery.courierShortName,
                delivery.stateWords,
                ...(delivery.etaAt ? [`arriving ${boardClock(delivery.etaAt, timeZone)}`] : []),
              ]}
            />
          </span>
          {COMMA}
          <span className="block text-body-5 text-neutral-3">
            <Parts parts={[delivery.customerFirstName, delivery.areaWords]} />
          </span>
        </span>
      </button>
    </li>
  );
}

// ------------------------------------------------------------------ the panel (3.5)

function OfferSection({
  courier,
  ready,
  readOnly,
  serverNowMs,
  onSent,
}: {
  courier: OpsMapCourier;
  ready: OpsMapSnapshot['readyWithoutCourier'];
  readOnly: boolean;
  serverNowMs: number;
  onSent: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const send = async () => {
    if (pending || readOnly) return;
    if (!choice) {
      setError('Choose an order.');
      announce('Choose an order.');
      firstRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    setAlert(null);
    const fail = (text: string) => {
      setPending(false);
      setAlert(text);
      announce(text);
      requestAnimationFrame(() => alertRef.current?.focus());
    };
    const assignable = await callAction(() => assignableCouriersAction({ orderId: choice }));
    if (!assignable.ok) {
      fail(assignable.error.message);
      return;
    }
    const sent = await callAction(() =>
      sendStaffOfferAction({
        orderId: choice,
        partnerId: courier.partnerId,
        expectedVersion: assignable.data.deliveryVersion,
      }),
    );
    if (!sent.ok) {
      fail(sent.error.message);
      return;
    }
    setPending(false);
    setChoice('');
    announce(offerSentAnnouncement(courier.shortName));
    onSent();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <h3 id={`${id}-title`} className="text-body-3 font-semibold text-neutral-1">
        Offer an order
      </h3>
      <div ref={alertRef} tabIndex={-1} className="outline-none">
        {alert ? <FormAlert variant="error">{alert}</FormAlert> : null}
      </div>
      {ready.length === 0 ? (
        <p className="text-body-5 text-neutral-3">No ready orders are waiting for a courier.</p>
      ) : (
        <>
          <fieldset aria-describedby={error ? `${id}-error` : undefined} className="space-y-2">
            <legend className="sr-only">Ready orders with no courier</legend>
            {ready.map((order, index) => (
              <label
                key={order.orderId}
                htmlFor={`${id}-${order.orderId}`}
                className="grid min-h-14 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-xl border border-neutral-6 px-4 py-2 has-[:checked]:border-2 has-[:checked]:border-brand-strong has-[:checked]:bg-brand-soft has-[:checked]:px-[15px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
              >
                <input
                  ref={index === 0 ? firstRef : undefined}
                  id={`${id}-${order.orderId}`}
                  type="radio"
                  name={`${id}-order`}
                  value={order.orderId}
                  checked={choice === order.orderId}
                  onChange={() => {
                    setChoice(order.orderId);
                    setError(null);
                  }}
                  data-invalid={error && index === 0 ? 'true' : undefined}
                  className="row-span-2 size-5 shrink-0 accent-brand-strong outline-none"
                />
                <span className="text-body-4 font-medium text-neutral-1">Order {order.number}</span>
                <span className="col-start-2 text-body-5 text-neutral-3">
                  {readyFor(order.readyAt, serverNowMs)}
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p id={`${id}-error`} className="text-body-5 text-destructive">
              {error}
            </p>
          ) : null}
          <SubmitButton
            type="button"
            size="kitchen"
            className="w-full"
            pending={pending}
            pendingLabel="Sending offer…"
            blocked={readOnly}
            onBlockedPress={() => announce(DEMO_COPY.readOnly)}
            aria-describedby={readOnly ? `${id}-readonly` : undefined}
            onClick={() => void send()}
          >
            Send offer
          </SubmitButton>
          {readOnly ? (
            <p id={`${id}-readonly`} className="text-caption text-neutral-3">
              {DEMO_COPY.readOnly}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Panel({
  data,
  selection,
  serverNowMs,
  timeZone,
  demo,
  titleRef,
  onBack,
  onRefresh,
}: {
  data: OpsMapSnapshot;
  selection: NonNullable<Selection>;
  serverNowMs: number;
  timeZone: string;
  demo: boolean;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: (() => void) | null;
  onRefresh: () => void;
}) {
  const id = useId();
  const back = onBack ? (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex h-11 items-center gap-2 text-button-2 font-medium text-neutral-1 underline underline-offset-4"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to the list
    </button>
  ) : null;

  if (selection.kind === 'delivery') {
    const delivery = data.deliveries.find((item) => item.orderId === selection.id);
    if (!delivery) return <div className="px-4 py-4">{back}</div>;
    return (
      <section aria-labelledby={`${id}-title`} className="space-y-5 px-4 py-4">
        {back}
        <div>
          <h2
            id={`${id}-title`}
            ref={titleRef}
            tabIndex={-1}
            className="font-heading text-title-1 text-neutral-2 outline-none"
          >
            Order {delivery.number}
          </h2>
          {delivery.line ? (
            <DeliveryLineView line={delivery.line} vehicleWords={null} />
          ) : (
            <p className="text-body-4 text-neutral-3">
              {delivery.courierShortName} · {delivery.stateWords}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-4">
          <dt className="text-neutral-3">Arriving</dt>
          <dd className="text-neutral-1 tabular-nums">
            {delivery.etaAt ? boardClock(delivery.etaAt, timeZone) : '—'}{' '}
            <span className="ml-1 inline-flex h-6 items-center rounded-md bg-neutral-7 px-2 text-caption font-medium">
              {lateChip(delivery.lateMinutes)}
            </span>
          </dd>
          <dt className="text-neutral-3">Customer</dt>
          <dd className="text-neutral-1">
            {delivery.customerFirstName} · {delivery.areaWords}
          </dd>
        </dl>
        <Button asChild variant="outline" size="kitchen" className="bg-white">
          <Link href={orderHref(delivery.orderId)}>Open order</Link>
        </Button>
      </section>
    );
  }

  const courier = data.couriers.find((item) => item.partnerId === selection.id);
  if (!courier) return <div className="px-4 py-4">{back}</div>;
  const delivery = courier.orderId
    ? (data.deliveries.find((item) => item.orderId === courier.orderId) ?? null)
    : null;
  const updated = staffUpdatedWords(ageSeconds(courier.at, serverNowMs));
  const minutes = delivery?.etaAt
    ? Math.max(0, Math.ceil((Date.parse(delivery.etaAt) - serverNowMs) / 60_000))
    : null;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-5 px-4 py-4">
      {back}
      <div>
        <h2
          id={`${id}-title`}
          ref={titleRef}
          tabIndex={-1}
          className="font-heading text-title-1 text-neutral-2 outline-none [overflow-wrap:anywhere]"
        >
          {courier.fullName}
        </h2>
        <p className="text-body-4 text-neutral-3">{courier.vehicleWords}</p>
      </div>
      <div>
        {/* Review S2 (design 3.5): on its way, the board's line, same component and tone. */}
        {delivery?.line ? (
          <DeliveryLineView
            line={delivery.line}
            vehicleWords={courier.vehicleWords}
            className="mt-0"
          />
        ) : (
          <p className="flex items-center gap-2 text-body-4 font-medium text-neutral-1">
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{
                background: isStale(freshnessFor(ageSeconds(courier.at, serverNowMs)))
                  ? STALE_FILL
                  : STATE_FILLS[courier.state],
              }}
            />
            {courier.words}
          </p>
        )}
        <p className="text-body-5 text-neutral-3">
          <span aria-hidden>{updated.text}</span>
          <span className="sr-only">{updated.spoken}</span>
        </p>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-4">
        <dt className="text-neutral-3">Phone</dt>
        <dd className="text-neutral-1">
          {courier.phone ? (
            <a
              href={`tel:${courier.phone.e164}`}
              aria-label={`Call ${courier.fullName}, ${courier.phone.display}`}
              className="inline-flex h-11 items-center gap-2 underline underline-offset-4"
            >
              <Phone className="size-4" aria-hidden />
              {courier.phone.display}
            </a>
          ) : demo ? (
            'No phone (demo courier)'
          ) : (
            '—'
          )}
        </dd>
        {courier.orderId && courier.orderNumber ? (
          <>
            <dt className="text-neutral-3">Order</dt>
            <dd>
              <Link
                href={orderHref(courier.orderId)}
                className="inline-flex h-11 items-center text-neutral-1 underline underline-offset-4"
              >
                Order {courier.orderNumber}
              </Link>
            </dd>
          </>
        ) : null}
        {delivery?.etaAt ? (
          <>
            <dt className="text-neutral-3">Arriving</dt>
            <dd className="text-neutral-1 tabular-nums">
              {boardClock(delivery.etaAt, timeZone)}
              {minutes ? ` · in ${minutes} min` : ''}
            </dd>
          </>
        ) : null}
        {delivery ? (
          <>
            <dt className="text-neutral-3">Customer</dt>
            <dd className="text-neutral-1">
              {delivery.customerFirstName} · {delivery.areaWords}
            </dd>
          </>
        ) : null}
      </dl>
      {courier.state === 'free' ? (
        <OfferSection
          courier={courier}
          ready={data.readyWithoutCourier}
          readOnly={demo}
          serverNowMs={serverNowMs}
          onSent={onRefresh}
        />
      ) : (
        <p className="flex items-center gap-2 text-body-5 text-neutral-3">
          <Info className="size-4 shrink-0" aria-hidden />
          {courier.state === 'offered'
            ? 'Has another offer open'
            : courier.orderNumber
              ? `On order ${courier.orderNumber}`
              : 'Busy'}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the demo control (3.7)

function DemoControl({
  run,
  serverNowMs,
  timeZone,
  onChanged,
}: {
  run: NonNullable<OpsMapSnapshot['demoRun']>;
  serverNowMs: number;
  timeZone: string;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const reasonId = useId();
  if (run.running && run.endsAt) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-tag-3-bg px-2.5 text-body-5 font-medium text-neutral-1">
        <Play className="size-3.5 text-tag-3" aria-hidden />
        {demoRunningText(run.orderNumber, run.endsAt, serverNowMs)}
      </span>
    );
  }
  const limited = run.runsLeft <= 0 && run.nextAt !== null;
  return (
    <div className="flex flex-col items-end">
      <SubmitButton
        type="button"
        pending={pending}
        pendingLabel={DEMO_COPY.starting}
        blocked={limited}
        aria-describedby={limited ? reasonId : undefined}
        onClick={() => {
          setPending(true);
          void (async () => {
            const outcome = await callAction(() => startDemoDeliveryAction({}));
            setPending(false);
            if (!outcome.ok) {
              const endsAt = outcome.error.details?.endsAt;
              if (outcome.error.code === 'DEMO_RUN_BUSY' && typeof endsAt === 'string') {
                showBoardNotice(demoBusyText(endsAt, serverNowMs));
              } else {
                showBoardNotice(outcome.error.message, { variant: 'error' });
              }
            }
            onChanged();
          })();
        }}
      >
        <Play className="size-4" aria-hidden />
        {DEMO_COPY.run}
      </SubmitButton>
      {limited && run.nextAt ? (
        <p id={reasonId} className="mt-1 text-caption text-neutral-3">
          {demoLimitText(boardClock(run.nextAt, timeZone))}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the page

export function LiveMapPage({
  initial,
  timeZone,
  initialSelection,
  initialTab,
}: {
  initial: OpsMapSnapshot;
  timeZone: string;
  initialSelection: Selection;
  initialTab: Tab | null;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const query = useOpsMap(initial);
  const data = query.data;
  // A49 (design 3.9): the stuck-delivery banners and F7's chime, as on the board, with the
  // board's own sound switch.
  const sound = useSound();
  const attention = data.attention ?? [];
  useStuckChime(attention, sound.state === 'on');
  const writer = useOpsMapWriter();
  const serverNowMs = useServerClock(data.asOf, data.receivedAt);
  const wide = useMediaQuery('(min-width: 64rem)');
  const demo = data.pool === 'DEMO';
  const [view, setView] = useState<View>('list');
  const [tab, setTab] = useState<Tab>(initialTab ?? 'couriers');
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [keyOpen, setKeyOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  // The view and the tab are remembered on this device (3.2).
  useEffect(() => {
    const timer = setTimeout(() => {
      setView(readPref(VIEW_KEY, ['list', 'map'] as const, 'list'));
      if (!initialTab) setTab(readPref(TAB_KEY, ['couriers', 'deliveries'] as const, 'couriers'));
    }, 0);
    return () => clearTimeout(timer);
  }, [initialTab]);

  // Live: positions on the pool's map channel, delivery changes on the ops channel.
  const mapChannel = hydrated ? (demo ? channels.opsMapDemo : channels.opsMap) : null;
  const opsChannel = hydrated ? channels.ops : null;
  const realtime = useRealtimeStatus(mapChannel);
  const throttler = useMemo(
    () =>
      new Throttler(() => void writer.refresh(), { wait: 2_000, leading: true, trailing: true }),
    [writer],
  );
  useChannelEvent(mapChannel, 'courier.position', (event) => {
    setLastUpdate(event.at);
    if (!writer.position(event)) throttler.maybeExecute();
  });
  useChannelEvent(mapChannel, 'demo.run-changed', () => throttler.maybeExecute());
  const onDeliveryChanged = (event: { at: string }) => {
    setLastUpdate(event.at);
    throttler.maybeExecute();
  };
  useChannelEvent(opsChannel, 'delivery.changed', onDeliveryChanged);
  // F8 (L10.4): the demo run's deliveries come on the demo staff channel only.
  useChannelEvent(
    hydrated && demo ? channels.opsDemo : null,
    'delivery.changed',
    onDeliveryChanged,
  );
  const connected = realtime.status === 'connected';
  const paused = realtime.status === 'reconnecting' && realtime.everConnected;
  const wasConnected = useRef(false);
  useEffect(() => {
    // Back after a drop: a fresh snapshot before anything new is drawn (3.6).
    if (connected && !wasConnected.current && realtime.everConnected) void writer.refresh();
    wasConnected.current = connected;
  }, [connected, realtime.everConnected, writer]);

  const couriers = useMemo(() => sortCouriers(data.couriers), [data.couriers]);
  const deliveries = useMemo(() => sortDeliveries(data.deliveries), [data.deliveries]);
  const courierOrder = useHeldOrder(couriers.map((courier) => courier.partnerId));
  const deliveryOrder = useHeldOrder(deliveries.map((delivery) => delivery.orderId));
  const courierById = new Map(couriers.map((courier) => [courier.partnerId, courier]));
  const deliveryById = new Map(deliveries.map((delivery) => [delivery.orderId, delivery]));

  const select = (next: Selection, row: HTMLElement | null) => {
    rowRef.current = row;
    setSelection(next);
    if (next?.kind === 'courier') setTab('couriers');
    if (next?.kind === 'delivery') setTab('deliveries');
    requestAnimationFrame(() => titleRef.current?.focus());
  };
  const back = () => {
    const key = selection?.id;
    setSelection(null);
    requestAnimationFrame(() => {
      const row = key
        ? document.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)
        : null;
      (row ?? rowRef.current)?.focus();
    });
  };

  const list = (
    <nav aria-label="Couriers and deliveries" className="flex min-h-0 flex-1 flex-col">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value === 'deliveries' ? 'deliveries' : 'couriers';
          setTab(next);
          writePref(TAB_KEY, next);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="sticky top-0 z-10 grid h-12 w-full group-data-horizontal/tabs:h-12 shrink-0 grid-cols-2 rounded-none border-b border-neutral-6 bg-white p-0">
          <TabsTrigger
            value="couriers"
            className="h-full text-button-2 text-neutral-3 data-[state=active]:text-neutral-1"
          >
            Couriers · {couriers.length}
          </TabsTrigger>
          <TabsTrigger
            value="deliveries"
            className="h-full text-button-2 text-neutral-3 data-[state=active]:text-neutral-1"
          >
            Deliveries · {deliveries.length}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="couriers" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          {couriers.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia>
                  <Bike className="size-6 text-neutral-3" aria-hidden />
                </EmptyMedia>
                <EmptyTitle className="text-body-4 font-normal">
                  No couriers are online right now.
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul {...courierOrder.handlers}>
              {courierOrder.order.map((id) => {
                const courier = courierById.get(id);
                if (!courier) return null;
                return (
                  <CourierRow
                    key={id}
                    courier={courier}
                    delivery={courier.orderId ? (deliveryById.get(courier.orderId) ?? null) : null}
                    selected={selection?.kind === 'courier' && selection.id === id}
                    serverNowMs={serverNowMs}
                    timeZone={timeZone}
                    onSelect={(button) => select({ kind: 'courier', id }, button)}
                  />
                );
              })}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="deliveries" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          {deliveries.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia>
                  <Truck className="size-6 text-neutral-3" aria-hidden />
                </EmptyMedia>
                <EmptyTitle className="text-body-4 font-normal">
                  No deliveries on the way.
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul {...deliveryOrder.handlers}>
              {deliveryOrder.order.map((id) => {
                const delivery = deliveryById.get(id);
                if (!delivery) return null;
                return (
                  <DeliveryRow
                    key={id}
                    delivery={delivery}
                    selected={selection?.kind === 'delivery' && selection.id === id}
                    timeZone={timeZone}
                    onSelect={(button) => select({ kind: 'delivery', id }, button)}
                  />
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </nav>
  );

  const panel = selection ? (
    <Panel
      data={data}
      selection={selection}
      serverNowMs={serverNowMs}
      timeZone={timeZone}
      demo={demo}
      titleRef={titleRef}
      onBack={wide ? back : null}
      onRefresh={() => void writer.refresh()}
    />
  ) : null;

  const canvas = (
    <LiveMapCanvas
      couriers={data.couriers}
      deliveries={data.deliveries}
      kitchen={data.kitchen ?? null}
      serverNowMs={serverNowMs}
      selection={selection}
      onSelect={(next) => select(next, null)}
    />
  );

  return (
    <AdminPage
      title="Live map"
      className="lg:h-dvh lg:min-h-0 lg:overflow-hidden"
      mainClassName="lg:min-h-0"
      status={<LiveChip state={paused ? 'reconnecting' : connected ? 'live' : 'notLive'} />}
      end={<SoundButton state={sound.state} onToggle={() => void sound.toggle()} />}
      banners={
        <>
          {paused ? (
            <Banner key="paused" variant="info" icon={RefreshCw}>
              {pausedText(lastUpdate, timeZone)}
            </Banner>
          ) : null}
          {attention.length > 0 ? (
            <StuckBanners items={attention} onOpen={(orderId) => router.push(orderHref(orderId))} />
          ) : null}
        </>
      }
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-6 bg-white px-4 lg:px-6">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            if (value !== 'list' && value !== 'map') return;
            setView(value);
            writePref(VIEW_KEY, value);
          }}
          className="lg:hidden"
        >
          <ToggleGroupItem value="list" className="h-11 px-4 text-button-2">
            <List className="size-4" aria-hidden />
            List
          </ToggleGroupItem>
          <ToggleGroupItem value="map" className="h-11 px-4 text-button-2">
            <MapIcon className="size-4" aria-hidden />
            Map
          </ToggleGroupItem>
        </ToggleGroup>
        <Collapsible open={keyOpen} onOpenChange={setKeyOpen} className="relative">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="touch" className="bg-white">
              <Info className="size-4" aria-hidden />
              Map key
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="absolute top-full left-0 z-30 mt-2 w-64 rounded-xl border border-neutral-6 bg-white p-3 shadow-raised">
            <ul className="space-y-2 text-body-5 text-neutral-1">
              {MAP_STATES.map((state) => (
                <li key={state} className="flex items-center gap-2">
                  <span aria-hidden className="shrink-0">
                    <CourierDisc
                      fill={STATE_FILLS[state]}
                      icon={stateIcon(state, 'SCOOTER')}
                      size={24}
                    />
                  </span>
                  {MAP_KEY_WORDS[state]}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span aria-hidden className="shrink-0">
                  <CourierDisc fill={STATE_FILLS.delivering} icon={Truck} size={24} hollow />
                </span>
                No location for 45 s
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="shrink-0">
                  <CourierDisc fill={STALE_FILL} icon={Truck} size={24} hollow />
                </span>
                No location for 2 min or more
              </li>
            </ul>
          </CollapsibleContent>
        </Collapsible>
        {demo && data.demoRun ? (
          <div className="ml-auto">
            <DemoControl
              run={data.demoRun}
              serverNowMs={serverNowMs}
              timeZone={timeZone}
              onChanged={() => void writer.refresh()}
            />
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <div
          className={cn(
            'flex min-h-0 flex-col border-neutral-6 bg-white lg:border-r',
            view === 'map' && 'max-lg:hidden',
          )}
        >
          {wide && panel ? <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div> : list}
        </div>
        <div
          className={cn(
            'relative min-h-0 bg-neutral-7 max-lg:h-[calc(100dvh-7rem)]',
            view === 'list' && 'max-lg:hidden',
          )}
        >
          {view === 'map' && !wide ? (
            <p className="sr-only">
              The map shows the same couriers and deliveries as the list. Switch to the list to go
              through them.
            </p>
          ) : null}
          {wide || view === 'map' ? canvas : null}
        </div>
      </div>
      {!wide ? (
        <Sheet open={selection !== null} onOpenChange={(open) => (open ? null : back())}>
          <SheetContent className="inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-white p-0 text-neutral-1">
            <SheetTitle className="sr-only">
              {selection?.kind === 'delivery' ? 'Delivery' : 'Courier'}
            </SheetTitle>
            <SheetDescription className="sr-only">Details and actions</SheetDescription>
            {/* Review S4 (design 3.2): a handle and a visible Close. */}
            <div className="sticky top-0 z-10 flex h-14 shrink-0 items-start justify-end bg-white px-2 pt-2">
              <span
                aria-hidden
                data-sheet-handle=""
                className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-neutral-5"
              />
              <SheetClose asChild>
                <Button type="button" variant="ghost" size="icon-kitchen" aria-label="Close">
                  <X className="size-5" aria-hidden />
                </Button>
              </SheetClose>
            </div>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}
    </AdminPage>
  );
}

const MAP_KEY_WORDS: Record<(typeof MAP_STATES)[number], string> = {
  free: 'Free',
  offered: 'Offered',
  toKitchen: 'To kitchen',
  atKitchen: 'At kitchen',
  delivering: 'Delivering',
  noAnswer: 'No answer',
  problem: 'Problem',
  locked: 'Code locked',
};
