import { createStore } from '@tanstack/react-store';
import { type NoticedOfflineReason, offlineNotice } from '@/server/modules/partners/text';
import type { PartnerAvailabilityChangedEvent } from '@/lib/realtime/events';
import { announce } from '@/lib/announce';
import { serverOffset } from '@/lib/board/clock';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import {
  APPROXIMATE_AFTER_MS,
  BACK_ONLINE_MS,
  backoffMs,
  CONNECTION_BANNER_DELAY_MS,
  type Fix,
  locationsBody,
  nextBatch,
  NOT_FOUND_AFTER_MS,
  pruneQueue,
  type QueuedPoint,
  retryAfterSeconds,
  SEND_ACCURACY_M,
  SEND_GAP_MS,
  SEND_TIMEOUT_MS,
  shouldQueue,
  toPoint,
} from './location-queue';
import { PARTNER_COPY, tooManySwitches } from './text';

/*
 * Going online, sharing the location and going offline (F6 design 6.2 to 6.6), in one engine
 * that outlives a page: Home and Profile are two pages of one session, and the header must keep
 * saying what the server holds on both. The engine reads the position only while going online
 * or online (P9.1); stops reading, empties the queue and releases the screen lock before it
 * tells the server it went offline (P12.1); and never sends a point after that. The demo
 * partner never reads the phone's position at all (P9.12).
 */

export type HelpCard = 'blocked' | 'turnedOff' | 'approximate' | 'notFound';
export type Phase = 'offline' | 'explaining' | 'finding' | 'online';
export type Pinned = 'noConnection' | 'backOnline' | 'offlineOnPhone' | null;

export interface Notice {
  text: string;
  tone: 'warning' | 'muted' | 'success';
}

export interface SharingState {
  /** The partner the engine works for; another sign-in starts afresh. */
  partnerId: string | null;
  isDemo: boolean;
  phase: Phase;
  onlineSince: string | null;
  help: HelpCard | null;
  /** The dock's reason above a blocked "Go online". */
  dockReason: { text: string; kind: 'connection' | 'wait' | 'failed' } | null;
  /** Rate limited until this device time (the button comes back by itself). */
  waitUntil: number | null;
  /** The offline home's notice (design 6.6) or the online screen's (6.3, 6.5). */
  notice: Notice | null;
  /** "Go online here" after another device took over. */
  otherDevice: boolean;
  lastFix: Fix | null;
  /** The server's acceptance time of the last point. */
  lastAcceptedAt: string | null;
  /** When the last batch was handed over, device time. */
  lastSentAt: number | null;
  offset: number;
  queued: number;
  connection: 'online' | 'offline';
  pinned: Pinned;
  suspended: 'event' | 'signedOut' | null;
  /** The location sharing went to the background for a while (P10.7). */
  hiddenSince: number | null;
}

const initial: SharingState = {
  partnerId: null,
  isDemo: false,
  phase: 'offline',
  onlineSince: null,
  help: null,
  dockReason: null,
  waitUntil: null,
  notice: null,
  otherDevice: false,
  lastFix: null,
  lastAcceptedAt: null,
  lastSentAt: null,
  offset: 0,
  queued: 0,
  connection: 'online',
  pinned: null,
  suspended: null,
  hiddenSince: null,
};

export const sharingStore = createStore<SharingState>(initial);

const set = (patch: Partial<SharingState>) =>
  sharingStore.setState((current) => ({ ...current, ...patch }));
const get = () => sharingStore.state;

// ------------------------------------------------------------------ requests

interface Answer {
  status: number;
  body: unknown;
  retryAfter: string | null;
}

