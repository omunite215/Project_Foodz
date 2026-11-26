import { describe, expect, it } from 'vitest';
import {
  attentionWords,
  customerNotices,
  deliveredWords,
  deliveryLineWords,
  mapStateWords,
  partnerNoticeWords,
} from './text';

const line = {
  tone: 'neutral' as const,
  courierShort: 'Luis M.',
  customerFirst: 'Priya',
  distanceToDoorM: 900,
  arrivalClock: '7:46 pm',
  silentMinutes: 3,
  waitedMinutes: 2,
  problem: null,
};

describe('the Out-for-delivery line (A48.1)', () => {
  it.each([
    ['onTheWay', 'Luis M. · 0.9 km to go · arriving 7:46 pm'],
    ['almost', 'Luis M. · arriving now'],
    ['noLocation', 'Luis M. · no location for 3 min'],
    ['noAnswer', "Luis M. · Priya isn't answering · 2 min"],
    ['askedToWait', "Luis M. · Priya isn't answering · asked to wait · 2 min"],
    ['locked', 'Luis M. · code locked'],
  ] as const)('words %s', (state, words) => {
    expect(deliveryLineWords({ ...line, state }).words).toBe(words);
  });

  it('names the problem and speaks without dots', () => {
    const problem = deliveryLineWords({ ...line, state: 'problem', problem: 'address' });
    expect(problem).toMatchObject({
      words: "Luis M. · problem: can't find the address",
      icon: 'alert',
    });
    expect(deliveryLineWords({ ...line, state: 'almost' }).spoken).toBe('Luis M., arriving now');
    expect(deliveryLineWords({ ...line, state: 'askedToWait' }).icon).toBe('hourglass');
  });
});

describe('banners, the map and the endings (A49, A46.2, P41.3, P44.3, S4)', () => {
  const facts = {
    orderNumber: '1042',
    courierFirst: 'Luis',
    customerFirst: 'Priya',
    minutes: 2,
    problem: null,
  };

  it('words each stuck delivery', () => {
    expect(attentionWords({ ...facts, kind: 'no-answer' })).toBe(
      "Order 1042: Priya isn't answering. Luis has waited 2 minutes.",
    );
    expect(attentionWords({ ...facts, kind: 'locked' })).toBe(
      'Order 1042: the delivery code is locked after 5 wrong tries.',
    );
    expect(attentionWords({ ...facts, kind: 'problem', problem: 'address' })).toBe(
      "Order 1042: Luis can't find the address.",
    );
    expect(attentionWords({ ...facts, kind: 'no-location', minutes: 10 })).toBe(
      'Order 1042: no location from Luis for 10 minutes. Call him.',
    );
  });

  it('labels couriers on the map', () => {
    expect(mapStateWords('free', null, null)).toBe('Free');
    expect(mapStateWords('offered', '1042', null)).toBe('Offered 1042');
    expect(mapStateWords('toKitchen', '1042', null)).toBe('To kitchen · 1042');
    expect(mapStateWords('delivering', '1042', null)).toBe('Delivering 1042');
    expect(mapStateWords('delivering', '1042', 3)).toBe('No location · 3 min');
  });

  it('words the endings without a staff name, and never puts the code in a notice', () => {
    expect(deliveredWords('1042', 764)).toBe('Order 1042 delivered · You earned $7.64');
    expect(partnerNoticeWords('confirmed', '1042', 'Priya', 764)).toBe(
      'Foodz support confirmed order 1042 as delivered. You earned $7.64.',
    );
    expect(partnerNoticeWords('cancelledBringBack', '1042', 'Priya', 764)).toBe(
      'Order 1042 was cancelled. Bring the food back to Foodz Kitchen.',
    );
    const almost = customerNotices.almostHere('1042', 'Luis', 2);
    expect(almost.body).toBe(
      'Luis is about 2 minutes away. Your delivery code is on your order page.',
    );
    // The notices take no code at all: the page is where it lives (U4).
    expect(customerNotices.almostHere.length).toBe(3);
    expect(customerNotices.atDoor('Luis', '(617) 555-0142').body).toContain('with your code');
  });
});
