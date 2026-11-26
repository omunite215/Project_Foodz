import { createStore } from '@tanstack/react-store';
import {
  DISPATCH_DEFAULTS,
  type AcceptResult,
  type GiveBackReason,
  type OfferDetail,
  type OfferEndedWhy,
  type OfferGoneWhy,
  type PartnerDispatchState,
} from '@/server/modules/delivery/schema';
import type {
  HandOverResult,
  PartnerDeliveryF8,
  ProblemKind,
} from '@/server/modules/tracking/schema';
import type { DeliveryChangedEvent } from '@/lib/realtime/events';
import { announce } from '@/lib/announce';
import { serverOffset } from '@/lib/board/clock';
import { retryAfterSeconds } from './location-queue';
import {
  alertOnce,
  CHANGE_VIBRATION,
  OFFER_REPEAT_MS,
  offerSoundReady,
  vibrate,
} from './offer-sound';
import { DELIVERY_COPY, earnedOf } from './delivery-text';
import {
  endedNotice,
  gaveBackText,
  goneNotice,
  OFFER_COPY,
  type OfferNoticeWords,
  releaseNotice,
  yoursText,
} from './offer-text';
import { onStatusEvent, setHoldingOrder } from './sharing';
import { waitWords } from './text';

/*
 * Offers, the order he holds, and what happens to it (F7 design 1), in one engine that outlives
 * a page: an offer can arrive on Home or Profile, and its countdown, sound and answer must carry
 * on across both. Every figure and word on the card is the server's (P20.5); the countdown runs
 * on the server's clock through the offset of its last answer (P21.1). An offer reaches the
 * phone by `offer.created` or by the 5-second poll (P28.6); its end by `offer.ended`, the
 * answer to Accept or Decline, the poll, or the clock running out plus the 2-second grace.
 */

export type CardPhase = 'open' | 'accepting' | 'accepted' | 'practiceAccepted' | 'offlineExpired';

export interface OfferCard {
  offerId: string;
  expiresAt: string;
  detail: OfferDetail | null;
  /** The details didn't arrive in 5 s: the card says so and accepting stays blocked (P35.6). */
  detailFailed: boolean;
  phase: CardPhase;
  /** Accept pressed without a connection: retried every 2 s until the grace ends (P28.2). */
  waitingForConnection: boolean;
  orderNumber: string | null;
  /** The seconds the card started with, for the ring before the details say the offer's length. */
  openedWith: number;
}

export interface DispatchNotice {
  id: number;
  words: OfferNoticeWords;
  /** Notices that change his job stay until dismissed (D12); offer endings leave after 6 s. */
  persistent: boolean;
  /** A release notice from the server's state: its time, to remember a dismissal on this phone. */
  key: string | null;
}

/** How the card last closed: where focus goes next (design, Focus). */
export type CardClose = { id: number; how: 'ended' | 'accepted' | 'declined' | 'waiting' };

export interface DispatchState {
  partnerId: string | null;
  isDemo: boolean;
  card: OfferCard | null;
  lastClose: CardClose | null;
  notice: DispatchNotice | null;
  delivery: PartnerDeliveryF8 | null;
  /** F8 P41.3: his own right code; the sheet shows the pay, then Home (never the customer). */
  delivered: {
    orderNumber: string;
    pay: string;
    /** F9 P51.3: today's figures read with the hand-over, so they include this one. */
    today: { earnedCents: number; deliveries: number } | null;
  } | null;
  /** F8 P43.4: staff asked him to wait; the waiting card says so until the clock restarts. */
  askedToWaitAt: string | null;
  missedInRow: number;
  howOffersWork: PartnerDispatchState['howOffersWork'];
  /** Server clock minus the device's. */
  offset: number;
  /** The shared AudioContext can play without a tap. */
  soundReady: boolean;
  practice: { pending: boolean; limit: string | null };
  /** A "kitchen moved it back" notice applies to this delivery version (P31). */
  movedBackAt: number | null;
}

const initial: DispatchState = {
  partnerId: null,
  isDemo: false,
  card: null,
  lastClose: null,
  notice: null,
  delivery: null,
  delivered: null,
  askedToWaitAt: null,
  missedInRow: 0,
  howOffersWork: {
    reachesKm: [2, 4, 8],
    offerSeconds: DISPATCH_DEFAULTS.offerSeconds,
    missLimit: 3,
  },
  offset: 0,
  soundReady: false,
  practice: { pending: false, limit: null },
  movedBackAt: null,
};

export const dispatchStore = createStore<DispatchState>(initial);

const get = () => dispatchStore.state;
const set = (patch: Partial<DispatchState>) =>
  dispatchStore.setState((current) => ({ ...current, ...patch }));
const setCard = (patch: Partial<OfferCard>) => {
  const card = get().card;
  if (card) set({ card: { ...card, ...patch } });
};