async function call(
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
  { keepalive = false, timeoutMs = SEND_TIMEOUT_MS } = {},
): Promise<Answer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
      signal: keepalive ? undefined : controller.signal,
      credentials: 'same-origin',
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return {
      status: response.status,
      body: parsed,
      retryAfter: response.headers.get('retry-after'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined;
const codeOf = (body: unknown) => {
  const code = field(body, 'code');
  return typeof code === 'string' ? code : null;
};

// ------------------------------------------------------------------ internals

let watchId: number | null = null;
let coarseSince: number | null = null;
let findTimers: ReturnType<typeof setTimeout>[] = [];
let queue: QueuedPoint[] = [];
let lastQueued: QueuedPoint | null = null;
let sending = false;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let backTimer: ReturnType<typeof setTimeout> | null = null;
let offlinePending = false;
let wakeLock: WakeLockSentinel | null = null;
let listening = false;
let resolveFirstFix: ((fix: Fix | null) => void) | null = null;
const ownChanges = new Set<string>();
/*
 * The realtime echo of this device's own change can arrive before the answer that names its
 * `changeId`. While an availability request is out, events wait, and are judged once it answers.
 */
let requestsOut = 0;
let held: PartnerAvailabilityChangedEvent[] = [];

async function availabilityRequest(body: unknown, keepalive = false): Promise<Answer | null> {
  requestsOut += 1;
  try {
    const answer = await call('PUT', '/api/v1/partner/availability', body, { keepalive });
    const changeId = field(answer?.body, 'changeId');
    if (typeof changeId === 'string') ownChanges.add(changeId);
    return answer;
  } finally {
    requestsOut -= 1;
    if (requestsOut === 0 && held.length) {
      const waiting = held;
      held = [];
      // After the caller has applied the answer.
      setTimeout(() => waiting.forEach((event) => onAvailabilityEvent(event)), 0);
    }
  }
}

const WAKE_KEY = 'foodz.partner-keep-screen-on';
const ASKED_KEY = 'foodz.partner-location-asked';

export function keepScreenOnSetting(): boolean {
  try {
    return window.localStorage.getItem(WAKE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setKeepScreenOn(on: boolean) {
  try {
    window.localStorage.setItem(WAKE_KEY, on ? 'on' : 'off');
  } catch {
    // Blocked: the default stays.
  }
  if (on && get().phase === 'online') void lockScreen();
  if (!on) void releaseScreen();
}

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

async function lockScreen() {
  if (!keepScreenOnSetting() || document.visibilityState !== 'visible' || wakeLock) return;
  if (!wakeLockSupported()) {
    showScreenNotice('unsupported');
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    showScreenNotice('refused');
  }
}

async function releaseScreen() {
  const sentinel = wakeLock;
  wakeLock = null;
  try {
    await sentinel?.release();
  } catch {
    // Already released.
  }
}

const SCREEN_SEEN_KEY = 'foodz.partner-screen-notice';

function showScreenNotice(kind: 'unsupported' | 'refused') {
  if (get().notice) return;
  if (kind === 'unsupported') {
    try {
      if (window.localStorage.getItem(SCREEN_SEEN_KEY)) return;
      window.localStorage.setItem(SCREEN_SEEN_KEY, '1');
    } catch {
      return;
    }
  }
  const text = kind === 'unsupported' ? PARTNER_COPY.screenUnsupported : PARTNER_COPY.screenRefused;
  set({ notice: { text, tone: kind === 'unsupported' ? 'muted' : 'warning' } });
  announce(text);
}

function clearFindTimers() {
  findTimers.forEach(clearTimeout);
  findTimers = [];
}

function stopWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearFindTimers();
  // Whoever waits for a first fix hears that none is coming.
  resolveFirstFix?.(null);
  resolveFirstFix = null;
  coarseSince = null;
}

/** Everything that reads or sends the position stops, before anything else (P12.1). */
function stopEverything() {
  stopWatching();
  queue = [];
  lastQueued = null;
  attempt = 0;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = null;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = null;
  if (backTimer) clearTimeout(backTimer);
  backTimer = null;
  void releaseScreen();
  set({ queued: 0 });
}

function onFix(position: GeolocationPosition) {
  const fix: Fix = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    at: position.timestamp || Date.now(),
  };
  const state = get();
  if (state.phase === 'finding') {
    if (fix.accuracy <= SEND_ACCURACY_M) {
      resolveFirstFix?.(fix);
      return;
    }
    // D21, P9.6: fixes worse than 500 m are ignored while GPS warms up; 10 s of only these means
    // "approximate", also when the phone never sends a second fix (Precise Location off).
    if (coarseSince === null) {
      coarseSince = Date.now();
      findTimers.push(
        setTimeout(() => {
          if (get().phase === 'finding') failFinding('approximate');
        }, APPROXIMATE_AFTER_MS),
      );
    }
    return;
  }
  if (state.phase !== 'online') return;
  set({ lastFix: fix });
  const now = Date.now();
  if (shouldQueue(fix, lastQueued, now)) {
    const point = toPoint(fix);
    lastQueued = point;
    queue = pruneQueue([...queue, point], now);
    set({ queued: queue.length });
    scheduleSend(0);
  }
}

function onWatchError(error: GeolocationPositionError) {
  if (error.code !== error.PERMISSION_DENIED) return;
  const state = get();
  if (state.phase === 'finding') {
    failFinding('blocked');
  } else if (state.phase === 'online') {
    // P12.3: location turned off while online.
    void goOffline({ help: 'turnedOff', announceText: null });
  }
}

function startWatching() {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onFix, onWatchError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 60_000,
  });
}

function failFinding(card: HelpCard) {
  stopWatching();
  set({ phase: 'offline', help: card });
}

// ------------------------------------------------------------------ sending (design 6.4)

function scheduleSend(delay: number) {
  if (sendTimer || sending) return;
  sendTimer = setTimeout(() => {
    sendTimer = null;
    void sendNow();
  }, delay);
}

async function sendNow() {
  const state = get();
  if (state.phase !== 'online' || state.isDemo || sending) return;
  queue = pruneQueue(queue, Date.now());
  if (!queue.length) {
    set({ queued: 0 });
    return;
  }
  if (!navigator.onLine) {
    markDisconnected();
    return;
  }
  const batch = nextBatch(queue);
  sending = true;
  const sentAt = Date.now();
  const answer = await call('POST', '/api/v1/partner/locations', locationsBody(batch));
  sending = false;
  if (get().phase !== 'online') return;
  if (!answer || answer.status >= 500) {
    markDisconnected();
    scheduleSend(backoffMs(attempt));
    attempt += 1;
    return;
  }
  if (answer.status === 429) {
    scheduleSend(retryAfterSeconds(answer.retryAfter, answer.body) * 1000);
    return;
  }
  if (answer.status !== 200) {
    handleRefusal(answer);
    return;
  }
  attempt = 0;
  // Accepted, ignored and refused points all leave the queue: a refused one is never retried.
  queue = queue.slice(batch.length);
  const lastPointAt = field(answer.body, 'lastPointAt');
  const serverTime = field(answer.body, 'serverTime');
  set({
    queued: queue.length,
    lastSentAt: sentAt,
    ...(typeof lastPointAt === 'string' ? { lastAcceptedAt: lastPointAt } : {}),
    ...(typeof serverTime === 'string' ? { offset: serverOffset(serverTime, Date.now()) } : {}),
  });
  markConnected();
  if (queue.length) scheduleSend(SEND_GAP_MS);
}

function markDisconnected() {
  if (get().connection === 'offline') return;
  set({ connection: 'offline' });
  if (backTimer) clearTimeout(backTimer);
  backTimer = null;
  if (bannerTimer) return;
  bannerTimer = setTimeout(() => {
    bannerTimer = null;
    if (get().connection === 'offline' && get().phase === 'online') {
      set({ pinned: 'noConnection' });
      announce(PARTNER_COPY.noConnection);
    }
  }, CONNECTION_BANNER_DELAY_MS);
}

function markConnected() {
  const wasOffline = get().connection === 'offline';
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = null;
  set({ connection: 'online' });
  if (wasOffline && get().pinned === 'noConnection' && queue.length === 0) {
    set({ pinned: 'backOnline' });
    announce(PARTNER_COPY.backOnline);
    backTimer = setTimeout(() => {
      backTimer = null;
      if (get().pinned === 'backOnline') set({ pinned: null });
    }, BACK_ONLINE_MS);
  } else if (wasOffline && get().pinned === 'noConnection' && queue.length) {
    scheduleSend(0);
  }
}

function handleRefusal(answer: Answer) {
  const code = codeOf(answer.body);
  const details = field(answer.body, 'details');
  if (code === 'PARTNER_SUSPENDED') {
    suspend('event');
    return;
  }
  if (code === 'OTHER_DEVICE') {
    stopEverything();
    set({
      phase: 'offline',
      otherDevice: true,
      notice: { text: PARTNER_COPY.otherDevice, tone: 'muted' },
    });
    announce(PARTNER_COPY.otherDevice);
    return;
  }
  if (code === 'NOT_ONLINE') {
    const reason = field(details, 'reason');
    const at = field(details, 'at');
    takenOffline(typeof reason === 'string' ? reason : null, typeof at === 'string' ? at : null);
    return;
  }
  if (answer.status === 401) {
    suspend('signedOut');
    return;
  }
  // Anything else: this batch is dropped, sharing carries on.
  queue = queue.slice(nextBatch(queue).length);
  set({ queued: queue.length });
}

// ------------------------------------------------------------------ the server's own changes

const NOTICED = new Set<string>([
  'no-location',
  'kitchen-closed',
  'other-device',
  'demo-other-visitor',
]);
const isNoticed = (reason: string): reason is NoticedOfflineReason => NOTICED.has(reason);

/**
 * The offline home's notice for a server reason (design 6.6), in the store's time. The two "no
 * location" sentences come from one reason; the app picks by whether it had a connection (D20).
 * The page then re-reads its state, whose words are exact (the kitchen's closing time).
 */
function wordsForReason(reason: string, at: string, disconnected: boolean): string | null {
  if (!isNoticed(reason)) return null;
  const words = offlineNotice(reason, at, STORE_TIME_ZONE);
  return disconnected && words.ifDisconnected ? words.ifDisconnected : words.words;
}

function takenOffline(reason: string | null, at: string | null) {
  const disconnected = get().connection === 'offline';
  stopEverything();
  const text = reason && at ? wordsForReason(reason, at, disconnected) : null;
  set({
    phase: 'offline',
    onlineSince: null,
    pinned: null,
    notice: text ? { text, tone: reason === 'no-location' ? 'warning' : 'muted' } : null,
    otherDevice: reason === 'other-device',
  });
  if (text) announce(text);
}

function suspend(how: 'event' | 'signedOut') {
  // Location stops before anything is drawn (design 5.9).
  stopEverything();
  set({ phase: 'offline', suspended: how, pinned: null });
}

export function onAvailabilityEvent(event: PartnerAvailabilityChangedEvent) {
  if (ownChanges.has(event.changeId)) return;
  if (requestsOut > 0) {
    held.push(event);
    return;
  }
  const state = get();
  if (!event.online) {
    if (state.phase === 'offline' && !state.isDemo) return;
    if (event.reason === 'suspended') {
      suspend('event');
      return;
    }
    if (state.isDemo) {
      stopEverything();
      set({
        phase: 'offline',
        onlineSince: null,
        notice: { text: PARTNER_COPY.demoOffline, tone: 'muted' },
      });
      announce(PARTNER_COPY.demoOffline);
      return;
    }
    takenOffline(event.reason, event.at);
    return;
  }
  if (state.isDemo) {
    // Another visitor took the shared demo partner online.
    set({ phase: 'online', onlineSince: event.at, help: null, notice: null });
    return;
  }
  if (state.phase === 'online' || state.phase === 'finding') {
    stopEverything();
    set({
      phase: 'offline',
      otherDevice: true,
      notice: { text: PARTNER_COPY.otherDevice, tone: 'muted' },
    });
    announce(PARTNER_COPY.otherDevice);
  }
}

export function onStatusEvent(status: 'APPROVED' | 'SUSPENDED') {
  if (status === 'SUSPENDED') suspend('event');
}

// ------------------------------------------------------------------ going online (design 6.2)

async function permissionState(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state;
  } catch {
    try {
      return window.localStorage.getItem(ASKED_KEY) ? 'granted' : 'prompt';
    } catch {
      return 'prompt';
    }
  }
}

