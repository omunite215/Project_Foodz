import { describe, expect, it } from 'vitest';
import {
  cityAndZip,
  courierLineWords,
  courierTimelineWords,
  courierVehicle,
  customerLine,
  fromKitchenWords,
  offerWords,
  outcomeWords,
  shortName,
  waitingWords,
} from './text';

describe('the offer card words (P20.1)', () => {
  it("words Priya's cash order with a $5 tip as the story does", () => {
    expect(
      offerWords({
        kind: 'auto',
        payCents: 764,
        tipCents: 500,
        pickupM: 210,
        dropoffCity: 'Boston, MA 02109',
        dropoffM: 1300,
        items: 3,
        cashTotalCents: 5897,
      }),
    ).toMatchObject({
      heading: 'New order',
      payText: '$7.64',
      tipText: 'includes $5.00 tip',
      pickupText: 'Foodz Kitchen · 0.2 km from you',
      dropoffText: 'Boston 02109 · 1.3 km from the kitchen',
      itemsText: '3 items',
      payment: { kind: 'cash', text: 'Cash order · collect $58.97' },
      summary:
        'You earn $7.64, includes $5.00 tip. Pickup: Foodz Kitchen, 0.2 km from you. Drop-off: Boston 02109, 1.3 km from the kitchen. 3 items. Cash order, collect $58.97.',
    });
  });

  it('words distances and waits for the staff lists (design 2.7)', () => {
    expect(fromKitchenWords(80)).toBe('at the kitchen');
    expect(fromKitchenWords(1_440)).toBe('1.4 km from the kitchen');
    expect(waitingWords(40_000)).toBe('waiting under 1 min');
    expect(waitingWords(10 * 60_000 + 5_000)).toBe('waiting 10 min');
    expect(waitingWords(-5)).toBe('waiting under 1 min');
  });

  it('says "at the kitchen" within 100 m and leaves out a zero tip', () => {
    const words = offerWords({
      kind: 'staff',
      payCents: 529,
      tipCents: 0,
      pickupM: 40,
      dropoffCity: 'Cambridge, MA 02138',
      dropoffM: 6600,
      items: 1,
      cashTotalCents: null,
    });
    expect(words).toMatchObject({
      heading: 'Foodz support picked you for this order.',
      tipText: null,
      pickupText: "Foodz Kitchen · you're at the kitchen",
      itemsText: '1 item',
      payment: { kind: 'card', text: 'Paid by card' },
    });
    expect(words.summary).not.toMatch(/Harvard Square,/);
  });

  it('words the city line only, so no part of the street can reach the card (U11)', () => {
    expect(cityAndZip('Boston, MA 02109')).toBe('Boston 02109');
    expect(cityAndZip('Boston MA 02215')).toBe('Boston MA 02215');
    expect(cityAndZip('Boston')).toBe('Boston');
    expect(cityAndZip('02215')).toBe('02215');
    expect(cityAndZip(null)).toBe('Drop-off');
  });
});

describe('the staff courier line (A34.1)', () => {
  const base = {
    partnerShort: 'Luis M.',
    offeredBy: null,
    reachKm: null,
    vehicle: 'SCOOTER' as const,
    plate: '7KT 342',
    distanceM: 900,
    staleMinutes: null,
  };

  it.each([
    ['starting', 'Finding a courier…', 'neutral'],
    ['offered', 'Offered to Luis M.', 'neutral'],
    ['assigned', 'Luis M. · Scooter 7KT 342 · 0.9 km away', 'positive'],
    ['escalated', 'No courier after 5 min · still looking', 'red'],
    ['nobodyOnline', 'No couriers online · still looking', 'red'],
    ['notLooking', 'Not looking for a courier', 'red'],
  ] as const)('words %s', (state, words, tone) => {
    expect(courierLineWords({ ...base, state })).toEqual({ words, tone });
  });

  it('names the reach between offers, the staff sender, the kitchen and a stale courier', () => {
    expect(courierLineWords({ ...base, state: 'between', reachKm: 4 }).words).toBe(
      'Finding a courier · within 4 km',
    );
    expect(
      courierLineWords({
        ...base,
        state: 'staffOffered',
        offeredBy: 'Morgan',
        partnerShort: 'Grace O.',
      }).words,
    ).toBe('Morgan offered it to Grace O.');
    expect(courierLineWords({ ...base, state: 'assigned', distanceM: 60 }).words).toBe(
      'Luis M. · Scooter 7KT 342 · at the kitchen',
    );
    expect(courierLineWords({ ...base, state: 'assignedStale', staleMinutes: 12 })).toEqual({
      words: 'Luis M. · no location for 12 min',
      tone: 'amber',
    });
  });

  it('shortens names to first name and last initial', () => {
    expect(shortName('Grace Okafor')).toBe('Grace O.');
    expect(shortName('Riley')).toBe('Riley');
    expect(courierVehicle('BICYCLE', null)).toBe('Bicycle');
  });
});