export const GRACE_MS = DISPATCH_DEFAULTS.graceSeconds * 1000;
export const DETAIL_TIMEOUT_MS = 5_000;
export const RETRY_MS = 2_000;
export const NOTICE_MS = 6_000;
/** The pick-up screen replaces "Order 1042 is yours" after this (design 1.5). */
export const ACCEPTED_HOLD_MS = 1_200;

const BASE = '/api/v1/partner';

// ------------------------------------------------------------------ requests

export interface Answer {
  status: number;
  body: unknown;
  retryAfter: string | null;
}

const browser = () => typeof window !== 'undefined';
/** False only when the browser says it has no network (Node and old browsers count as online). */
const deviceOnline = () => {
  const onLine: unknown =
    typeof navigator === 'undefined' ? true : Reflect.get(navigator, 'onLine');
  return onLine !== false;
};

/**
 * Why a request got no answer (gate S8): `network` when `fetch` failed before any response (the
 * request most likely never reached the server), `timeout` when the 8 s ran out (it may have).
 */
type Sent = { answer: Answer } | { failure: 'network' | 'timeout' };

async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 8_000,
): Promise<Answer | null> {
  const sent = await send(method, path, body, timeoutMs);
  return 'answer' in sent ? sent.answer : null;
}

async function send(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 8_000,
): Promise<Sent> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const common: RequestInit = {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    };
    const response = await fetch(
      path,
      method === 'POST'
        ? {
            ...common,
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          }
        : { ...common, method },
    );
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return {
      answer: {
        status: response.status,
        body: parsed,
        retryAfter: response.headers.get('retry-after'),
      },
    };
  } catch {
    return { failure: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined;
export const codeOf = (body: unknown) => {
  const code = field(body, 'code');
  return typeof code === 'string' ? code : null;
};
const whyOf = (body: unknown): unknown => field(field(body, 'details'), 'why');

const GONE_WHY = new Set<string>(['expired', 'withdrawn', 'taken', 'order-changed']);
const isGoneWhy = (value: unknown): value is OfferGoneWhy =>
  typeof value === 'string' && GONE_WHY.has(value);

/** Signed out or suspended: the shell's cover takes over (F6 design 5.9). */
function refusedSession(answer: Answer): boolean {
  if (codeOf(answer.body) === 'PARTNER_SUSPENDED') {
    onStatusEvent('SUSPENDED');
    return true;
  }
  return answer.status === 401;
}

// ------------------------------------------------------------------ the clock

export const serverNowMs = (deviceNow = Date.now()) => deviceNow + get().offset;

/** Milliseconds of the card's life left, the grace included, on the server's clock. */
export function msToGraceEnd(expiresAt: string, offset: number, deviceNow = Date.now()): number {
  return Date.parse(expiresAt) + GRACE_MS - (deviceNow + offset);
}

function adoptServerTime(serverTime: unknown, sentAt: number) {
  if (typeof serverTime !== 'string') return;
  set({ offset: serverOffset(serverTime, (sentAt + Date.now()) / 2) });
}

// ------------------------------------------------------------------ notices

let noticeId = 1;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const DISMISSED_KEY = 'foodz.partner-dismissed-notice';

function rememberDismissed(key: string) {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, key);
  } catch {
    // Blocked: it may show once more after a reload.
  }
}

function wasDismissed(key: string): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === key;
  } catch {
    return false;
  }
}

/** Shows a notice in the page's notice slot and reads it once (design 1.7, 1.15). */
export function showNotice(
  words: OfferNoticeWords,
  { persistent = false, key = null }: { persistent?: boolean; key?: string | null } = {},
) {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  set({ notice: { id: noticeId++, words, persistent, key } });
  announce(words.text);
  if (!persistent) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      set({ notice: null });
    }, NOTICE_MS);
  }
}

export function dismissNotice() {
  const notice = get().notice;
  if (notice?.key) rememberDismissed(notice.key);
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  set({ notice: null, movedBackAt: notice?.words.icon === 'clock' ? null : get().movedBackAt });
}

// ------------------------------------------------------------------ alerting (P19)

let alertTimer: ReturnType<typeof setInterval> | null = null;

function startAlerting() {
  stopAlerting();
  if (!browser()) return;
  alertOnce();
  alertTimer = setInterval(alertOnce, OFFER_REPEAT_MS);
}

function stopAlerting() {
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = null;
}

/** The first touch on the handle, the track or Decline stops the sound and buzz (P19.2). */
export const silenceOffer = () => stopAlerting();

export function refreshSoundState() {
  set({ soundReady: offerSoundReady() });
}

// ------------------------------------------------------------------ the card

let endTimer: ReturnType<typeof setTimeout> | null = null;
let detailTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let acceptedTimer: ReturnType<typeof setTimeout> | null = null;
let closeId = 1;
/** Offers already closed on this phone: a late event or poll never reopens one. */
const ended = new Set<string>();
/** Accept pressed (in time): an expiry then isn't a miss (P28.2). */
let pressedAt: string | null = null;