function rememberAsked() {
  try {
    window.localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Blocked.
  }
}

/** "Go online" pressed. */
export async function requestOnline() {
  const state = get();
  if (state.phase === 'finding' || state.phase === 'online') return;
  if (state.waitUntil && Date.now() < state.waitUntil) {
    if (state.dockReason) announce(state.dockReason.text);
    return;
  }
  if (!navigator.onLine) {
    set({ dockReason: { text: PARTNER_COPY.needConnection, kind: 'connection' } });
    announce(PARTNER_COPY.needConnection);
    return;
  }
  set({ dockReason: null, notice: null });
  if (state.isDemo) {
    set({ phase: 'finding', help: null });
    await sendOnline(undefined);
    return;
  }
  if (!('geolocation' in navigator)) {
    set({ help: 'notFound' });
    return;
  }
  const permission = await permissionState();
  if (permission === 'denied') {
    set({ help: 'blocked' });
    return;
  }
  if (permission === 'prompt') {
    // The browser's prompt never appears first (P9.2).
    set({ phase: 'explaining' });
    return;
  }
  void find();
}

/** The explainer's "Continue": the browser's prompt, then finding. */
export function continueExplainer() {
  rememberAsked();
  void find();
}

export function dismissExplainer() {
  if (get().phase === 'explaining') set({ phase: 'offline' });
}

