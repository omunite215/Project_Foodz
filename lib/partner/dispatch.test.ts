import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferDetail } from '@/server/modules/delivery/schema';
import type { PartnerDeliveryF8 } from '@/server/modules/tracking/schema';
import {
  ACCEPTED_HOLD_MS,
  acceptOffer,
  adoptDispatch,
  catchUp,
  confirmPickUp,
  declineOffer,
  dispatchStore,
  giveBackOrder,
  handOverCode,
  GRACE_MS,
  NOTICE_MS,
  onDeliveryChanged,
  onOfferEnded,
  openOffer,
  pollCurrent,
  reportProblem,
  resetDispatchForTests,
  tellNobodyAnswered,
} from './dispatch';

/*
 * The offers engine against a stand-in for the partner routes: what reaches the card, what
 * each answer does, and the clock's end on the server's time.
 */

const NOW = Date.parse('2026-11-20T23:40:00.000Z');
const OFFER_ID = '0193a000-0000-7000-8000-000000000001';
const EXPIRES = new Date(NOW + 30_000).toISOString();

const detail: OfferDetail = {
  offerId: OFFER_ID,
  kind: 'auto',
  expiresAt: EXPIRES,
  totalSeconds: 30,
  payText: '$7.64',
  payCents: 764,
  tipText: 'includes $5.00 tip',
  pickupText: 'Foodz Kitchen · 0.2 km from you',
  dropoffText: 'Boston 02109 · 1.3 km from the kitchen',
  itemsText: '3 items',
  payment: { kind: 'cash', text: 'Cash order · collect $58.97' },
  heading: 'New order',
  summary: 'You earn $7.64, includes $5.00 tip',
  seen: false,
};

const delivery: PartnerDeliveryF8 = {
  deliveryId: '0193a000-0000-7000-8000-0000000000d1',
  status: 'ASSIGNED',
  version: 4,
  orderNumber: '1042',
  payText: '$7.64',
  tipText: 'includes $5.00 tip',
  payment: { kind: 'cash', text: 'Cash order · collect $58.97' },
  itemsText: '3 items',
  dropoffText: 'Then: Boston 02109 · 1.3 km from the kitchen',
  kitchen: {
    name: 'Foodz Kitchen',
    addressText: '88 Harbor Street',
    point: { lat: 42.3505, lng: -71.045 },
    phone: '+16175550142',
  },
  dropoff: null,
  canGiveBack: true,
  stage: 'toKitchen',
  orderReady: true,
  route: null,
  noAnswer: null,
  problem: null,
  otp: { locked: false, triesLeft: 5 },
  notice: null,
};

type Route = (init: RequestInit | undefined) => { status: number; body: unknown } | 'network';
let routes: Record<string, Route>;
let calls: { method: string; path: string; body: unknown }[];

function respond(path: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  calls.push({ method, path, body });
  const route = routes[`${method} ${path}`];
  const answer = route ? route(init) : { status: 404, body: { code: 'NOT_FOUND' } };
  if (answer === 'network') return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve(
    new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const flush = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(NOW);
  resetDispatchForTests();
  calls = [];
  routes = {
    [`GET /api/v1/partner/offers/${OFFER_ID}`]: () => ({ status: 200, body: detail }),
    [`POST /api/v1/partner/offers/${OFFER_ID}/seen`]: () => ({
      status: 200,
      body: { seenAt: new Date(NOW).toISOString() },
    }),
  };
  vi.stubGlobal('fetch', vi.fn(respond));
  adoptDispatch({
    partnerId: 'p1',
    isDemo: false,
    dispatch: {
      missedInRow: 0,
      offersPausedSince: null,
      howOffersWork: { reachesKm: [2, 4, 8], offerSeconds: 30, missLimit: 3 },
      delivery: null,
      notice: null,
    },
    delivery: null,
    asOf: new Date(NOW).toISOString(),
  });
});