function clearCardTimers() {
  for (const timer of [endTimer, detailTimer, retryTimer, acceptedTimer]) {
    if (timer) clearTimeout(timer);
  }
  endTimer = null;
  detailTimer = null;
  retryTimer = null;
  acceptedTimer = null;
}

function closeCard(how: CardClose['how']) {
  const card = get().card;
  stopAlerting();
  clearCardTimers();
  if (card) ended.add(card.offerId);
  pressedAt = null;
  set({ card: null, lastClose: { id: closeId++, how } });
}

/** The clock and its grace ran out with nothing heard from the server (P21.3, P24.2). */
function timeRanOut() {
  const card = get().card;
  if (!card || card.phase !== 'open') return;
  endWith('expired');
}

function scheduleEnd(card: OfferCard) {
  if (endTimer) clearTimeout(endTimer);
  const wait = Math.max(0, msToGraceEnd(card.expiresAt, get().offset));
  endTimer = setTimeout(timeRanOut, wait);
}

/**
 * An offer reached the phone (`offer.created`, the poll, or a practice offer). Nothing shows
 * while he holds an order, for an offer this phone already closed, or once its time is up.
 */
export function openOffer(offerId: string, expiresAt: string, detail: OfferDetail | null = null) {
  const state = get();
  if (state.delivery || ended.has(offerId)) return;
  if (state.card?.offerId === offerId) {
    if (detail && !state.card.detail) setCard({ detail, detailFailed: false });
    return;
  }
  if (state.card && state.card.phase !== 'open') return;
  if (msToGraceEnd(expiresAt, state.offset) <= 0) return;
  if (state.card) closeCard('ended');
  clearCardTimers();
  pressedAt = null;
  const left = Math.max(0, Math.floor((Date.parse(expiresAt) - serverNowMs()) / 1000));
  const card: OfferCard = {
    offerId,
    expiresAt,
    detail,
    detailFailed: false,
    phase: 'open',
    waitingForConnection: false,
    orderNumber: null,
    openedWith: left,
  };
  set({ card, practice: { ...state.practice, pending: false } });
  scheduleEnd(card);
  startAlerting();
  void markSeen(offerId);
  if (!detail) void loadDetail(offerId);
}

const DETAIL_ATTEMPTS = 3;

async function loadDetail(offerId: string, attempt = 1): Promise<void> {
  if (attempt === 1) {
    if (detailTimer) clearTimeout(detailTimer);
    detailTimer = setTimeout(() => {
      detailTimer = null;
      const card = get().card;
      if (card?.offerId === offerId && !card.detail) setCard({ detailFailed: true });
    }, DETAIL_TIMEOUT_MS);
  }
  const answer = await request('GET', `${BASE}/offers/${encodeURIComponent(offerId)}`);
  const card = get().card;
  if (card?.offerId !== offerId) return;
  if (answer?.status === 200 && typeof field(answer.body, 'offerId') === 'string') {
    // The route answers the card's DTO; the type is the server's own.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    setCard({ detail: answer.body as OfferDetail, detailFailed: false });
    if (detailTimer) clearTimeout(detailTimer);
    detailTimer = null;
    return;
  }
  if (answer && refusedSession(answer)) return;
  if (answer?.status === 404) {
    // No longer his and open: the poll tells how it ended, if anything.
    void pollCurrent();
    return;
  }
  if (attempt >= DETAIL_ATTEMPTS) return;
  setTimeout(() => void loadDetail(offerId, attempt + 1), 1_500);
}

async function markSeen(offerId: string) {
  await request('POST', `${BASE}/offers/${encodeURIComponent(offerId)}/seen`, {});
}

/** The card closes with the ending's notice; a timed-out automatic offer counts a miss. */
function endWith(why: OfferEndedWhy) {
  const card = get().card;
  if (!card) return;
  const pressed = pressedAt !== null;
  const automatic = card.detail?.kind === 'auto' || card.detail === null;
  closeCard('ended');
  if (why === 'expired' && automatic && !pressed && !get().isDemo) {
    set({ missedInRow: get().missedInRow + 1 });
  }
  const words = endedNotice(why);
  if (words) showNotice(words);
}

/** `offer.ended`: it ended without this phone's answer (P24). */
export function onOfferEnded(event: { offerId: string; why: OfferEndedWhy }) {
  const card = get().card;
  if (card?.offerId !== event.offerId) {
    ended.add(event.offerId);
    return;
  }
  if (card.phase === 'accepted' || card.phase === 'practiceAccepted') return;
  if (card.phase === 'offlineExpired') return;
  endWith(event.why);
}

// ------------------------------------------------------------------ accepting (P22, P28.2)