/** A help card's "Try again": check once more, then carry on from finding. */
export async function retryFromHelp() {
  const permission = await permissionState();
  if (permission === 'denied') {
    announce('Location is still blocked for Foodz.');
    return;
  }
  set({ help: null });
  if (permission === 'prompt') {
    set({ phase: 'explaining' });
    return;
  }
  void find();
}

async function find() {
  set({ phase: 'finding', help: null, dockReason: null });
  coarseSince = null;
  const firstFix = new Promise<Fix | null>((resolve) => {
    resolveFirstFix = resolve;
  });
  startWatching();
  findTimers.push(
    setTimeout(() => {
      if (get().phase !== 'finding') return;
      // No good fix at all: "approximate" when only coarse ones came, "not found" otherwise.
      failFinding(coarseSince === null ? 'notFound' : 'approximate');
    }, NOT_FOUND_AFTER_MS),
  );
  const fix = await firstFix;
  resolveFirstFix = null;
  clearFindTimers();
  if (!fix || get().phase !== 'finding') return;
  set({ lastFix: fix });
  await sendOnline(fix);
}

async function sendOnline(fix: Fix | undefined) {
  const point = fix ? toPoint(fix) : undefined;
  const body = point
    ? {
        online: true,
        point: locationsBody([point]).points[0],
      }
    : { online: true };
  const answer = await availabilityRequest(body);
  if (get().phase !== 'finding') return;
  if (!answer) {
    stopWatching();
    set({ phase: 'offline', dockReason: { text: PARTNER_COPY.couldNotGoOnline, kind: 'failed' } });
    announce(PARTNER_COPY.couldNotGoOnline);
    return;
  }
  if (answer.status === 200) {
    const availability = field(answer.body, 'availability');
    const since = field(availability, 'onlineSince');
    const at = field(answer.body, 'at');
    if (point) {
      lastQueued = point;
    }
    set({
      phase: 'online',
      onlineSince: typeof since === 'string' ? since : new Date().toISOString(),
      help: null,
      notice: null,
      otherDevice: false,
      lastAcceptedAt: typeof at === 'string' && point ? at : get().lastAcceptedAt,
      lastSentAt: point ? Date.now() : null,
      ...(typeof at === 'string' ? { offset: serverOffset(at, Date.now()) } : {}),
    });
    announce(PARTNER_COPY.online);
    void lockScreen();
    return;
  }
  stopWatching();
  const code = codeOf(answer.body);
  if (answer.status === 429) {
    const seconds = retryAfterSeconds(answer.retryAfter, answer.body);
    const text = tooManySwitches(seconds);
    set({
      phase: 'offline',
      waitUntil: Date.now() + seconds * 1000,
      dockReason: { text, kind: 'wait' },
    });
    announce(text);
    return;
  }
  if (code === 'LOW_ACCURACY') {
    set({ phase: 'offline', help: 'approximate' });
    return;
  }
  if (code === 'PARTNER_SUSPENDED') {
    suspend('event');
    return;
  }
  if (code === 'NOT_APPROVED' || answer.status === 401) {
    set({ phase: 'offline' });
    window.location.reload();
    return;
  }
  set({ phase: 'offline', dockReason: { text: PARTNER_COPY.couldNotGoOnline, kind: 'failed' } });
  announce(PARTNER_COPY.couldNotGoOnline);
}

