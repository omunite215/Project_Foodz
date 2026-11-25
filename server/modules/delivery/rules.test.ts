import { describe, expect, it } from 'vitest';
import {
  allocateOldestFirst,
  answerInTime,
  type CandidateFacts,
  compareCandidates,
  countersAfter,
  type CourierLineInput,
  courierStateOf,
  customerStateOf,
  listedEnding,
  dispatchOverridesRefused,
  dispatchTimingWarning,
  dispatchTimings,
  notOfferable,
  offerPay,
  reachesToTry,
  searchStep,
  waitingSinceAfter,
} from './rules';
import { DISPATCH_DEFAULTS } from './schema';

const now = new Date('2026-11-21T00:40:00.000Z'); // Fri, Nov 20, 7:40 pm in Boston
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe('pay (U12, P20.2)', () => {
  it('is the delivery fee before any discount plus the whole tip', () => {
    expect(offerPay({ deliveryFeeCents: 264, tipCents: 500 }).payCents).toBe(764); // T5
    expect(offerPay({ deliveryFeeCents: 264, tipCents: 959 }).payCents).toBe(1223); // T7, FREEDELIVERY
    expect(offerPay({ deliveryFeeCents: 529, tipCents: 0 })).toEqual({
      payCents: 529,
      tipCents: 0,
    }); // T11
  });
});

describe('who may be offered (W2)', () => {
  const ok: CandidateFacts = {
    status: 'APPROVED',
    banned: false,
    isOnline: true,
    lastPointAt: ago(10),
    distanceM: 1400,
    hasActiveDelivery: false,
    hasOpenOffer: false,
    excluded: false,
    previousAutoEnding: null,
    secondChance: false,
    isDemo: false,
    unseenInRow: 0,
  };
  const context = {
    pool: 'REAL' as const,
    reachM: 2000,
    radiusM: 8000,
    now,
    freshPointSeconds: 45,
  };

  it('lets a fresh, free, nearby approved partner through', () => {
    expect(notOfferable(ok, context)).toBeNull();
  });

  it.each([
    [{ status: 'SUSPENDED' as const }, 'not-approved'],
    [{ banned: true }, 'not-approved'],
    [{ isOnline: false }, 'offline'],
    [{ lastPointAt: ago(46) }, 'stale'],
    [{ lastPointAt: null }, 'stale'],
    [{ distanceM: 2001 }, 'out-of-reach'],
    [{ hasActiveDelivery: true }, 'busy'],
    [{ hasOpenOffer: true }, 'has-offer'],
    [{ excluded: true }, 'excluded'],
    [{ previousAutoEnding: 'expired' as const }, 'already-offered'],
    [{ isDemo: true }, 'other-pool'],
    [{ unseenInRow: 2 }, 'paused'],
  ])('refuses %j as %s, breaking exactly one rule', (change, reason) => {
    expect(notOfferable({ ...ok, ...change }, context)).toBe(reason);
  });

  it('never reaches past the delivery radius, and gives a missed offer one more turn in a sweep', () => {
    expect(notOfferable({ ...ok, distanceM: 8100 }, { ...context, reachM: 12_000 })).toBe(
      'out-of-reach',
    );
    expect(
      notOfferable({ ...ok, previousAutoEnding: 'expired', secondChance: true }, context),
    ).toBeNull();
    expect(
      notOfferable({ ...ok, previousAutoEnding: 'declined', secondChance: true }, context),
    ).toBe('already-offered');
  });

  it('keeps the demo partner and real orders apart (W12)', () => {
    expect(notOfferable({ ...ok, isDemo: true }, { ...context, pool: 'DEMO' })).toBeNull();
    expect(notOfferable(ok, { ...context, pool: 'DEMO' })).toBe('other-pool');
  });
});