function acceptedWith(result: AcceptResult) {
  const card = get().card;
  if (!card) return;
  stopAlerting();
  if (endTimer) clearTimeout(endTimer);
  if (retryTimer) clearTimeout(retryTimer);
  endTimer = null;
  retryTimer = null;
  set({ missedInRow: 0 });
  if (card.detail?.kind === 'practice' || result.orderNumber === 'practice') {
    setCard({ phase: 'practiceAccepted', waitingForConnection: false });
    announce(OFFER_COPY.practiceAccepted);
    return;
  }
  setCard({ phase: 'accepted', waitingForConnection: false, orderNumber: result.orderNumber });
  announce(yoursText(result.orderNumber));
  setHoldingOrder(true);
  acceptedTimer = setTimeout(() => {
    acceptedTimer = null;
    void (async () => {
      await loadDelivery();
      if (get().card?.phase === 'accepted') closeCard('accepted');
    })();
  }, ACCEPTED_HOLD_MS);
}

function isAcceptResult(body: unknown): body is AcceptResult {
  return (
    typeof field(body, 'deliveryId') === 'string' && typeof field(body, 'orderNumber') === 'string'
  );
}

async function sendAccept(offerId: string): Promise<void> {
  const answer = await request('POST', `${BASE}/offers/${encodeURIComponent(offerId)}/accept`, {});
  const card = get().card;
  if (card?.offerId !== offerId || card.phase !== 'accepting') return;
  if (answer?.status === 200 && isAcceptResult(answer.body)) {
    acceptedWith(answer.body);
    return;
  }
  if (!answer || answer.status >= 500 || answer.status === 429) {
    retryOrGiveUp(offerId);
    return;
  }
  if (refusedSession(answer)) {
    closeCard('ended');
    return;
  }
  const code = codeOf(answer.body);
  if (code === 'OFFER_GONE') {
    const why = whyOf(answer.body);
    closeCard('ended');
    showNotice(goneNotice(isGoneWhy(why) ? why : 'withdrawn'));
    return;
  }
  if (code === 'PARTNER_BUSY') {
    // He already holds an order (another tab took one): that's the screen to show.
    closeCard('ended');
    void loadDelivery();
    return;
  }
  // Not offerable (offline) or not found: F6's screens say why.
  closeCard('ended');
}

function retryOrGiveUp(offerId: string) {
  const card = get().card;
  if (!card) return;
  setCard({ waitingForConnection: true });
  const left = msToGraceEnd(card.expiresAt, get().offset);
  if (left <= 0) {
    offlineExpired();
    return;
  }
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      void sendAccept(offerId);
    },
    Math.min(RETRY_MS, left),
  );
}

/** The press couldn't get through in time (design 1.7's last row); never counted as a miss. */
function offlineExpired() {
  const card = get().card;
  if (!card) return;
  stopAlerting();
  clearCardTimers();
  ended.add(card.offerId);
  if (pressedAt) queueLateAccept(card.offerId, pressedAt);
  setCard({ phase: 'offlineExpired', waitingForConnection: false });
  announce(OFFER_COPY.offlineExpired);
}

/** Slide past 80%, two taps, or a keyboard or assistive activation (P22). */
export function acceptOffer() {
  const card = get().card;
  if (!card || card.phase !== 'open' || !card.detail) return;
  if (msToGraceEnd(card.expiresAt, get().offset) <= 0) return;
  stopAlerting();
  pressedAt = new Date(serverNowMs()).toISOString();
  // The clock's end no longer closes it: the answer, or the retries' end, does.
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  setCard({ phase: 'accepting', waitingForConnection: !deviceOnline() });
  if (!deviceOnline()) {
    retryOrGiveUp(card.offerId);
    return;
  }
  void sendAccept(card.offerId);
}

// ------------------------------------------------------------------ declining (P23, P28.4)

interface Queued {
  offerId: string;
  pressedAt: string;
  kind: 'decline' | 'late-accept';
}
let queued: Queued[] = [];

function queueLateAccept(offerId: string, at: string) {
  queued = [
    ...queued.filter((item) => item.offerId !== offerId),
    { offerId, pressedAt: at, kind: 'late-accept' },
  ];
}

async function flushQueue() {
  if (!deviceOnline() || queued.length === 0) return;
  const sending = queued;
  queued = [];
  const answers = await Promise.all(
    sending.map((item) =>
      request('POST', `${BASE}/offers/${encodeURIComponent(item.offerId)}/${item.kind}`, {
        pressedAt: item.pressedAt,
      }),
    ),
  );
  sending.forEach((item, index) => {
    const answer = answers[index];
    if (!answer || answer.status >= 500) queued.push(item);
  });
}

/** One tap, no reason, no confirmation: the card closes at once (design 1.6). */
export function declineOffer() {
  const card = get().card;
  if (!card || card.phase !== 'open') return;
  const at = new Date(serverNowMs()).toISOString();
  closeCard('declined');
  set({ missedInRow: 0 });
  announce(OFFER_COPY.declined);
  if (!deviceOnline()) {
    queued = [...queued, { offerId: card.offerId, pressedAt: at, kind: 'decline' }];
    return;
  }
  void (async () => {
    const answer = await request(
      'POST',
      `${BASE}/offers/${encodeURIComponent(card.offerId)}/decline`,
      {},
    );
    if (!answer || answer.status >= 500) {
      queued = [...queued, { offerId: card.offerId, pressedAt: at, kind: 'decline' }];
    }
  })();
}