/** The rate limit's minutes, refreshed silently; the button comes back by itself. */
export function tickWait(now = Date.now()) {
  const state = get();
  if (!state.waitUntil) return;
  if (now >= state.waitUntil) {
    set({ waitUntil: null, dockReason: null });
    return;
  }
  set({ dockReason: { text: tooManySwitches((state.waitUntil - now) / 1000), kind: 'wait' } });
}

// ------------------------------------------------------------------ going offline (design 6.5)

async function deliverOffline(keepalive: boolean): Promise<boolean> {
  const answer = await availabilityRequest({ online: false }, keepalive);
  return answer !== null && answer.status < 500;
}

/** "Go offline": everything stops first, then the server is told (P12.1, P12.2). */
export async function goOffline({
  help = null,
  announceText = PARTNER_COPY.offline,
}: { help?: HelpCard | null; announceText?: string | null } = {}) {
  stopEverything();
  set({ phase: 'offline', onlineSince: null, help, notice: null, pinned: null });
  if (announceText) announce(announceText);
  if (!navigator.onLine) {
    offlinePending = true;
    set({ pinned: 'offlineOnPhone' });
    announce(PARTNER_COPY.offlineOnPhone);
    return;
  }
  const delivered = await deliverOffline(false);
  if (!delivered) {
    offlinePending = true;
    set({ pinned: 'offlineOnPhone' });
  }
}

// ------------------------------------------------------------------ the page's life