describe('ranking and rounds (W3, W4)', () => {
  // Line-up L: Lena 7:20 (Harvard, ring 3), Omar 7:25 (Copley, ring 2), Grace 7:30 (R6), Diego
  // 7:33 (R1), Luis 7:35 (K), all ring 1.
  const lineUp = [
    { partnerId: 'luis', waitingSince: ago(300), distanceM: 0 },
    { partnerId: 'diego', waitingSince: ago(420), distanceM: 200 },
    { partnerId: 'grace', waitingSince: ago(600), distanceM: 1400 },
    { partnerId: 'omar', waitingSince: ago(900), distanceM: 2700 },
    { partnerId: 'lena', waitingSince: ago(1200), distanceM: 6600 },
  ];
  const within = (meters: number) =>
    lineUp
      .filter((p) => p.distanceM <= meters)
      .toSorted(compareCandidates)
      .map((p) => p.partnerId);

  it('offers ring 1 by longest wait, so Grace goes before Luis at the door (P27.3)', () => {
    expect(within(2000)).toEqual(['grace', 'diego', 'luis']);
  });

  it('walks the reaches in W3.4 order when every offer is missed', () => {
    const offered: string[] = [];
    const byReach = [0, 0, 0];
    for (let turn = 0; turn < 6; turn += 1) {
      const next = reachesToTry(byReach)
        .map((index) => ({
          index,
          pick: within([2000, 4000, 8000][index]!).find((id) => !offered.includes(id)),
        }))
        .find((option) => option.pick);
      if (!next?.pick) break;
      offered.push(next.pick);
      byReach[next.index] = (byReach[next.index] ?? 0) + 1;
    }
    expect(offered).toEqual(['grace', 'diego', 'luis', 'omar', 'lena']);
  });

  it('caps the first two reaches at three offers each', () => {
    expect(reachesToTry([0, 0, 0])).toEqual([0, 1, 2]);
    expect(reachesToTry([3, 1, 0])).toEqual([1, 2]);
    expect(reachesToTry([3, 3, 9])).toEqual([2]);
  });

  it('breaks equal waits by distance, then by id', () => {
    const a = { partnerId: 'b', waitingSince: ago(60), distanceM: 100 };
    const b = { partnerId: 'a', waitingSince: ago(60), distanceM: 100 };
    expect([a, b].toSorted(compareCandidates).map((p) => p.partnerId)).toEqual(['a', 'b']);
  });

  it('keeps the place on a decline, resets it on a give-back, restores it on a cancellation (W3.3)', () => {
    const facts = { current: ago(600), beforeAssignment: ago(900), now };
    expect(waitingSinceAfter('declined', facts)).toBe(facts.current);
    expect(waitingSinceAfter('missed', facts)).toBe(facts.current);
    expect(waitingSinceAfter('gave-back', facts)).toBe(now.toISOString());
    expect(waitingSinceAfter('taken-off', facts)).toBe(now.toISOString());
    expect(waitingSinceAfter('cancelled', facts)).toBe(facts.beforeAssignment);
  });

  it('gives the oldest ready order first pick when one partner fits two (W9)', () => {
    const orders = [
      { deliveryId: '1042', candidates: ['grace', 'diego'] },
      { deliveryId: '1043', candidates: ['grace', 'diego'] },
    ];
    expect(allocateOldestFirst('1042', orders)).toBe('grace');
    expect(allocateOldestFirst('1043', orders)).toBe('diego');
    expect(
      allocateOldestFirst('1043', [orders[0]!, { deliveryId: '1043', candidates: ['grace'] }]),
    ).toBeNull();
  });
});

describe('escalating and stopping (W5)', () => {
  const facts = {
    readyAt: ago(120),
    searchStartedAt: ago(108),
    escalatedAt: null,
    anyoneOnline: true,
    anyoneLeft: true,
  };

  it('goes on, then escalates at 5 minutes, at once with nobody online or nobody left', () => {
    expect(searchStep(facts, now)).toBe('continue');
    expect(searchStep({ ...facts, searchStartedAt: ago(300) }, now)).toBe('escalate');
    expect(searchStep({ ...facts, anyoneOnline: false }, now)).toBe('escalate');
    expect(searchStep({ ...facts, anyoneLeft: false }, now)).toBe('escalate');
    expect(searchStep({ ...facts, escalatedAt: ago(10), anyoneLeft: false }, now)).toBe('continue');
  });

  it('stops 60 minutes after ready, and never cancels', () => {
    expect(searchStep({ ...facts, readyAt: ago(3600), escalatedAt: ago(3300) }, now)).toBe('stop');
  });
});