/** "Back to waiting" after a practice accept or a press that couldn't get through. */
export function backToWaiting() {
  closeCard('waiting');
}

// ------------------------------------------------------------------ the poll (P28.6)

let polling = false;

/** `GET /offers/current`: a card within 5 s of an offer without realtime; ends a lost one. */
export async function pollCurrent(): Promise<void> {
  if (polling || get().delivery) return;
  polling = true;
  const sentAt = Date.now();
  try {
    const answer = await request('GET', `${BASE}/offers/current`);
    if (!answer) return;
    if (answer.status !== 200) {
      refusedSession(answer);
      return;
    }
    adoptServerTime(field(answer.body, 'serverTime'), sentAt);
    const offer = field(answer.body, 'offer');
    const card = get().card;
    if (offer && typeof field(offer, 'offerId') === 'string') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const detail = offer as OfferDetail;
      openOffer(detail.offerId, detail.expiresAt, detail);
      return;
    }
    // No open offer: a card still counting down ended without word reaching the phone.
    if (card?.phase === 'open') {
      if (msToGraceEnd(card.expiresAt, get().offset) <= 0) endWith('expired');
      else closeCard('ended');
    }
  } finally {
    polling = false;
  }
}

// ------------------------------------------------------------------ the order he holds (P29 to P31)

function isDelivery(body: unknown): body is PartnerDeliveryF8 {
  return (
    typeof field(body, 'deliveryId') === 'string' && typeof field(body, 'orderNumber') === 'string'
  );
}

let loadingDelivery: Promise<PartnerDeliveryF8 | null | undefined> | null = null;
/** He gave the order back himself: the release that follows needs no notice. */
let ownRelease: string | null = null;
/** His code is on its way to the server: its own "delivered" event waits for the answer. */
let handingOver: string | null = null;

/** `GET /deliveries/current`; undefined when it couldn't be read. */
export function loadDelivery(): Promise<PartnerDeliveryF8 | null | undefined> {
  loadingDelivery ??= (async () => {
    try {
      const answer = await request('GET', `${BASE}/deliveries/current`);
      if (!answer) return undefined;
      if (answer.status !== 200) {
        refusedSession(answer);
        return undefined;
      }
      const before = get().delivery;
      const next = isDelivery(answer.body) ? answer.body : null;
      if (next && before && next.deliveryId === before.deliveryId) {
        // The kitchen moved it back while he holds it: same status, a newer version (P31).
        if (
          next.status === 'ASSIGNED' &&
          before.status === 'ASSIGNED' &&
          next.version > before.version
        ) {
          set({ movedBackAt: next.version });
          showNotice(releaseNotice('movedBack', next.orderNumber), { persistent: true });
          vibrate(CHANGE_VIBRATION);
        }
      }
      set({ delivery: next });
      setHoldingOrder(next !== null);
      if (next && get().card?.phase === 'open') closeCard('ended');
      if (before && !next) {
        forgetMapsWarned(before.deliveryId);
        set({ askedToWaitAt: null });
        void released(before);
      }
      return next;
    } finally {
      loadingDelivery = null;
    }
  })();
  return loadingDelivery;
}

/** His order went away: why, from his state (P31). Never names staff. */
async function released(before: PartnerDeliveryF8) {
  if (ownRelease === before.deliveryId) {
    ownRelease = null;
    return;
  }
  vibrate(CHANGE_VIBRATION);
  const answer = await request('GET', `${BASE}/me`);
  const dispatch = field(answer?.body, 'dispatch');
  const notice = field(dispatch, 'notice');
  const kind = field(notice, 'kind');
  const at = field(notice, 'at');
  if (field(answer?.body, 'screen') === 'suspended') {
    onStatusEvent('SUSPENDED');
    return;
  }
  if (
    kind === 'takenOff' ||
    kind === 'cancelled' ||
    kind === 'handedOver' ||
    kind === 'movedBack' ||
    kind === 'confirmed' ||
    kind === 'cancelledBringBack' ||
    kind === 'markedDelivered'
  ) {
    showNotice(
      releaseNotice(kind, before.orderNumber, { ...endingExtra(before), feeCents: feeOf(notice) }),
      { persistent: true, key: typeof at === 'string' ? at : null },
    );
  }
}

/**
 * P57.3: the fee he keeps after "Cancel and bring it back" isn't on the event (no amounts on
 * realtime); his partner state has it, so the notice gains its sentence once that's read.
 */
async function addKeptFee(held: PartnerDeliveryF8, key: string) {
  const answer = await request('GET', `${BASE}/me`);
  const fee = feeOf(field(field(answer?.body, 'dispatch'), 'notice'));
  const current = get().notice;
  if (fee === null || current?.key !== key) return;
  showNotice(
    releaseNotice('cancelledBringBack', held.orderNumber, { ...endingExtra(held), feeCents: fee }),
    { persistent: true, key },
  );
}