async function deliverPendingOffline() {
  const delivered = await deliverOffline(false);
  if (!delivered) return;
  offlinePending = false;
  if (get().pinned === 'offlineOnPhone') set({ pinned: null });
}

function onBrowserOnline() {
  if (offlinePending) void deliverPendingOffline();
  if (get().phase === 'online') {
    markConnected();
    scheduleSend(0);
  }
  if (get().dockReason?.kind === 'connection') set({ dockReason: null });
}

function onBrowserOffline() {
  if (get().phase === 'online') markDisconnected();
}

function onVisibility() {
  const state = get();
  if (document.visibilityState === 'hidden') {
    if (state.phase === 'online' && !state.isDemo) set({ hiddenSince: Date.now() });
    void releaseScreen();
    return;
  }
  if (state.phase !== 'online') return;
  void lockScreen();
  if (state.hiddenSince && !state.isDemo) {
    const minutes = (Date.now() - state.hiddenSince) / 60_000;
    set({ hiddenSince: null });
    if (minutes >= 1) {
      const text = `Your location wasn't shared for ${Math.round(minutes)} min while Foodz was in the background.`;
      set({ notice: { text, tone: 'muted' } });
      announce(text);
    }
  }
}

function onPageHide() {
  const state = get();
  // P12.4: closing the app while online tells the server; the demo's state is everyone's.
  if (state.phase === 'online' && !state.isDemo) {
    stopWatching();
    void deliverOffline(true);
  }
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('online', onBrowserOnline);
  window.addEventListener('offline', onBrowserOffline);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
}

export interface HomeFacts {
  partnerId: string;
  isDemo: boolean;
  online: boolean;
  onlineSince: string | null;
  lastPointAt: string | null;
  onThisDevice: boolean;
  /** The last automatic offline's words, until he goes online again. */
  lastOffline: { words: string; ifDisconnected: string | null } | null;
  /** The server's clock when this state was read. */
  asOf: string;
}

/**
 * The engine takes the server's state when the app opens (or another partner signs in). A
 * session that was sharing within the last 10 minutes resumes by itself when the permission is
 * still granted (P12.4).
 */
export async function adoptServerState(facts: HomeFacts) {
  listen();
  const state = get();
  if (state.partnerId === facts.partnerId && (state.phase !== 'offline' || state.suspended)) return;
  stopEverything();
  sharingStore.setState(() => ({
    ...initial,
    partnerId: facts.partnerId,
    isDemo: facts.isDemo,
    offset: serverOffset(facts.asOf, Date.now()),
    connection: navigator.onLine ? 'online' : 'offline',
    notice: facts.lastOffline ? { text: facts.lastOffline.words, tone: 'warning' } : null,
  }));
  if (!facts.online) return;
  if (facts.isDemo) {
    set({ phase: 'online', onlineSince: facts.onlineSince, lastAcceptedAt: facts.lastPointAt });
    return;
  }
  if (!facts.onThisDevice) {
    set({ otherDevice: true, notice: { text: PARTNER_COPY.otherDevice, tone: 'muted' } });
    return;
  }
  const permission = await permissionState();
  if (permission !== 'granted') {
    // P12.3: the permission went while he was away.
    void goOffline({ help: 'turnedOff', announceText: null });
    return;
  }
  set({
    phase: 'online',
    onlineSince: facts.onlineSince,
    lastAcceptedAt: facts.lastPointAt,
    notice: { text: PARTNER_COPY.resumed, tone: 'success' },
  });
  announce(PARTNER_COPY.resumed);
  startWatching();
  void lockScreen();
}

/** The resumed notice leaves after 8 s (design 6.3). */
export function clearNotice() {
  set({ notice: null });
}

/** For stories and tests: put the engine in a given state. */
export function setSharingStateForPreview(patch: Partial<SharingState>) {
  set(patch);
}

/**
 * Location is offered only to `/partner` and checkout documents (Permissions-Policy). Arriving
 * here by a client-side navigation (after signing in, or from a storefront link) keeps the
 * previous document and its policy, which blocks location. Chromium reports that; the app then
 * loads itself once as a partner document. Browsers that don't report it don't apply it.
 */
export function locationBlockedByPolicy(): boolean {
  const policy: unknown = Reflect.get(document, 'featurePolicy');
  if (typeof policy !== 'object' || policy === null) return false;
  const allows: unknown = Reflect.get(policy, 'allowsFeature');
  return typeof allows === 'function' && allows.call(policy, 'geolocation') === false;
}

/** Whether anything still reads the position (stories and tests). */
export const isWatching = () => watchId !== null;