describe('answers and misses (W6.1, P25, W7.4)', () => {
  it('takes an answer until the end plus 2 seconds', () => {
    expect(answerInTime(ago(2), now)).toBe(true);
    expect(answerInTime(ago(3), now)).toBe(false);
  });

  const zero = { missedInRow: 0, unseenInRow: 0 };

  it('counts only automatic offers that were shown and timed out', () => {
    const missed = {
      kind: 'auto' as const,
      seen: true,
      ending: 'expired' as const,
      pressedBeforeEnd: false,
    };
    const first = countersAfter(missed, zero);
    const second = countersAfter(missed, first);
    const third = countersAfter(missed, second);
    expect([first.missedInRow, second.warn, third.takeOffline]).toEqual([1, true, true]);
    expect(countersAfter({ ...missed, kind: 'staff' }, zero)).toMatchObject({
      missedInRow: 0,
      takeOffline: false,
    });
    expect(countersAfter({ ...missed, ending: 'withdrawn-order' }, zero).missedInRow).toBe(0);
    expect(countersAfter({ ...missed, pressedBeforeEnd: true }, zero).missedInRow).toBe(0);
  });

  it('counts an offer that never reached the phone toward the pause, not the misses', () => {
    expect(
      countersAfter(
        { kind: 'auto', seen: false, ending: 'expired', pressedBeforeEnd: false },
        zero,
      ),
    ).toEqual({
      missedInRow: 0,
      unseenInRow: 1,
      warn: false,
      takeOffline: false,
    });
  });

  it('resets both counters on any answer', () => {
    expect(
      countersAfter(
        { kind: 'auto', seen: true, ending: 'declined', pressedBeforeEnd: false },
        { missedInRow: 2, unseenInRow: 1 },
      ),
    ).toMatchObject({ missedInRow: 0, unseenInRow: 0 });
  });
});

describe('test timings (B13, W14.1)', () => {
  it('uses the story values unless the test-only flag is on with an override', () => {
    expect(dispatchTimings({})).toEqual(DISPATCH_DEFAULTS);
    expect(dispatchTimings({ DISPATCH_OFFER_SECONDS: '5' })).toEqual(DISPATCH_DEFAULTS);
    expect(dispatchTimings({ DISPATCH_OFFER_SECONDS: '5', CI: 'true', E2E: '1' })).toEqual(
      DISPATCH_DEFAULTS,
    );
    expect(
      dispatchTimings({
        FOODZ_TEST_TIMING: '1',
        DISPATCH_OFFER_SECONDS: '5',
        DISPATCH_START_DELAY_SECONDS: 'x',
      }),
    ).toMatchObject({
      offerSeconds: 5,
      startDelaySeconds: 12,
    });
  });

  it('warns at startup while test timing is on, and when overrides are ignored', () => {
    expect(dispatchTimingWarning({})).toBeNull();
    expect(dispatchTimingWarning({ FOODZ_TEST_TIMING: '1' })).toMatch(/tests only/);
    expect(dispatchTimingWarning({ DISPATCH_OFFER_SECONDS: '5' })).toMatch(/ignored/);
  });

  it('refuses the flag on a production deployment', () => {
    const env = { VERCEL_ENV: 'production', FOODZ_TEST_TIMING: '1', DISPATCH_OFFER_SECONDS: '5' };
    expect(dispatchOverridesRefused(env)).toBe(true);
    expect(dispatchTimings(env).offerSeconds).toBe(30);
    expect(
      dispatchOverridesRefused({ FOODZ_TEST_TIMING: '1', FOODZ_DEPLOYMENT: 'production' }),
    ).toBe(true);
    expect(
      dispatchOverridesRefused({
        FOODZ_TEST_TIMING: '1',
        ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/x',
      }),
    ).toBe(true);
    // A local production build (the browser tests run one) may use it.
    expect(dispatchOverridesRefused({ NODE_ENV: 'production', FOODZ_TEST_TIMING: '1' })).toBe(
      false,
    );
  });
});