/** The pay and the kitchen for F8's endings, from what he held (never the customer). */
const endingExtra = (held: PartnerDeliveryF8) => ({
  pay: held.payText,
  kitchen: { phone: held.kitchen.phone, address: DELIVERY_COPY.kitchenAddress },
});

/** `delivery.changed` on his channel (P31, F8 P44.3): read what he holds now. */
export function onDeliveryChanged(event: DeliveryChangedEvent) {
  const held = get().delivery;
  // F8 2.10: staff finished or stopped it. One buzz, then Home with a notice that stays.
  if (
    held &&
    (event.notice === 'confirmed' ||
      event.notice === 'cancelledBringBack' ||
      event.notice === 'markedDelivered')
  ) {
    ownRelease = held.deliveryId;
    endHeld(held);
    vibrate(CHANGE_VIBRATION);
    showNotice(releaseNotice(event.notice, held.orderNumber, endingExtra(held)), {
      persistent: true,
      key: event.at,
    });
    if (event.notice === 'cancelledBringBack') void addKeptFee(held, event.at);
    return;
  }
  if (event.notice === 'askedToWait') {
    vibrate(CHANGE_VIBRATION);
    set({ askedToWaitAt: event.at });
  }
  if (event.status === 'DELIVERED' && held) {
    // His own code: the event can beat the answer to the phone; the answer ends it, with the
    // pay. Another device's: nothing of the customer stays, and no second notice.
    if (handingOver === held.deliveryId) return;
    ownRelease = held.deliveryId;
    endHeld(held);
    return;
  }
  void loadDelivery();
}

/** The delivery ended on this phone: every trace of the customer goes (P41.3, P44.2). */
function endHeld(held: PartnerDeliveryF8) {
  set({ delivery: null, movedBackAt: null, askedToWaitAt: null });
  setHoldingOrder(false);
  forgetMapsWarned(held.deliveryId);
}

// ------------------------------------------------------------------ F8: his own steps (P38 to P43)

export type StepOutcome = 'done' | 'offline' | 'gone' | 'limit' | 'failed';

const WARNED_KEY = 'foodz.partner-maps-warned';

/** U10: the "Open another maps app?" warning shows once per delivery on this phone. */
export function mapsWarned(deliveryId: string): boolean {
  try {
    return window.localStorage.getItem(WARNED_KEY) === deliveryId;
  } catch {
    return false;
  }
}

export function rememberMapsWarned(deliveryId: string) {
  try {
    window.localStorage.setItem(WARNED_KEY, deliveryId);
  } catch {
    // Blocked: the warning may show again for this delivery.
  }
}

/** The delivery id only, gone when the delivery ends (design open item 10). */
function forgetMapsWarned(deliveryId: string) {
  if (!browser()) return;
  try {
    if (window.localStorage.getItem(WARNED_KEY) === deliveryId) {
      window.localStorage.removeItem(WARNED_KEY);
    }
  } catch {
    // Nothing stored.
  }
}

const deliveryPath = (deliveryId: string, step: string) =>
  `${BASE}/deliveries/${encodeURIComponent(deliveryId)}/${step}`;

/** "Picked up" (P38): the server makes a repeat one pickup; the kitchen may have moved it back. */
export async function confirmPickUp(confirmFar: boolean): Promise<StepOutcome | 'notReady'> {
  const held = get().delivery;
  if (!held) return 'gone';
  if (!deviceOnline()) return 'offline';
  const answer = await request(
    'POST',
    deliveryPath(held.deliveryId, 'picked-up'),
    confirmFar ? { confirmFar: true } : {},
  );
  if (!answer || answer.status >= 500) return 'offline';
  if (answer.status === 200) return 'done';
  if (refusedSession(answer)) return 'failed';
  if (answer.status === 429) return 'limit';
  const code = codeOf(answer.body);
  if (code === 'ORDER_NOT_READY') {
    void loadDelivery();
    return 'notReady';
  }
  if (code === 'NOT_ASSIGNED' || answer.status === 404) {
    void loadDelivery();
    return 'gone';
  }
  return 'failed';
}

/**
 * `offline`: the code never left the phone, so it may be sent again. `unavailable`: a server
 * error, or no answer in time (it may have been checked): never sent again by itself (gate S8).
 */
export type HandOverOutcome =
  | { kind: 'delivered'; pay: string }
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'locked' }
  | { kind: 'cash' }
  | { kind: 'offline' | 'unavailable' | 'gone' | 'limit' | 'failed' };

/** The hand-over answer's `today`, or null when it lacks it (the line is then left out). */
function todayOf(value: unknown): { earnedCents: number; deliveries: number } | null {
  const earnedCents = field(value, 'earnedCents');
  const deliveries = field(value, 'deliveries');
  return typeof earnedCents === 'number' && typeof deliveries === 'number'
    ? { earnedCents, deliveries }
    : null;
}