describe('the staff timeline milestones (design 2.5)', () => {
  const morgan = { name: 'Morgan Diaz', role: 'support' };
  const base = { courierName: 'Luis Moreno', staff: null, reason: null, pickupM: null };

  it.each([
    [{ event: 'search-started' as const }, 'Looking for a courier · Foodz (automatic)'],
    [
      { event: 'assigned' as const, pickupM: 210 },
      'Luis Moreno accepted · 0.2 km from the kitchen',
    ],
    [{ event: 'assigned' as const, pickupM: 40 }, 'Luis Moreno accepted · at the kitchen'],
    [
      { event: 'offered-by-staff' as const, staff: morgan, courierName: 'Grace Okafor' },
      'Morgan Diaz (Support) offered it to Grace Okafor',
    ],
    [
      { event: 'gave-back' as const, reason: 'vehicle' },
      'Luis Moreno gave it back · Vehicle problem',
    ],
    [
      { event: 'unassigned' as const, staff: morgan, reason: 'not-responding' },
      "Morgan Diaz (Support) took it off Luis Moreno · Courier isn't responding",
    ],
    [{ event: 'escalated' as const }, 'No courier after 5 minutes · Foodz (automatic)'],
    [
      { event: 'search-stopped' as const },
      'Stopped looking for a courier after 60 minutes · Foodz (automatic)',
    ],
    [
      { event: 'search-restarted' as const, staff: { name: 'Foodz Admin', role: 'admin' } },
      'Foodz Admin (Admin) started looking for a courier again',
    ],
    // F8 (design 3.13).
    [{ event: 'at-kitchen' as const }, 'Luis Moreno arrived at the kitchen'],
    [{ event: 'picked-up' as const }, 'Luis Moreno picked it up'],
    [{ event: 'almost-there' as const }, 'Almost there · Foodz (automatic)'],
    [{ event: 'no-answer' as const }, "Luis Moreno: customer isn't answering"],
    [{ event: 'problem' as const, reason: 'address' }, "Luis Moreno: can't find the address"],
    [
      { event: 'asked-to-wait' as const, staff: morgan },
      'Morgan Diaz (Support) asked Luis Moreno to wait 5 more minutes',
    ],
    [{ event: 'otp-wrong' as const, tryNumber: 2 }, 'Delivery code: wrong try (2 of 5)'],
    [{ event: 'otp-locked' as const }, 'Delivery code locked'],
    [
      { event: 'delivered-with-code' as const, cashCents: 5897 },
      'Delivered with the code by Luis Moreno · cash $58.97 collected',
    ],
    [{ event: 'delivered-with-code' as const }, 'Delivered with the code by Luis Moreno'],
    [
      { event: 'handover-confirmed' as const, staff: morgan, reason: 'customer-confirmed' },
      'Hand-over confirmed by Morgan Diaz (Support): Customer confirmed by phone',
    ],
  ])('words %j', (change, words) => {
    expect(courierTimelineWords({ ...base, ...change })).toBe(words);
  });

  it('never names a masked person', () => {
    expect(
      courierTimelineWords({
        ...base,
        event: 'unassigned',
        courierName: null,
        staff: { name: null, role: 'support' },
        reason: 'other',
      }),
    ).toBe('A staff member (Support) took it off A courier · Other');
  });
});

describe('the offers list and the customer line (A36.2, F7 S1 to S2)', () => {
  it('calls only a timed-out offer that was shown a miss', () => {
    expect(outcomeWords('expired', { seen: true, answeredAfterSeconds: null })).toBe('Missed');
    expect(outcomeWords('expired', { seen: false, answeredAfterSeconds: null })).toBe(
      "Didn't reach the phone",
    );
    expect(outcomeWords('accepted', { seen: true, answeredAfterSeconds: 6 })).toBe(
      'Accepted after 6 s',
    );
    expect(outcomeWords('withdrawn-staff', { seen: true, answeredAfterSeconds: null })).toBe(
      'Withdrawn: offered by staff instead',
    );
  });

  it('tells the customer who is coming, and nothing about who was asked', () => {
    expect(customerLine('searching', null)).toBe(
      "It's packed. We're finding a courier to bring it to you.",
    );
    expect(customerLine('assigned', 'Luis')).toBe("It's packed. Luis is on the way to pick it up.");
    expect(customerLine('pickedUp', 'Luis')).toBe('Luis is bringing your order.');
  });
});
