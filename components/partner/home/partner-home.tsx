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
import type { PartnerState } from '@/server/modules/partners/schema';
import { kitchenDistance } from '@/server/modules/partners/location';
import { clockAt } from '@/server/modules/orders/text';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { LOOKING_AFTER_MS, STALE_AFTER_MS, fixQuality } from '@/lib/partner/location-queue';
import {
  adoptServerState,
  clearNotice,
  continueExplainer,
  dismissExplainer,
  goOffline,
  locationBlockedByPolicy,
  type Notice,
  onAvailabilityEvent,
  onStatusEvent,
  requestOnline,
  retryFromHelp,
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
import { Doodle } from '../doodle';
import { InstallCard } from '../install';
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

/** Shared by Home and Profile: the engine, the partner's channel and the status bar colour. */
export function usePartnerSession(state: Home, asOf: string) {
  const router = useRouter();
  const sharing = useSelector(sharingStore, (value) => value);
  const { resolved } = usePartnerTheme();
  const online = sharing.phase === 'online';
  const lastOfflineAt = state.lastOffline?.at ?? null;

  useEffect(() => {
    if (reloadForLocation()) return;
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

  useChannelEvent(channels.partner(state.partner.id), 'partner.availability-changed', (event) => {
    const wasOnline = sharingStore.state.phase === 'online';
    onAvailabilityEvent(event);
    // The server's words for the notice (the kitchen's closing time) come with a fresh read.
    if (wasOnline && !event.online && event.reason === 'kitchen-closed') router.refresh();
  });
  useChannelEvent(channels.partner(state.partner.id), 'partner.status-changed', (event) =>
    onStatusEvent(event.status),
  );

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

  return { sharing, online };
}

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

export function PartnerHome({ state, asOf }: { state: Home; asOf: string }) {
  const { sharing, online } = usePartnerSession(state, asOf);
  const { resolved } = usePartnerTheme();
  const now = useTick(5_000);
  const dockRef = useRef<HTMLButtonElement>(null);
  const battery = useBattery(online && !sharing.isDemo);
  const staleAnnounced = useRef(false);
  const tooFarAnnounced = useRef(false);

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

  const kitchen = state.kitchen;
  const position = sharing.isDemo ? state.demoPoint : sharing.lastFix;
  const distance = position ? kitchenDistance(position, kitchen.point) : null;
  const tooFar = distance && !distance.atKitchen && distance.km > kitchen.radiusKm;
  const line = lineState(sharing, now);

  useEffect(() => {
    if (line.kind === 'stale' && !staleAnnounced.current) {
      staleAnnounced.current = true;
      announce(`Location not shared for ${Math.max(2, line.minutes)} min`);
    }
    if (line.kind !== 'stale') staleAnnounced.current = false;
  }, [line]);
  useEffect(() => {
    if (online && tooFar && distance && !tooFarAnnounced.current) {
      tooFarAnnounced.current = true;
      announce(tooFarNotice(distance.km, kitchen.radiusKm));
    }
    if (!tooFar) tooFarAnnounced.current = false;
  }, [online, tooFar, distance, kitchen.radiusKm]);

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

  let body: ReactNode;
  if (online) {
    body = (
      <div className="space-y-4">
        <h1 className="sr-only">Home</h1>
        {demoBanner}
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
        </div>
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
          <LocationLine state={line} />
          <div className="flex min-h-16 items-center gap-3 px-4 py-3">
            <Store className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-body-4 text-foreground">{kitchen.onlineLine}</p>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <h1 className="sr-only">Home</h1>
        <div className="space-y-3">
          {demoBanner}
          {sharing.notice ? <NoticeView notice={sharing.notice} onDismiss={clearNotice} /> : null}
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
          <div className="mt-4">
            <KitchenChip open={kitchen.isOpen} line={kitchen.offlineLine} />
          </div>
        </div>
        <div className="mt-8">
          <InstallCard />
        </div>
        <UpdateBanner />
      </>
    );
  }

  const reasonId = 'partner-dock-reason';
  return (
    <>
      <div inert={sharing.suspended ? true : undefined}>
        <PartnerFrame
          header={
            <StatusHeader
              online={online}
              name={state.partner.name}
              photoUrl={state.partner.photo?.url ?? null}
            />
          }
          pinned={<PinnedConnectionBanner pinned={sharing.pinned} />}
          dock={
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
                  onPress={() => void requestOnline()}
                >
                  {sharing.otherDevice ? 'Go online here' : 'Go online'}
                </DockButton>
              )}
            </Dock>
          }
          tabBar={<PartnerTabBar current="home" />}
        >
          {body}
        </PartnerFrame>
      </div>
      <LocationExplainer
        open={sharing.phase === 'explaining'}
        onContinue={continueExplainer}
        onDismiss={dismissExplainer}
        returnFocus={() => dockRef.current?.focus()}
      />
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