/** P57.3: the fee he keeps on a cancellation after pickup, from his partner state. */
function feeOf(notice: unknown): number | null {
  const fee = field(notice, 'feeCents');
  return typeof fee === 'number' && fee > 0 ? fee : null;
}

function handOverResult(body: unknown): HandOverResult | null {
  const outcome = field(body, 'outcome');
  const payWords = field(body, 'payWords');
  const triesLeft = field(body, 'triesLeft');
  if (outcome === 'delivered' && typeof payWords === 'string') {
    return { outcome, payWords, today: todayOf(field(body, 'today')) };
  }
  if (outcome === 'wrong' && typeof triesLeft === 'number') return { outcome, triesLeft };
  if (outcome === 'locked') return { outcome };
  return null;
}

/** The code (P41, P42): the server counts the tries and says what happened. */
export async function handOverCode(
  code: string,
  cashCollected: boolean,
  confirmFar: boolean,
): Promise<HandOverOutcome> {
  const held = get().delivery;
  if (!held) return { kind: 'gone' };
  if (!deviceOnline()) return { kind: 'offline' };
  handingOver = held.deliveryId;
  const sent = await send('POST', deliveryPath(held.deliveryId, 'hand-over'), {
    code,
    ...(held.payment.kind === 'cash' ? { cashCollected } : {}),
    ...(confirmFar ? { confirmFar: true } : {}),
  }).finally(() => {
    handingOver = null;
  });
  if ('failure' in sent) return { kind: sent.failure === 'network' ? 'offline' : 'unavailable' };
  const answer = sent.answer;
  // A 503 (the code fence is down, fail-closed) or any other server error.
  if (answer.status >= 500) return { kind: 'unavailable' };
  if (answer.status === 200) {
    const result = handOverResult(answer.body);
    if (!result) return { kind: 'failed' };
    if (result.outcome === 'delivered') {
      const pay = earnedOf(result.payWords, held.payText);
      ownRelease = held.deliveryId;
      // The delivered moment first, so the sheet goes straight from the code to the pay.
      set({ delivered: { orderNumber: held.orderNumber, pay, today: result.today ?? null } });
      if (get().delivery?.deliveryId === held.deliveryId) endHeld(held);
      return { kind: 'delivered', pay };
    }
    const current = get().delivery;
    if (!current) return { kind: 'gone' };
    const otp =
      result.outcome === 'locked'
        ? { locked: true, triesLeft: 0 }
        : { locked: false, triesLeft: result.triesLeft };
    set({ delivery: { ...current, otp } });
    return result.outcome === 'locked'
      ? { kind: 'locked' }
      : { kind: 'wrong', triesLeft: result.triesLeft };
  }
  if (refusedSession(answer)) return { kind: 'failed' };
  if (answer.status === 429) return { kind: 'limit' };
  const errorCode = codeOf(answer.body);
  if (errorCode === 'INVALID_INPUT') return { kind: 'cash' };
  if (errorCode === 'NOT_ASSIGNED' || answer.status === 404) {
    void loadDelivery();
    return { kind: 'gone' };
  }
  return { kind: 'failed' };
}

/** "Back to waiting", or the sheet's own 8 seconds: the delivered moment is over. */
export function clearDelivered() {
  set({ delivered: null });
}

/** A problem at the door (P43.1): sent at once; "isn't answering" starts the clock. */
export async function reportProblem(kind: ProblemKind): Promise<StepOutcome> {
  const held = get().delivery;
  if (!held) return 'gone';
  if (!deviceOnline()) return 'offline';
  const answer = await request('POST', deliveryPath(held.deliveryId, 'problem'), { kind });
  if (!answer || answer.status >= 500) return 'offline';
  if (answer.status === 200) {
    set({ askedToWaitAt: null });
    await loadDelivery();
    return 'done';
  }
  if (refusedSession(answer)) return 'failed';
  if (answer.status === 429) return 'limit';
  if (codeOf(answer.body) === 'NOT_ASSIGNED') {
    void loadDelivery();
    return 'gone';
  }
  return 'failed';
}

/** "Tell Foodz nobody answered" (P43.3), once the 5 minutes are up. */
export async function tellNobodyAnswered(): Promise<StepOutcome | 'early'> {
  const held = get().delivery;
  if (!held) return 'gone';
  if (!deviceOnline()) return 'offline';
  const answer = await request('POST', deliveryPath(held.deliveryId, 'no-answer-report'), {});
  if (!answer || answer.status >= 500) return 'offline';
  if (answer.status === 200) {
    await loadDelivery();
    return 'done';
  }
  if (refusedSession(answer)) return 'failed';
  if (answer.status === 429) return 'limit';
  if (answer.status === 409) return 'early';
  return 'failed';
}

