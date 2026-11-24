import { describe, expect, it } from 'vitest';
import {
  cityAndZip,
  courierLineWords,
  courierVehicle,
  customerLine,
  offerWords,
  outcomeWords,
  shortName,
} from './text';

describe('the offer card words (P20.1)', () => {
  it("words Priya's cash order with a $5 tip as the story does", () => {
    expect(
      offerWords({
        kind: 'auto',
        payCents: 764,
        tipCents: 500,
        pickupM: 210,
        dropoffAddress: '1 Faneuil Hall Square, Boston, MA 02109',
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
    });
  });

  it('says "at the kitchen" within 100 m and leaves out a zero tip', () => {
    const words = offerWords({
      kind: 'staff',
      payCents: 529,
      tipCents: 0,
      pickupM: 40,
      dropoffAddress: 'Harvard Square, Cambridge, MA 02138',
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

  it('never shows the street, only the city and ZIP code (U11)', () => {
    expect(cityAndZip('1 Faneuil Hall Square, Boston, MA 02109')).toBe('Boston 02109');
    expect(cityAndZip('12 Peterborough Street, Apt 3, Boston, MA 02215')).toBe('Boston 02215');
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
