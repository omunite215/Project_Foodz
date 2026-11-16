import { describe, expect, it } from 'vitest';
import type { StoreMoment, StoreStatus } from '@/server/modules/menu/schema';
import {
  cartBadgeText,
  cartCountLabel,
  closedNoticeText,
  containsCode,
  cuisineTabLabel,
  dishesAddedText,
  formatClock,
  formatPrice,
  groupWeeklyHours,
  momentText,
  offerTimeLeft,
  prepTimeText,
  ratingLabel,
  ratingText,
  shortAddress,
  splitByCode,
  starKinds,
  storeStatusText,
} from './format';

const moment = (time: string, day: StoreMoment['day'], weekday: StoreMoment['weekday']) => ({
  at: '2026-11-16T16:00:00.000Z',
  time,
  day,
  weekday,
});

describe('prices', () => {
  it.each([
    [1299, '$12.99'],
    [699, '$6.99'],
    [2200, '$22.00'],
    [0, '$0.00'],
    [123_456, '$1,234.56'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatPrice(cents)).toBe(text);
  });
});

describe('ratings', () => {
  it('reads as a number and a review count', () => {
    expect(ratingText(4.6, 120)).toBe('4.6 · 120 reviews');
    expect(ratingText(5, 1)).toBe('5.0 · 1 review');
    expect(ratingText(4.25, 1200)).toBe('4.3 · 1,200 reviews');
  });

  it('gives screen readers a sentence', () => {
    expect(ratingLabel(4.6, 120)).toBe('rated 4.6 out of 5, 120 reviews');
  });

  it('says so when there are no reviews', () => {
    expect(ratingText(0, 0)).toBe('No reviews yet');
    expect(ratingLabel(0, 0)).toBe('No reviews yet');
  });

  it.each([
    [4.6, ['full', 'full', 'full', 'full', 'half']],
    [4.2, ['full', 'full', 'full', 'full', 'empty']],
    [4.8, ['full', 'full', 'full', 'full', 'full']],
    [4.25, ['full', 'full', 'full', 'full', 'half']],
    [4.75, ['full', 'full', 'full', 'full', 'full']],
    [0, ['empty', 'empty', 'empty', 'empty', 'empty']],
    [5, ['full', 'full', 'full', 'full', 'full']],
    [7, ['full', 'full', 'full', 'full', 'full']],
  ])('draws %f as %j', (average, stars) => {
    expect(starKinds(average)).toEqual(stars);
  });
});

describe('offer countdown', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  const later = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const HOUR = 3_600_000;

  it.each([
    [29 * 24 * HOUR + 5 * HOUR, 'Ends in 29 days'],
    [24 * HOUR, 'Ends in 1 day'],
    [47 * HOUR, 'Ends in 1 day'],
    [5 * HOUR + 59 * 60_000, 'Ends in 5 h'],
    [HOUR, 'Ends in 1 h'],
    [42 * 60_000, 'Ends in 42 min'],
    [10_000, 'Ends in 1 min'],
  ])('%i ms left reads %s', (ms, text) => {
    expect(offerTimeLeft(later(ms), now)).toBe(text);
  });

  it('disappears when the offer has ended, never counting below zero', () => {
    expect(offerTimeLeft(later(0), now)).toBeNull();
    expect(offerTimeLeft(later(-HOUR), now)).toBeNull();
    expect(offerTimeLeft('not a date', now)).toBeNull();
  });
});