/** "Can't do this delivery" (P30). */
export async function giveBackOrder(
  reason: GiveBackReason,
): Promise<'done' | 'limit' | 'closed' | 'gone' | 'offline' | 'failed'> {
  const delivery = get().delivery;
  if (!delivery) return 'gone';
  if (!deviceOnline()) return 'offline';
  const answer = await request(
    'POST',
    `${BASE}/deliveries/${encodeURIComponent(delivery.deliveryId)}/give-back`,
    { reason },
  );
  if (!answer) return 'offline';
  if (answer.status === 200) {
    ownRelease = delivery.deliveryId;
    endHeld(delivery);
    announce(gaveBackText(delivery.orderNumber));
    return 'done';
  }
  if (refusedSession(answer)) return 'failed';
  if (answer.status === 429) return 'limit';
  const code = codeOf(answer.body);
  if (code === 'GIVE_BACK_CLOSED') {
    void loadDelivery();
    return 'closed';
  }
  if (code === 'NOT_ASSIGNED') {
    void loadDelivery();
    return 'gone';
  }
  return 'failed';
}

/** "Give back and go offline" gave it back on the server: no notice follows. */
export function releasedByOwnChoice() {
  const delivery = get().delivery;
  if (!delivery) return;
  ownRelease = delivery.deliveryId;
  endHeld(delivery);
}

// ------------------------------------------------------------------ practice offers (P34)

export async function sendPracticeOffer(): Promise<void> {
  const state = get();
  if (!state.isDemo || state.practice.pending || state.practice.limit) return;
  set({ practice: { pending: true, limit: null } });
  const sentAt = Date.now();
  const answer = await request('POST', `${BASE}/practice-offers`, {});
  set({ practice: { ...get().practice, pending: false } });
  if (!answer) return;
  if (answer.status === 200) {
    adoptServerTime(field(answer.body, 'serverTime'), sentAt);
    const offer = field(answer.body, 'offer');
    if (offer && typeof field(offer, 'offerId') === 'string') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const detail = offer as OfferDetail;
      openOffer(detail.offerId, detail.expiresAt, detail);
    }
    return;
  }
  if (answer.status === 429) {
    const seconds = retryAfterSeconds(answer.retryAfter, answer.body);
    set({
      practice: {
        pending: false,
        limit: `You've tried a lot of practice offers. Try again in ${waitWords(seconds)}.`,
      },
    });
    setTimeout(() => set({ practice: { ...get().practice, limit: null } }), seconds * 1000);
    return;
  }
  if (codeOf(answer.body) === 'PRACTICE_OPEN') void pollCurrent();
}

// ------------------------------------------------------------------ the page's life

/** Back online, or back in the app: catch up on the offer and the order (P28.3, P28.5). */
export async function catchUp(): Promise<void> {
  await flushQueue();
  const delivery = await loadDelivery();
  if (delivery === null) await pollCurrent();
}

/** He went or was taken offline: an open card goes without a notice (F6's notice says it). */
export function wentOffline() {
  const card = get().card;
  if (card && (card.phase === 'open' || card.phase === 'accepting')) closeCard('ended');
}

let listening = false;
function listen() {
  if (listening || !browser()) return;
  listening = true;
  window.addEventListener('online', () => void catchUp());
}

export interface DispatchFacts {
  partnerId: string;
  isDemo: boolean;
  dispatch: PartnerDispatchState;
  /** The server-rendered pick-up screen's data, when he holds an order (P17.6). */
  delivery: PartnerDeliveryF8 | null;
  asOf: string;
}

/** The server's state when a page opens (Home, Profile), or after another partner signs in. */
export function adoptDispatch(facts: DispatchFacts) {
  listen();
  const state = get();
  const samePartner = state.partnerId === facts.partnerId;
  if (!samePartner) {
    stopAlerting();
    clearCardTimers();
    ended.clear();
    queued = [];
    dispatchStore.setState(() => ({ ...initial }));
  }
  set({
    partnerId: facts.partnerId,
    isDemo: facts.isDemo,
    missedInRow: facts.dispatch.missedInRow,
    howOffersWork: facts.dispatch.howOffersWork,
    delivery: facts.delivery ?? (facts.dispatch.delivery ? get().delivery : null),
    offset: serverOffset(facts.asOf, Date.now()),
    soundReady: browser() ? offerSoundReady() : false,
  });
  setHoldingOrder(Boolean(facts.dispatch.delivery));
  const notice = facts.dispatch.notice;
  if (notice && !get().notice && !wasDismissed(notice.at)) {
    showNotice(
      releaseNotice(notice.kind, notice.orderNumber, { feeCents: notice.feeCents ?? null }),
      { persistent: true, key: notice.at },
    );
  }
  if (facts.dispatch.delivery && !facts.delivery) void loadDelivery();
}

/** For stories and tests: put the engine in a given state. */
export function setDispatchStateForPreview(patch: Partial<DispatchState>) {
  set(patch);
}

/** For tests: forget everything between cases. */
export function resetDispatchForTests() {
  stopAlerting();
  clearCardTimers();
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  ended.clear();
  queued = [];
  pressedAt = null;
  ownRelease = null;
  handingOver = null;
  polling = false;
  loadingDelivery = null;
  dispatchStore.setState(() => ({ ...initial }));
}