afterEach(() => {
  resetDispatchForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('an offer arriving', () => {
  it('opens from the event, reports it seen and fetches the details', async () => {
    openOffer(OFFER_ID, EXPIRES);
    expect(dispatchStore.state.card).toMatchObject({
      offerId: OFFER_ID,
      phase: 'open',
      detail: null,
    });
    await flush();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /api/v1/partner/offers/${OFFER_ID}/seen`,
      `GET /api/v1/partner/offers/${OFFER_ID}`,
    ]);
    expect(dispatchStore.state.card?.detail?.payText).toBe('$7.64');
  });

  it("never opens while he holds an order, or once it's over", () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    openOffer(OFFER_ID, EXPIRES);
    expect(dispatchStore.state.card).toBeNull();
    dispatchStore.setState((state) => ({ ...state, delivery: null }));
    openOffer(OFFER_ID, new Date(NOW - GRACE_MS - 1).toISOString());
    expect(dispatchStore.state.card).toBeNull();
  });

  it('says when the details never came', async () => {
    routes[`GET /api/v1/partner/offers/${OFFER_ID}`] = () => 'network';
    openOffer(OFFER_ID, EXPIRES);
    await flush();
    vi.advanceTimersByTime(5_000);
    expect(dispatchStore.state.card?.detailFailed).toBe(true);
  });

  it('shows an offer found by the poll, with the server clock', async () => {
    routes['GET /api/v1/partner/offers/current'] = () => ({
      status: 200,
      body: { offer: detail, serverTime: new Date(NOW + 60_000).toISOString() },
    });
    await pollCurrent();
    expect(dispatchStore.state.offset).toBeGreaterThan(55_000);
    // The server is a minute ahead: the offer had already run out on its clock.
    expect(dispatchStore.state.card).toBeNull();
  });
});

describe('accepting', () => {
  it('turns into the pick-up screen after "Order 1042 is yours"', async () => {
    routes[`POST /api/v1/partner/offers/${OFFER_ID}/accept`] = () => ({
      status: 200,
      body: { deliveryId: delivery.deliveryId, orderNumber: '1042', replayed: false },
    });
    routes['GET /api/v1/partner/deliveries/current'] = () => ({ status: 200, body: delivery });
    openOffer(OFFER_ID, EXPIRES, detail);
    acceptOffer();
    expect(dispatchStore.state.card?.phase).toBe('accepting');
    await flush();
    expect(dispatchStore.state.card).toMatchObject({ phase: 'accepted', orderNumber: '1042' });
    vi.advanceTimersByTime(ACCEPTED_HOLD_MS);
    await flush();
    expect(dispatchStore.state.card).toBeNull();
    expect(dispatchStore.state.delivery?.orderNumber).toBe('1042');
    expect(dispatchStore.state.lastClose?.how).toBe('accepted');
  });

  it('waits for the details before anything can be accepted', () => {
    openOffer(OFFER_ID, EXPIRES);
    acceptOffer();
    expect(dispatchStore.state.card?.phase).toBe('open');
  });

  it('closes with the reason when someone else took it', async () => {
    routes[`POST /api/v1/partner/offers/${OFFER_ID}/accept`] = () => ({
      status: 409,
      body: { code: 'OFFER_GONE', message: 'Gone', details: { why: 'taken' } },
    });
    openOffer(OFFER_ID, EXPIRES, detail);
    acceptOffer();
    await flush();
    expect(dispatchStore.state.card).toBeNull();
    expect(dispatchStore.state.notice?.words.text).toBe('Another partner took this order.');
  });

  it('retries without a connection, then says it expired and reports the press', async () => {
    routes[`POST /api/v1/partner/offers/${OFFER_ID}/accept`] = () => 'network';
    openOffer(OFFER_ID, EXPIRES, detail);
    vi.advanceTimersByTime(20_000);
    acceptOffer();
    await flush();
    expect(dispatchStore.state.card?.waitingForConnection).toBe(true);
    for (let step = 0; step < 8; step += 1) {
      vi.advanceTimersByTime(2_000);
      await flush();
    }
    expect(dispatchStore.state.card?.phase).toBe('offlineExpired');
    expect(dispatchStore.state.missedInRow).toBe(0);
    routes[`POST /api/v1/partner/offers/${OFFER_ID}/late-accept`] = () => ({
      status: 200,
      body: { recorded: true },
    });
    routes['GET /api/v1/partner/deliveries/current'] = () => ({ status: 200, body: null });
    routes['GET /api/v1/partner/offers/current'] = () => ({
      status: 200,
      body: { offer: null, serverTime: new Date().toISOString() },
    });
    await catchUp();
    const late = calls.find((call) => call.path.endsWith('/late-accept'));
    expect(late?.body).toMatchObject({ pressedAt: expect.any(String) });
  });
});

describe('declining and endings', () => {
  it('closes at once, announces it, and sends the decline later when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    openOffer(OFFER_ID, EXPIRES, detail);
    declineOffer();
    expect(dispatchStore.state.card).toBeNull();
    expect(dispatchStore.state.lastClose?.how).toBe('declined');
    await flush();
    expect(calls.some((call) => call.path.endsWith('/decline'))).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    routes[`POST /api/v1/partner/offers/${OFFER_ID}/decline`] = () => ({
      status: 200,
      body: { declined: true },
    });
    routes['GET /api/v1/partner/deliveries/current'] = () => ({ status: 200, body: null });
    routes['GET /api/v1/partner/offers/current'] = () => ({
      status: 200,
      body: { offer: null, serverTime: new Date().toISOString() },
    });
    await catchUp();
    expect(calls.find((call) => call.path.endsWith('/decline'))?.body).toMatchObject({
      pressedAt: expect.any(String),
    });
  });

  it('counts a missed automatic offer when the time runs out', async () => {
    openOffer(OFFER_ID, EXPIRES, detail);
    vi.advanceTimersByTime(30_000 + GRACE_MS);
    await flush();
    expect(dispatchStore.state.card).toBeNull();
    expect(dispatchStore.state.notice?.words.text).toBe('Offer missed. The time ran out.');
    expect(dispatchStore.state.missedInRow).toBe(1);
    vi.advanceTimersByTime(NOTICE_MS);
    expect(dispatchStore.state.notice).toBeNull();
  });

  it('closes on offer.ended with the right notice, and none for going offline', () => {
    openOffer(OFFER_ID, EXPIRES, detail);
    onOfferEnded({ offerId: OFFER_ID, why: 'withdrawn-staff' });
    expect(dispatchStore.state.notice?.words.text).toBe('This offer was withdrawn.');
    resetDispatchForTests();
    openOffer(OFFER_ID, EXPIRES, detail);
    onOfferEnded({ offerId: OFFER_ID, why: 'withdrawn-offline' });
    expect(dispatchStore.state.card).toBeNull();
    expect(dispatchStore.state.notice).toBeNull();
  });

  it('never reopens an offer this phone closed', () => {
    openOffer(OFFER_ID, EXPIRES, detail);
    declineOffer();
    openOffer(OFFER_ID, EXPIRES, detail);
    expect(dispatchStore.state.card).toBeNull();
  });
});

describe('the order he holds', () => {
  it('ends quietly on a delivered event, with nothing of the customer kept', () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    onDeliveryChanged({
      orderId: 'o1',
      status: 'DELIVERED',
      version: 9,
      at: new Date(NOW).toISOString(),
    });
    expect(dispatchStore.state.delivery).toBeNull();
    expect(dispatchStore.state.notice).toBeNull();
  });

  it('says when staff confirmed it, with his pay and no staff name', () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    onDeliveryChanged({
      orderId: 'o1',
      status: 'DELIVERED',
      version: 9,
      at: new Date(NOW).toISOString(),
      notice: 'confirmed',
    });
    expect(dispatchStore.state.delivery).toBeNull();
    expect(dispatchStore.state.notice).toMatchObject({
      persistent: true,
      words: {
        text: 'Foodz support confirmed order 1042 as delivered. You earned $7.64.',
        tone: 'success',
      },
    });
  });

  it('tells him to bring a cancelled order back, with the kitchen to call', () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    onDeliveryChanged({
      orderId: 'o1',
      status: 'CANCELLED',
      version: 9,
      at: new Date(NOW).toISOString(),
      notice: 'cancelledBringBack',
    });
    expect(dispatchStore.state.notice?.words).toMatchObject({
      text: 'Order 1042 was cancelled. Bring the food back to Foodz Kitchen.',
      icon: 'undo',
      call: { phone: '+16175550142', address: 'Foodz Kitchen · 88 Harbor Street' },
    });
  });

  it('picks up, refuses a moved-back order, and waits for a connection', async () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    const path = `POST /api/v1/partner/deliveries/${delivery.deliveryId}/picked-up`;
    routes[path] = () => ({
      status: 409,
      body: { code: 'ORDER_NOT_READY', message: 'The kitchen is still preparing order 1042.' },
    });
    expect(await confirmPickUp(false)).toBe('notReady');
    routes[path] = () => 'network';
    expect(await confirmPickUp(false)).toBe('offline');
    routes[path] = () => ({ status: 200, body: { deliveryId: delivery.deliveryId, version: 6 } });
    expect(await confirmPickUp(true)).toBe('done');
    expect(calls.findLast((call) => call.path.endsWith('/picked-up'))?.body).toEqual({
      confirmFar: true,
    });
  });

  it('counts wrong codes from the server, locks, and delivers', async () => {
    const held = { ...delivery, status: 'PICKED_UP' as const, stage: 'delivering' as const };
    dispatchStore.setState((state) => ({ ...state, delivery: held }));
    const path = `POST /api/v1/partner/deliveries/${delivery.deliveryId}/hand-over`;
    routes[path] = () => ({ status: 200, body: { outcome: 'wrong', triesLeft: 3 } });
    expect(await handOverCode('1111', true, false)).toEqual({ kind: 'wrong', triesLeft: 3 });
    expect(dispatchStore.state.delivery?.otp).toEqual({ locked: false, triesLeft: 3 });
    expect(calls.at(-1)?.body).toEqual({ code: '1111', cashCollected: true });
    routes[path] = () => ({ status: 200, body: { outcome: 'locked' } });
    expect(await handOverCode('2222', true, false)).toEqual({ kind: 'locked' });
    expect(dispatchStore.state.delivery?.otp.locked).toBe(true);
    routes[path] = () => ({
      status: 200,
      body: { outcome: 'delivered', payWords: 'Order 1042 delivered · You earned $7.64' },
    });
    expect(await handOverCode('4821', true, false)).toEqual({ kind: 'delivered', pay: '$7.64' });
    expect(dispatchStore.state.delivery).toBeNull();
    expect(dispatchStore.state.delivered).toEqual({ orderNumber: '1042', pay: '$7.64' });
  });

  it('re-sends a code only when it never left the phone (gate S8)', async () => {
    const held = { ...delivery, status: 'PICKED_UP' as const, stage: 'delivering' as const };
    dispatchStore.setState((state) => ({ ...state, delivery: held }));
    const path = `POST /api/v1/partner/deliveries/${delivery.deliveryId}/hand-over`;
    // A server error (the fail-closed code fence answers 503): can't check, never re-sent.
    routes[path] = () => ({ status: 503, body: { code: 'UNAVAILABLE', message: 'Try later' } });
    expect(await handOverCode('1111', true, false)).toEqual({ kind: 'unavailable' });
    routes[path] = () => ({ status: 500, body: { code: 'INTERNAL', message: 'Oops' } });
    expect(await handOverCode('1111', true, false)).toEqual({ kind: 'unavailable' });
    // fetch failed before any answer: it never got there, so it may be sent again.
    routes[path] = () => 'network';
    expect(await handOverCode('1111', true, false)).toEqual({ kind: 'offline' });
    // The phone knows it's offline: nothing is sent at all.
    const before = calls.length;
    vi.stubGlobal('navigator', { onLine: false });
    expect(await handOverCode('1111', true, false)).toEqual({ kind: 'offline' });
    expect(calls).toHaveLength(before);
    vi.stubGlobal('navigator', { onLine: true });
  });

  it("treats no answer in 8 s as can't check, since the code may have counted (gate S8)", async () => {
    const held = { ...delivery, status: 'PICKED_UP' as const, stage: 'delivering' as const };
    dispatchStore.setState((state) => ({ ...state, delivery: held }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const answer = handOverCode('1111', true, false);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await answer).toEqual({ kind: 'unavailable' });
  });

  it('shows his pay even when the delivered event beats the answer', async () => {
    const held = { ...delivery, status: 'PICKED_UP' as const, stage: 'delivering' as const };
    dispatchStore.setState((state) => ({ ...state, delivery: held }));
    routes[`POST /api/v1/partner/deliveries/${delivery.deliveryId}/hand-over`] = () => {
      onDeliveryChanged({ orderId: 'o1', status: 'DELIVERED', version: 9, at: '' });
      // The event waits for the answer: nothing ended yet.
      expect(dispatchStore.state.delivery).not.toBeNull();
      return {
        status: 200,
        body: { outcome: 'delivered', payWords: 'Order 1042 delivered · You earned $7.64' },
      };
    };
    expect(await handOverCode('4821', true, false)).toEqual({ kind: 'delivered', pay: '$7.64' });
    expect(dispatchStore.state.delivery).toBeNull();
    expect(dispatchStore.state.delivered).toEqual({ orderNumber: '1042', pay: '$7.64' });
  });

  it('reports a problem and tells Foodz nobody answered once the clock is up', async () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    routes[`POST /api/v1/partner/deliveries/${delivery.deliveryId}/problem`] = () => ({
      status: 429,
      body: { code: 'RATE_LIMITED', message: 'Slow down' },
    });
    expect(await reportProblem('address')).toBe('limit');
    routes[`POST /api/v1/partner/deliveries/${delivery.deliveryId}/no-answer-report`] = () => ({
      status: 409,
      body: { code: 'INVALID_STATE', message: 'Wait the full 5 minutes first.' },
    });
    expect(await tellNobodyAnswered()).toBe('early');
  });

  it('says the kitchen needs a few more minutes when it moves the order back', async () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    routes['GET /api/v1/partner/deliveries/current'] = () => ({
      status: 200,
      body: { ...delivery, version: 5 },
    });
    onDeliveryChanged({ orderId: 'o1', status: 'ASSIGNED', version: 5, at: '' });
    await flush();
    expect(dispatchStore.state.notice).toMatchObject({
      persistent: true,
      words: { text: 'The kitchen needs a few more minutes for order 1042. Keep heading over.' },
    });
  });

  it('tells him when support took the order off him', async () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    routes['GET /api/v1/partner/deliveries/current'] = () => ({ status: 200, body: null });
    routes['GET /api/v1/partner/me'] = () => ({
      status: 200,
      body: {
        screen: 'home',
        dispatch: { notice: { kind: 'takenOff', orderNumber: '1042', at: '2026-11-20T23:41:00Z' } },
      },
    });
    onDeliveryChanged({ orderId: 'o1', status: 'SEARCHING', version: 6, at: '' });
    await flush();
    await flush();
    expect(dispatchStore.state.notice?.words.text).toBe(
      "Foodz support took order 1042 off you. You don't need to pick it up.",
    );
  });

  it('gives an order back, or says why not', async () => {
    dispatchStore.setState((state) => ({ ...state, delivery }));
    routes[`POST /api/v1/partner/deliveries/${delivery.deliveryId}/give-back`] = () => ({
      status: 429,
      body: { code: 'RATE_LIMITED', message: 'Slow down' },
    });
    expect(await giveBackOrder('vehicle')).toBe('limit');
    routes[`POST /api/v1/partner/deliveries/${delivery.deliveryId}/give-back`] = () => ({
      status: 200,
      body: { gaveBack: true },
    });
    expect(await giveBackOrder('vehicle')).toBe('done');
    expect(dispatchStore.state.delivery).toBeNull();
    expect(calls.at(-1)?.body).toEqual({ reason: 'vehicle' });
  });
});