describe('store hours', () => {
  it.each([
    ['21:00', '9 pm'],
    ['11:00', '11 am'],
    ['12:00', '12 pm'],
    ['00:00', '12 am'],
    ['11:30', '11:30 am'],
    ['23:05', '11:05 pm'],
  ])('reads %s as %s', (clock, text) => {
    expect(formatClock(clock)).toBe(text);
  });

  it('words the next opening relative to today', () => {
    expect(momentText(moment('11:00', 'tomorrow', 'mon'))).toBe('11 am tomorrow');
    expect(momentText(moment('12:00', 'today', 'sat'))).toBe('12 pm today');
    expect(momentText(moment('12:00', 'later', 'sat'))).toBe('12 pm Saturday');
  });

  // The boundary times from the stories, in Boston time.
  it.each([
    [
      { isOpen: true, closesAt: moment('21:00', 'today', 'sun'), opensAt: null },
      'Open now · until 9 pm',
    ],
    [
      { isOpen: false, closesAt: null, opensAt: moment('11:00', 'tomorrow', 'mon') },
      'Closed · opens 11 am tomorrow',
    ],
    [
      { isOpen: true, closesAt: moment('23:00', 'today', 'fri'), opensAt: null },
      'Open now · until 11 pm',
    ],
    [
      { isOpen: false, closesAt: null, opensAt: moment('12:00', 'today', 'sat') },
      'Closed · opens 12 pm today',
    ],
    [{ isOpen: true, closesAt: null, opensAt: null }, 'Open now'],
    [{ isOpen: false, closesAt: null, opensAt: null }, 'Closed'],
  ] as const)('status %j reads %s', (status, text) => {
    expect(storeStatusText(status)).toBe(text);
  });

  it('tells a closed-store visitor when they can order', () => {
    expect(closedNoticeText(moment('11:00', 'tomorrow', 'mon'))).toBe(
      'You can fill your cart now and order from 11 am tomorrow.',
    );
    expect(closedNoticeText(null)).toBe('You can fill your cart now and order when we open again.');
  });

  it('groups neighbouring days with the same hours', () => {
    const week: StoreStatus['weeklyHours'] = [
      { weekday: 'mon', hours: { open: '11:00', close: '22:00' } },
      { weekday: 'tue', hours: { open: '11:00', close: '22:00' } },
      { weekday: 'wed', hours: { open: '11:00', close: '22:00' } },
      { weekday: 'thu', hours: { open: '11:00', close: '22:00' } },
      { weekday: 'fri', hours: { open: '11:00', close: '23:00' } },
      { weekday: 'sat', hours: { open: '12:00', close: '23:00' } },
      { weekday: 'sun', hours: null },
    ];

    expect(groupWeeklyHours(week)).toEqual([
      { days: 'Mon–Thu', hours: '11 am–10 pm', weekdays: ['mon', 'tue', 'wed', 'thu'] },
      { days: 'Fri', hours: '11 am–11 pm', weekdays: ['fri'] },
      { days: 'Sat', hours: '12 pm–11 pm', weekdays: ['sat'] },
      { days: 'Sun', hours: 'Closed', weekdays: ['sun'] },
    ]);
  });
});

describe('small labels', () => {
  it('counts the cart', () => {
    expect(cartCountLabel(1)).toBe('1 item in your cart');
    expect(cartCountLabel(2)).toBe('2 items in your cart');
    expect(cartBadgeText(99)).toBe('99');
    expect(cartBadgeText(100)).toBe('99+');
  });

  it('confirms what was added', () => {
    expect(dishesAddedText(1)).toBe('1 dish added to your cart');
    expect(dishesAddedText(2)).toBe('2 dishes added to your cart');
  });

  it('names tabs and prep time', () => {
    expect(cuisineTabLabel('KOREAN', 12)).toBe('Korean, 12 dishes');
    expect(cuisineTabLabel('THAI', 1)).toBe('Thai, 1 dish');
    expect(prepTimeText(16)).toBe('Ready in about 16 min');
  });
});

describe('coupon codes in copy', () => {
  it('splits text around the code', () => {
    expect(splitByCode('$5 off Korean dishes over $25 with code KBBQ5', 'KBBQ5')).toEqual([
      { text: '$5 off Korean dishes over $25 with code ', isCode: false, start: 0 },
      { text: 'KBBQ5', isCode: true, start: 40 },
    ]);
    expect(splitByCode('Use code FREEDELIVERY at checkout', 'FREEDELIVERY')).toEqual([
      { text: 'Use code ', isCode: false, start: 0 },
      { text: 'FREEDELIVERY', isCode: true, start: 9 },
      { text: ' at checkout', isCode: false, start: 21 },
    ]);
  });

  it('only matches the code as a whole word', () => {
    expect(splitByCode('Try KBBQ55 or xKBBQ5', 'KBBQ5')).toEqual([
      { text: 'Try KBBQ55 or xKBBQ5', isCode: false, start: 0 },
    ]);
    expect(containsCode('Free delivery on orders over $30', 'FREEDELIVERY')).toBe(false);
    expect(containsCode('KBBQ5', 'KBBQ5')).toBe(true);
  });
});

describe('addresses', () => {
  it('keeps the street and town', () => {
    expect(shortAddress('88 Harbor Street, Boston, MA 02210')).toBe('88 Harbor Street, Boston');
    expect(shortAddress('88 Harbor Street')).toBe('88 Harbor Street');
  });
});
