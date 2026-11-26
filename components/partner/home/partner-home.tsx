'use client';

import { useSelector } from '@tanstack/react-store';
import {
  BatteryLow,
  CircleCheck,
  Clock,
  Eye,
  type LucideIcon,
  Navigation,
  PowerOff,
  RefreshCw,
  Route,
  Store,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { PartnerDeliveryF8 } from '@/server/modules/tracking/schema';
import type { PartnerState } from '@/server/modules/partners/schema';
import { kitchenDistance } from '@/server/modules/partners/location';
import { clockAt } from '@/server/modules/orders/text';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import {
  adoptDispatch,
  catchUp,
  dispatchStore,
  loadDelivery,
  onDeliveryChanged,
  onOfferEnded,
  openOffer,
  pollCurrent,
  refreshSoundState,
  releasedByOwnChoice,
  wentOffline,
} from '@/lib/partner/dispatch';
import { LOOKING_AFTER_MS, STALE_AFTER_MS, fixQuality } from '@/lib/partner/location-queue';
import { keepRecent, type PartnerFix } from '@/lib/partner/moving';
import { pickedUpAnnouncement } from '@/lib/partner/delivery-text';
import { unlockOfferSound } from '@/lib/partner/offer-sound';
import { deliverTitle, pickUpTitle } from '@/lib/partner/offer-text';
import {
  adoptServerState,
  clearNotice,
  continueExplainer,
  dismissExplainer,
  goOffline,
  goOfflineGivingBack,
  locationBlockedByPolicy,
  type Notice,
  onAvailabilityEvent,
  onStatusEvent,
  requestOnline,
  retryFromHelp,
  retryLocationWhileHolding,
  type SharingState,
  sharingStore,
  tickWait,
} from '@/lib/partner/sharing';
import {
  batteryLine,
  distanceWords,
  type LocationLineState,
  onlineSinceLine,
  PARTNER_COPY,
  THEME_COLORS,
  tooFarNotice,
} from '@/lib/partner/text';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { CodeSheet } from '../delivery/code-sheet';
import { DeliverDock, DeliverScreen } from '../delivery/deliver-screen';
import { PartnerMapCard } from '../delivery/partner-map';
import { OpenInMapsButton, PickUpDock, PickUpScreen } from '../delivery/pick-up-screen';
import { ProblemSheet } from '../delivery/problem-sheet';
import { GiveBackSheet, LeavingDialog } from '../delivery/give-back-sheet';
import { Doodle } from '../doodle';
import { InstallCard } from '../install';
import { HowOffersWorkLink, PracticeOfferCard } from '../offers/idle-parts';
import { OfferLayer, useOfferOpen } from '../offers/offer-layer';
import { DispatchNoticeSlot, MissedOffersNotice, SoundUnlockBanner } from '../offers/offer-notices';
import { MoneyNoticeSlot } from '../earnings/money-notices';
import { TodayLink } from '../earnings/today-link';
import { usePartnerTheme } from '../partner-root';
import {
  Dock,
  DockButton,
  PartnerFrame,
  PartnerNotice,
  PartnerTabBar,
  PinnedBanner,
  StatusHeader,
} from '../shell';
import {
  KitchenChip,
  LocationExplainer,
  LocationHelpCard,
  LocationLine,
  SuspensionCover,
} from './home-parts';

/*
 * The partner app's Home (F6 design 6): offline, it never reads the position and says how to go
 * online; online, it shows the idle map, the distance to the kitchen, whether the location is
 * getting through, and one "Go offline". The header always says what the server holds.
 */

const IdleMap = dynamic(() => import('./idle-map'), {
  ssr: false,
  loading: () => <div aria-hidden className="h-44 bg-muted min-[22.5rem]:h-56" />,
});

type Home = Extract<PartnerState, { screen: 'home' }>;

const POLICY_RELOAD_KEY = 'foodz.partner-policy-reload';

/** Loads the page once as a partner document when its policy blocks location (never twice). */
function reloadForLocation(): boolean {
  let tried = false;
  try {
    tried = window.sessionStorage.getItem(POLICY_RELOAD_KEY) === window.location.pathname;
    if (!locationBlockedByPolicy()) {
      window.sessionStorage.removeItem(POLICY_RELOAD_KEY);
      return false;
    }
    if (tried) return false;
    window.sessionStorage.setItem(POLICY_RELOAD_KEY, window.location.pathname);
  } catch {
    if (!locationBlockedByPolicy()) return false;
  }
  window.location.reload();
  return true;
}

const POLL_MS = 5_000;
/** P26.2: offers pause when the last accepted point is older than this. */
const FRESH_POINT_MS = 45_000;

/**
 * Shared by Home and Profile: the location engine, the offers engine, the partner's channel and
 * the status bar colour. The offers engine adopts the server's state first, so a reload while
 * he holds an order never sends the offline beacon (U15).
 */
export function usePartnerSession(
  state: Home,
  asOf: string,
  delivery: PartnerDeliveryF8 | null = null,
) {
  const router = useRouter();
  const sharing = useSelector(sharingStore, (value) => value);
  const holding = useSelector(dispatchStore, (value) => value.delivery);
  const { resolved } = usePartnerTheme();
  const online = sharing.phase === 'online';
  const lastOfflineAt = state.lastOffline?.at ?? null;

  useEffect(() => {
    if (reloadForLocation()) return;
    adoptDispatch({
      partnerId: state.partner.id,
      isDemo: state.partner.isDemo,
      dispatch: state.dispatch,
      delivery,
      asOf,
    });
    void adoptServerState({
      partnerId: state.partner.id,
      isDemo: state.partner.isDemo,
      online: state.availability.online,
      onlineSince: state.availability.onlineSince,
      lastPointAt: state.availability.lastPointAt,
      onThisDevice: state.availability.onThisDevice,
      lastOffline: state.lastOffline,
      asOf,
    });
    // Re-adopt when the server's state itself changes (a refresh after being taken offline).
    // oxlint-disable-next-line react/exhaustive-deps
  }, [state.partner.id, state.availability.online, lastOfflineAt]);

  const channel = channels.partner(state.partner.id);
  useChannelEvent(channel, 'partner.availability-changed', (event) => {
    const wasOnline = sharingStore.state.phase === 'online';
    onAvailabilityEvent(event);
    // The server's words for the notice (the kitchen's closing time) come with a fresh read.
    if (wasOnline && !event.online && event.reason === 'kitchen-closed') router.refresh();
  });
  useChannelEvent(channel, 'partner.status-changed', (event) => onStatusEvent(event.status));
  // F7: offers and the order he holds (P19.1, P24, P31).
  useChannelEvent(channel, 'offer.created', (event) => {
    if (sharingStore.state.phase === 'online') openOffer(event.offerId, event.expiresAt);
  });
  useChannelEvent(channel, 'offer.ended', (event) => onOfferEnded(event));
  useChannelEvent(channel, 'delivery.changed', (event) => onDeliveryChanged(event));

  // Going or being taken offline closes an open offer without a notice (F6's says it).
  useEffect(() => {
    if (!online) wentOffline();
  }, [online]);

  // The 5-second poll while online and on screen (P28.6), or the order he holds (P29.6).
  const hasDelivery = holding !== null;
  useEffect(() => {
    if (!online && !hasDelivery) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (dispatchStore.state.delivery) void loadDelivery();
      else if (sharingStore.state.phase === 'online') void pollCurrent();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [online, hasDelivery]);

  // When the order ends, a fresh server read replaces the page's copy of it, drop-off address
  // included, so nothing of the customer stays in the open page (P29.7).
  const heldBefore = useRef(hasDelivery);
  useEffect(() => {
    if (heldBefore.current && !hasDelivery) router.refresh();
    heldBefore.current = hasDelivery;
  }, [hasDelivery, router]);

  // Back in the app: catch up at once (P28.3, P28.5).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refreshSoundState();
      if (sharingStore.state.phase === 'online' || dispatchStore.state.delivery) void catchUp();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // The status bar follows the header's fill (design 2.5).
  useEffect(() => {
    const colors = online ? THEME_COLORS.online : THEME_COLORS.offline;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = [...metas].map((meta) => meta.content);
    metas.forEach((meta) => {
      const media = meta.getAttribute('media') ?? '';
      const darkMeta = media.includes('dark') || (!media && resolved === 'dark');
      meta.content = darkMeta ? colors.dark : colors.light;
    });
    return () => metas.forEach((meta, index) => (meta.content = previous[index] ?? meta.content));
  }, [online, resolved]);

  return { sharing, online, holding };
}

/** Focus to the screen's h1 after his order goes (P30.2). */
const focusHome = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-partner-h1]')?.focus());

/** Re-renders every `ms` so "20 s ago" moves on (never a live region). */
function useTick(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

const isBattery = (value: unknown): value is BatteryLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'level') === 'number' &&
  typeof Reflect.get(value, 'addEventListener') === 'function';

/** P10.9: below 15% and not charging, where the browser reports it at all. */
function useBattery(active: boolean) {
  const [low, setLow] = useState<number | null>(null);
  useEffect(() => {
    const getBattery: unknown = Reflect.get(navigator, 'getBattery');
    if (!active || typeof getBattery !== 'function') return undefined;
    let battery: BatteryLike | null = null;
    let announced = false;
    const update = () => {
      if (!battery) return;
      const isLow = battery.level < 0.15 && !battery.charging;
      setLow(isLow ? battery.level : null);
      if (isLow && !announced) {
        announced = true;
        announce(batteryLine(battery.level));
      }
    };
    const start = async () => {
      const value: unknown = await getBattery.call(navigator);
      if (!isBattery(value)) return;
      battery = value;
      update();
      value.addEventListener('levelchange', update);
      value.addEventListener('chargingchange', update);
    };
    void start();
    return () => {
      battery?.removeEventListener('levelchange', update);
      battery?.removeEventListener('chargingchange', update);
      setLow(null);
    };
  }, [active]);
  return active ? low : null;
}

function NoticeView({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const icon: LucideIcon =
    notice.tone === 'success' ? CircleCheck : notice.tone === 'warning' ? TriangleAlert : Clock;
  return (
    <PartnerNotice tone={notice.tone} icon={icon} onDismiss={onDismiss}>
      {notice.text}
    </PartnerNotice>
  );
}

const PINNED: Record<
  Exclude<SharingState['pinned'], null>,
  { tone: 'warning' | 'success'; icon: LucideIcon; text: string }
> = {
  noConnection: { tone: 'warning', icon: WifiOff, text: PARTNER_COPY.noConnection },
  backOnline: { tone: 'success', icon: CircleCheck, text: PARTNER_COPY.backOnline },
  offlineOnPhone: { tone: 'warning', icon: WifiOff, text: PARTNER_COPY.offlineOnPhone },
};

export function PinnedConnectionBanner({ pinned }: { pinned: SharingState['pinned'] }) {
  if (!pinned) return null;
  const banner = PINNED[pinned];
  return (
    <PinnedBanner tone={banner.tone} icon={banner.icon}>
      {banner.text}
    </PinnedBanner>
  );
}

/** The location line's state from what the app knows (design 6.3's table). */
function lineState(sharing: SharingState, now: number): LocationLineState {
  if (sharing.isDemo) return { kind: 'demo' };
  const serverNowMs = now + sharing.offset;
  const acceptedAgo = sharing.lastAcceptedAt
    ? Math.max(0, (serverNowMs - Date.parse(sharing.lastAcceptedAt)) / 1000)
    : null;
  if (
    sharing.connection === 'offline' ||
    (sharing.queued > 0 && sharing.pinned === 'noConnection')
  ) {
    const sentAgo = sharing.lastSentAt ? (now - sharing.lastSentAt) / 1000 : null;
    return { kind: 'queued', secondsAgo: sentAgo };
  }
  const since = sharing.lastAcceptedAt
    ? Date.parse(sharing.lastAcceptedAt) - sharing.offset
    : sharing.onlineSince
      ? Date.parse(sharing.onlineSince) - sharing.offset
      : now;
  if (now - since >= STALE_AFTER_MS) {
    return { kind: 'stale', minutes: Math.floor((now - since) / 60_000) };
  }
  const fixAge = sharing.lastFix ? now - sharing.lastFix.at : Number.POSITIVE_INFINITY;
  if (fixAge >= LOOKING_AFTER_MS) return { kind: 'looking', secondsAgo: acceptedAgo };
  if (sharing.lastFix && fixQuality(sharing.lastFix.accuracy) === 'weak') {
    return { kind: 'weak', secondsAgo: acceptedAgo ?? 0 };
  }
  return { kind: 'shared', secondsAgo: acceptedAgo ?? 0 };
}

export function PartnerHome({
  state,
  userId = null,
  asOf,
  delivery = null,
}: {
  state: Home;
  /** For the staff money notices on his own channel (F9 design 1.10). */
  userId?: string | null;
  asOf: string;
  /** The order he holds, read on the server so the pick-up screen is in the first HTML. */
  delivery?: PartnerDeliveryF8 | null;
}) {
  const { sharing, online, holding: heldNow } = usePartnerSession(state, asOf, delivery);
  // Until the engine adopts the server's state, the server's copy draws the first paint.
  const adopted = useSelector(dispatchStore, (value) => value.partnerId === state.partner.id);
  const holding = adopted ? heldNow : delivery;
  const { resolved } = usePartnerTheme();
  const offerOpen = useOfferOpen();
  const now = useTick(5_000);
  const dockRef = useRef<HTMLButtonElement>(null);
  const battery = useBattery(online && !sharing.isDemo);
  const staleAnnounced = useRef(false);
  const tooFarAnnounced = useRef(false);
  const [givingBack, setGivingBack] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  // F8: the code and problem sheets, and what they give focus back to.
  const [codeOpen, setCodeOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const enterCodeRef = useRef<HTMLButtonElement>(null);
  const problemRef = useRef<HTMLButtonElement>(null);
  const delivered = useSelector(dispatchStore, (value) => value.delivered);
  const askedToWaitAt = useSelector(dispatchStore, (value) => value.askedToWaitAt);
  const offset = useSelector(dispatchStore, (value) => value.offset);
  const [atKitchenAtLoad] = useState(delivery?.stage === 'atKitchen');
  // The waiting clock ticks once a second; everything else every 5 s.
  const fastTick = useTick(holding?.noAnswer ? 1_000 : 60_000);
  const serverNow = Math.max(now, fastTick) + offset;
  // The last 10 s of fixes, for "moving or stopped" on the courier's map (P37.1).
  const [fixes, setFixes] = useState<PartnerFix[]>([]);
  const lastFix = sharing.lastFix;
  useEffect(() => {
    const fix = lastFix;
    if (!fix) return undefined;
    const timer = setTimeout(
      () =>
        setFixes((current) =>
          keepRecent(current, {
            lat: fix.lat,
            lng: fix.lng,
            accuracy: fix.accuracy,
            speed: fix.speed,
            at: fix.at,
          }),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, [lastFix]);

  // The rate limit's minutes count down silently; the button returns by itself.
  useEffect(() => {
    if (!sharing.waitUntil) return undefined;
    const timer = setInterval(() => tickWait(), 15_000);
    return () => clearInterval(timer);
  }, [sharing.waitUntil]);

  // "You're still online…" leaves after 8 s.
  useEffect(() => {
    if (sharing.notice?.text !== PARTNER_COPY.resumed) return undefined;
    const timer = setTimeout(clearNotice, 8_000);
    return () => clearTimeout(timer);
  }, [sharing.notice]);

  // The tab's title names the order he holds (design, Screens and routes).
  const heldNumber = holding?.orderNumber ?? null;
  const heldStatus = holding?.status ?? null;
  // F8 2.3: picked up (by his slide, or ADMIN's "keep the courier"): the deliver screen is
  // read and its h1 focused, whichever arrives first, the answer or the event.
  const heldFirst = holding?.dropoff?.firstName ?? null;
  const shownStatus = useRef(heldStatus);
  useEffect(() => {
    const before = shownStatus.current;
    shownStatus.current = heldStatus;
    if (!heldNumber || heldStatus !== 'PICKED_UP' || !before || before === 'PICKED_UP') return;
    announce(pickedUpAnnouncement(heldNumber, heldFirst));
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-partner-h1]')?.focus());
  }, [heldStatus, heldNumber, heldFirst]);

  useEffect(() => {
    if (!adopted) return;
    const title = heldNumber
      ? heldStatus === 'PICKED_UP'
        ? deliverTitle(heldNumber)
        : pickUpTitle(heldNumber)
      : 'Home';
    document.title = `${title} | Foodz Partner`;
  }, [adopted, heldNumber, heldStatus]);

  const kitchen = state.kitchen;
  const position = sharing.isDemo ? state.demoPoint : sharing.lastFix;
  const distance = position ? kitchenDistance(position, kitchen.point) : null;
  const tooFar = distance && !distance.atKitchen && distance.km > kitchen.radiusKm;
  const line = lineState(sharing, now);
  const lastPoint = sharing.lastAcceptedAt ? Date.parse(sharing.lastAcceptedAt) : null;
  const offersPaused =
    online &&
    !sharing.isDemo &&
    (lastPoint === null
      ? state.dispatch.offersPausedSince !== null
      : now + sharing.offset - lastPoint > FRESH_POINT_MS);

  useEffect(() => {
    if (line.kind === 'stale' && !staleAnnounced.current) {
      staleAnnounced.current = true;
      announce(`Location not shared for ${Math.max(2, line.minutes)} min`);
    }
    if (line.kind !== 'stale') staleAnnounced.current = false;
  }, [line]);
  const holds = holding !== null;
  useEffect(() => {
    if (online && tooFar && distance && !tooFarAnnounced.current && !holds) {
      tooFarAnnounced.current = true;
      announce(tooFarNotice(distance.km, kitchen.radiusKm));
    }
    if (!tooFar) tooFarAnnounced.current = false;
  }, [online, tooFar, distance, kitchen.radiusKm, holds]);

  const finding = sharing.phase === 'finding';
  const dockBlocked = Boolean(sharing.dockReason) && !finding;
  const reasonIcon: LucideIcon | undefined =
    sharing.dockReason?.kind === 'connection'
      ? WifiOff
      : sharing.dockReason?.kind === 'wait'
        ? Clock
        : sharing.dockReason
          ? TriangleAlert
          : undefined;

  const demoBanner = state.partner.isDemo ? (
    <PartnerNotice tone="muted" icon={Eye}>
      {PARTNER_COPY.demoBanner}
    </PartnerNotice>
  ) : null;
  const homeHeading = (
    <h1 data-partner-h1="" tabIndex={-1} className="sr-only">
      Home
    </h1>
  );
  const bicycle = state.partner.vehicleWords.startsWith('Bicycle');
  const rememberOpener = () => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const holdingNotices = (
    <>
      <MoneyNoticeSlot userId={userId} />
      <DispatchNoticeSlot />
    </>
  );
  const todayLink = state.today ? (
    <TodayLink partnerId={state.partner.id} initial={state.today} />
  ) : null;

  let body: ReactNode;
  if (holding) {
    // P29.4: while he holds an order, Home always comes back to it.
    const toKitchen = position ? kitchenDistance(position, holding.kitchen.point) : null;
    const afterPickup = holding.status === 'PICKED_UP' && holding.dropoff !== null;
    const mapFix: PartnerFix | null = position
      ? {
          lat: position.lat,
          lng: position.lng,
          accuracy: sharing.isDemo ? 30 : (sharing.lastFix?.accuracy ?? null),
          speed: sharing.lastFix?.speed ?? null,
          at: sharing.lastFix?.at ?? now,
        }
      : null;
    const mapCard = (
      <PartnerMapCard
        delivery={holding}
        fix={mapFix}
        fixes={fixes}
        dark={resolved === 'dark'}
        now={now}
        serverNow={serverNow}
        openInMaps={
          <OpenInMapsButton
            deliveryId={holding.deliveryId}
            point={afterPickup && holding.dropoff ? holding.dropoff.point : holding.kitchen.point}
            bicycle={bicycle}
            customerFirst={afterPickup ? (holding.dropoff?.firstName ?? null) : null}
          />
        }
        locationRow={line.kind === 'shared' ? null : <LocationLine state={line} />}
      />
    );
    body =
      holding.status === 'PICKED_UP' ? (
        <DeliverScreen
          delivery={holding}
          notices={holdingNotices}
          mapCard={mapCard}
          locationOff={sharing.locationOff}
          serverNow={serverNow}
          askedToWaitAt={askedToWaitAt}
          onRetryLocation={() => void retryLocationWhileHolding()}
          onOpenProblems={() => setProblemsOpen(true)}
          problemRef={problemRef}
        />
      ) : (
        <PickUpScreen
          delivery={holding}
          distance={toKitchen}
          locationOff={sharing.locationOff}
          notices={holdingNotices}
          mapCard={mapCard}
          atKitchenAtLoad={atKitchenAtLoad}
          onGiveBack={() => {
            rememberOpener();
            setGivingBack(true);
          }}
          onGoOffline={() => {
            rememberOpener();
            setLeaving(true);
          }}
          onRetryLocation={() => void retryLocationWhileHolding()}
        />
      );
  } else if (online) {
    body = (
      <div className="space-y-4">
        {homeHeading}
        {demoBanner}
        <SoundUnlockBanner />
        <MissedOffersNotice />
        <MoneyNoticeSlot userId={userId} />
        <DispatchNoticeSlot />
        {battery !== null ? (
          <PartnerNotice tone="warning" icon={BatteryLow}>
            {batteryLine(battery)}
          </PartnerNotice>
        ) : null}
        {tooFar && distance ? (
          <PartnerNotice tone="warning" icon={Route}>
            {tooFarNotice(distance.km, kitchen.radiusKm)}
          </PartnerNotice>
        ) : null}
        {sharing.notice ? (
          <NoticeView
            notice={sharing.notice}
            onDismiss={sharing.notice.text === PARTNER_COPY.resumed ? undefined : clearNotice}
          />
        ) : null}
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          {position ? (
            <IdleMap
              at={{ lat: position.lat, lng: position.lng }}
              accuracy={sharing.isDemo ? 30 : (sharing.lastFix?.accuracy ?? null)}
              kitchen={kitchen.point}
              dark={resolved === 'dark'}
            />
          ) : (
            <div aria-hidden className="h-44 bg-muted min-[22.5rem]:h-56" />
          )}
          <p className="border-t border-border px-3 py-1.5 text-caption leading-normal text-muted-foreground">
            Map ©{' '}
            <a href="https://openfreemap.org" className="underline underline-offset-2">
              OpenFreeMap
            </a>{' '}
            ·{' '}
            <a href="https://openmaptiles.org" className="underline underline-offset-2">
              © OpenMapTiles
            </a>{' '}
            · Data{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              className="underline underline-offset-2"
            >
              © OpenStreetMap contributors
            </a>
          </p>
        </section>
        <div>
          <h2 className="font-heading text-title-1 text-strong">Waiting for orders</h2>
          {sharing.onlineSince ? (
            <p className="mt-1 text-body-4 text-muted-foreground">
              {onlineSinceLine(clockAt(sharing.onlineSince, kitchen.timeZone))}
            </p>
          ) : null}
          {todayLink ? <div className="mt-3">{todayLink}</div> : null}
        </div>
        <div>
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            <div className="flex min-h-16 items-center gap-3 px-4 py-3">
              <Route className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              {distance ? (
                <p className="text-body-4 text-foreground">
                  <span className="text-title-2 font-semibold text-strong tabular-nums">
                    {distanceWords(distance).figure}
                  </span>
                  {distanceWords(distance).rest}
                </p>
              ) : (
                <p className="text-body-4 text-foreground">{PARTNER_COPY.finding}</p>
              )}
            </div>
            <LocationLine state={line} offersPaused={offersPaused} />
            <div className="flex min-h-16 items-center gap-3 px-4 py-3">
              <Store className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-body-4 text-foreground">{kitchen.onlineLine}</p>
            </div>
          </div>
          <HowOffersWorkLink />
        </div>
        {sharing.isDemo ? <PracticeOfferCard /> : null}
      </div>
    );
  } else {
    body = (
      <>
        {homeHeading}
        <div className="space-y-3">
          {demoBanner}
          {sharing.notice ? <NoticeView notice={sharing.notice} onDismiss={clearNotice} /> : null}
          <MoneyNoticeSlot userId={userId} />
          <DispatchNoticeSlot />
        </div>
        {sharing.help ? (
          <div className="mt-4">
            <LocationHelpCard card={sharing.help} onRetry={() => void retryFromHelp()} />
          </div>
        ) : null}
        <div className="pt-6 text-center">
          {sharing.help ? null : <Doodle name="meditating" className="w-40 max-[359px]:w-30" />}
          <h2 className="mt-4 font-heading text-h4 text-strong">You&apos;re offline</h2>
          <p className="mt-2 text-body-4 text-muted-foreground">
            Go online to start getting orders.
          </p>
          {todayLink ? <div className="mt-4 flex justify-center">{todayLink}</div> : null}
          <div className="mt-4">
            <KitchenChip open={kitchen.isOpen} line={kitchen.offlineLine} />
          </div>
          <HowOffersWorkLink />
        </div>
        <div className="mt-8">
          <InstallCard />
        </div>
        <UpdateBanner />
      </>
    );
  }

  const reasonId = 'partner-dock-reason';
  const dock: ReactNode = holding ? (
    holding.status === 'PICKED_UP' ? (
      <DeliverDock buttonRef={enterCodeRef} onEnterCode={() => setCodeOpen(true)} />
    ) : (
      <PickUpDock delivery={holding} position={position} />
    )
  ) : (
    <Dock
      withTabBar
      reason={sharing.dockReason?.text ?? null}
      reasonIcon={reasonIcon}
      reasonId={reasonId}
    >
      {online ? (
        <DockButton
          variant="stop"
          icon={PowerOff}
          buttonRef={dockRef}
          onPress={() => void goOffline()}
        >
          Go offline
        </DockButton>
      ) : (
        <DockButton
          icon={Navigation}
          buttonRef={dockRef}
          pending={finding}
          pendingLabel={PARTNER_COPY.finding}
          blocked={dockBlocked}
          blockedReason={sharing.dockReason?.text ?? null}
          reasonId={reasonId}
          onPress={() => {
            // The tap that goes online also lets offers play their sound later (P19.4).
            void unlockOfferSound().then(refreshSoundState);
            void requestOnline();
          }}
        >
          {sharing.otherDevice ? 'Go online here' : 'Go online'}
        </DockButton>
      )}
    </Dock>
  );

  return (
    <>
      <div inert={sharing.suspended || offerOpen ? true : undefined}>
        <PartnerFrame
          header={
            <StatusHeader
              online={online || holds}
              name={state.partner.name}
              photoUrl={state.partner.photo?.url ?? null}
            />
          }
          pinned={<PinnedConnectionBanner pinned={sharing.pinned} />}
          dock={dock}
          tabBar={<PartnerTabBar current="home" />}
        >
          {body}
        </PartnerFrame>
      </div>
      <LocationExplainer
        open={sharing.phase === 'explaining' && !offerOpen}
        onContinue={continueExplainer}
        onDismiss={dismissExplainer}
        returnFocus={() => dockRef.current?.focus()}
      />
      {holding ? (
        <>
          <GiveBackSheet
            open={givingBack}
            orderNumber={holding.orderNumber}
            onOpenChange={setGivingBack}
            onDone={focusHome}
            returnFocus={() => openerRef.current?.focus()}
          />
          <LeavingDialog
            open={leaving}
            how="offline"
            orderNumber={holding.orderNumber}
            onKeep={() => setLeaving(false)}
            onConfirm={async () => {
              const outcome = await goOfflineGivingBack();
              if (outcome === 'done') {
                releasedByOwnChoice();
                setLeaving(false);
                focusHome();
                return null;
              }
              if (outcome === 'offline') return PARTNER_COPY.needConnection;
              return `You can't go offline with order ${holding.orderNumber} now. Call Foodz Kitchen.`;
            }}
            returnFocus={() => openerRef.current?.focus()}
          />
        </>
      ) : null}
      {holding || delivered ? (
        <CodeSheet
          open={codeOpen || delivered !== null}
          onOpenChange={setCodeOpen}
          position={position}
          returnFocus={() => enterCodeRef.current?.focus()}
        />
      ) : null}
      {holding ? (
        <ProblemSheet
          open={problemsOpen}
          onOpenChange={setProblemsOpen}
          returnFocus={() => problemRef.current?.focus()}
        />
      ) : null}
      <OfferLayer />
      {sharing.suspended ? <SuspensionCover how={sharing.suspended} /> : null}
    </>
  );
}

/** A waiting service worker: "A new version of the app is ready." on the offline home only. */
function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    let cancelled = false;
    const watch = async () => {
      const registration = await navigator.serviceWorker.getRegistration('/partner');
      if (cancelled || !registration) return;
      if (registration.waiting) setWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing);
          }
        });
      });
    };
    void watch();
    return () => {
      cancelled = true;
    };
  }, []);
  if (!waiting) return null;
  return (
    <div className="mt-4">
      <PartnerNotice
        tone="muted"
        icon={RefreshCw}
        action={
          <Button
            type="button"
            variant="outline"
            size="kitchen"
            className="bg-card"
            onClick={() => {
              navigator.serviceWorker.addEventListener('controllerchange', () =>
                window.location.reload(),
              );
              // A worker's postMessage takes transferables, not a target origin.
              // oxlint-disable-next-line unicorn/require-post-message-target-origin
              waiting.postMessage({ type: 'SKIP_WAITING' });
            }}
          >
            Reload
          </Button>
        }
      >
        {PARTNER_COPY.newVersion}
      </PartnerNotice>
    </div>
  );
}