describe('the staff courier line state (A34.1)', () => {
  const searching = {
    status: 'SEARCHING' as const,
    searchStartedAt: ago(60),
    escalatedAt: null,
    searchStoppedAt: null,
  };
  const base: CourierLineInput = {
    orderStatus: 'READY',
    readyAt: ago(72),
    delivery: searching,
    openOfferKind: null,
    anyoneOnline: true,
    lastPointAt: ago(20),
  };

  it.each([
    [{ delivery: null, readyAt: ago(5) }, 'starting'],
    [{ delivery: null }, 'notLooking'],
    [{ openOfferKind: 'auto' as const }, 'offered'],
    [{ openOfferKind: 'staff' as const }, 'staffOffered'],
    [{}, 'between'],
    [{ delivery: { ...searching, escalatedAt: ago(1) } }, 'escalated'],
    [{ delivery: { ...searching, escalatedAt: ago(1) }, anyoneOnline: false }, 'nobodyOnline'],
    [{ delivery: { ...searching, searchStoppedAt: ago(1) } }, 'notLooking'],
    [{ delivery: { ...searching, status: 'ASSIGNED' as const } }, 'assigned'],
    [
      { delivery: { ...searching, status: 'ASSIGNED' as const }, lastPointAt: ago(601) },
      'assignedStale',
    ],
  ])('reads %j as %s', (change, state) => {
    expect(courierStateOf({ ...base, ...change }, now)).toBe(state);
  });

  it('shows the carrying courier out for delivery, and nothing on other columns', () => {
    const out = {
      ...base,
      orderStatus: 'PICKED_UP',
      delivery: { ...searching, status: 'PICKED_UP' as const },
    };
    expect(courierStateOf(out, now)).toBe('assigned');
    expect(courierStateOf({ ...out, delivery: null }, now)).toBeNull();
    expect(courierStateOf({ ...base, orderStatus: 'PREPARING' }, now)).toBeNull();
  });
});

describe("the customer's courier state (S1 to S4)", () => {
  const delivery = { status: 'SEARCHING' as const, escalatedAt: null, searchStoppedAt: null };
  it('says searching, then slow after escalation, then who is coming', () => {
    expect(customerStateOf({ orderStatus: 'READY', delivery: null })).toBe('searching');
    expect(customerStateOf({ orderStatus: 'READY', delivery })).toBe('searching');
    expect(
      customerStateOf({ orderStatus: 'READY', delivery: { ...delivery, escalatedAt: ago(1) } }),
    ).toBe('slow');
    expect(
      customerStateOf({ orderStatus: 'READY', delivery: { ...delivery, status: 'ASSIGNED' } }),
    ).toBe('assigned');
    expect(
      customerStateOf({ orderStatus: 'PICKED_UP', delivery: { ...delivery, status: 'PICKED_UP' } }),
    ).toBe('pickedUp');
    expect(
      customerStateOf({ orderStatus: 'PICKED_UP', delivery: { ...delivery, status: 'CANCELLED' } }),
    ).toBe('none');
    expect(customerStateOf({ orderStatus: 'PREPARING', delivery })).toBe('none');
  });
});

describe('the offers list ending (A36.2, review S6)', () => {
  const expiresAt = new Date('2026-11-21T03:50:30.000Z');
  const offer = (patch: Partial<Parameters<typeof listedEnding>[0]>) => ({
    status: 'EXPIRED',
    endedReason: 'expired' as const,
    pressedAt: null,
    expiresAt,
    ...patch,
  });

  it('reads an offline press in time, reported after the end, as answered too late', () => {
    expect(listedEnding(offer({ pressedAt: new Date('2026-11-21T03:50:12.000Z') }))).toBe(
      'too-late',
    );
    // Pressed in the 2-second grace still counts as in time.
    expect(listedEnding(offer({ pressedAt: new Date('2026-11-21T03:50:31.500Z') }))).toBe(
      'too-late',
    );
  });

  it('keeps a real miss, a press after the end, and every other ending as they are', () => {
    expect(listedEnding(offer({}))).toBe('expired');
    expect(listedEnding(offer({ pressedAt: new Date('2026-11-21T03:50:40.000Z') }))).toBe(
      'expired',
    );
    expect(
      listedEnding(
        offer({ endedReason: 'declined', pressedAt: new Date('2026-11-21T03:50:10.000Z') }),
      ),
    ).toBe('declined');
    expect(listedEnding(offer({ status: 'PENDING', endedReason: null }))).toBe('open');
    expect(listedEnding(offer({ endedReason: null }))).toBe('expired');
  });
});
