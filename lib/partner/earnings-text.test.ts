import { describe, expect, it } from 'vitest';
import type { CashBreakdown, EarningsRow } from '@/server/modules/earnings/schema';
import {
  barShare,
  cashCardWords,
  compareLine,
  dayButtonName,
  dayHeader,
  dayLabel,
  daysLabel,
  deliveredTodayLine,
  deliveryRowName,
  deliverySubtitle,
  durationWords,
  endedWords,
  figuresLine,
  goalChoiceOf,
  goalFromChoice,
  goalOfWords,
  goalReachedAnnouncement,
  keepsFeeSentence,
  listLoadView,
  loadView,
  noEarningsCopy,
  longAmount,
  nextWeekName,
  offlineLine,
  opensSheet,
  parseGoalDollars,
  periodAnnouncement,
  previousWeekName,
  ratingsRowLine,
  ratingsSentence,
  ringSentence,
  rowAmount,
  rowFirstLine,
  rowSecondLine,
  shortDay,
  shortRange,
  spokenDuration,
  spokenRange,
  stepWords,
  tagSentence,
  todayLine,
  weekRangeWords,
  weekTitle,
  wholeDollars,
  workedOutRows,
  workedOutStart,
  workedOutTotal,
} from './earnings-text';

const TZ = 'America/New_York';
// T = Fri, Nov 20, 2026, 7:46 pm in Boston.
const T = '2026-11-21T00:46:00.000Z';

const row = (overrides: Partial<EarningsRow>): EarningsRow => ({
  id: 'r1',
  kind: 'delivery',
  at: T,
  deliveryId: 'd1',
  orderNumber: '1042',
  areaWords: 'Boston 02109',
  amountCents: 764,
  tipCents: 500,
  cashCents: 5897,
  message: null,
  method: null,
  reference: null,
  ...overrides,
});

describe('money and durations (B12)', () => {
  it('writes whole-dollar goals without cents', () => {
    expect(wholeDollars(4000)).toBe('$40');
    expect(wholeDollars(100_000)).toBe('$1,000');
    expect(wholeDollars(4050)).toBe('$40.50');
  });

  it('pads minutes once hours show', () => {
    expect(durationWords(0)).toBe('0 min');
    expect(durationWords(45 * 60 + 59)).toBe('45 min');
    expect(durationWords(2 * 3600 + 11 * 60)).toBe('2 h 11 min');
    expect(durationWords(13 * 3600 + 6 * 60)).toBe('13 h 06 min');
  });

  it('speaks durations in words', () => {
    expect(spokenDuration(2 * 3600 + 11 * 60)).toBe('2 hours 11 minutes');
    expect(spokenDuration(3600)).toBe('1 hour');
    expect(spokenDuration(60)).toBe('1 minute');
  });

  it('builds the figures line', () => {
    expect(figuresLine({ deliveries: 3, tipsCents: 800, onlineSeconds: 7860 })).toBe(
      '3 deliveries · $8.00 tips · online 2 h 11 min',
    );
    expect(figuresLine({ deliveries: 1, tipsCents: 0, onlineSeconds: 0 })).toBe(
      '1 delivery · $0.00 tips · online 0 min',
    );
  });

  it('steps the ring amount down from 8 characters', () => {
    expect(longAmount(1957)).toBe(false);
    expect(longAmount(100_000)).toBe(true);
  });
});

describe('dates and the week (1.2, 1.6)', () => {
  it('formats store dates without a zone shift', () => {
    expect(shortDay('2026-11-20')).toBe('Fri, Nov 20');
    expect(weekRangeWords('2026-11-16', '2026-11-22')).toBe('Mon, Nov 16 – Sun, Nov 22');
    expect(shortRange('2026-11-16', '2026-11-22')).toBe('Nov 16 – 22');
    expect(shortRange('2026-11-30', '2026-12-06')).toBe('Nov 30 – Dec 6');
    expect(spokenRange('2026-11-09', '2026-11-15')).toBe('Nov 9 to 15');
  });

  it('names the week arrows after the week they open', () => {
    expect(previousWeekName('2026-11-16')).toBe('Previous week, Nov 9 to 15');
    expect(nextWeekName('2026-11-16')).toBe('Next week, Nov 23 to 29');
  });

  it('titles a week by its distance from this one', () => {
    expect(weekTitle('2026-11-16', '2026-11-16')).toBe('This week');
    expect(weekTitle('2026-11-09', '2026-11-16')).toBe('Last week');
    expect(weekTitle('2026-11-02', '2026-11-16')).toBe('Week of Nov 2');
  });

  it('compares with the week before, never on the first week', () => {
    expect(compareLine({ isCurrent: true, previousWeekEarnedCents: 9640 })).toBe(
      'Last week: $96.40',
    );
    expect(compareLine({ isCurrent: false, previousWeekEarnedCents: 0 })).toBe(
      'Week before: $0.00',
    );
    expect(compareLine({ isCurrent: false, previousWeekEarnedCents: null })).toBeNull();
  });

  it('names each day button from its parts', () => {
    expect(daysLabel('2026-11-16', '2026-11-22')).toBe('Days, Mon, Nov 16 to Sun, Nov 22');
    expect(
      dayButtonName({ date: '2026-11-18', earnedCents: 4185, deliveries: 6, state: 'past' }),
    ).toBe('Wednesday, Nov 18: $41.85, 6 deliveries');
    expect(
      dayButtonName({ date: '2026-11-20', earnedCents: 1957, deliveries: 3, state: 'today' }),
    ).toBe('Friday, Nov 20, today: $19.57, 3 deliveries');
    expect(
      dayButtonName({ date: '2026-11-17', earnedCents: 0, deliveries: 0, state: 'past' }),
    ).toBe('Tuesday, Nov 17: no deliveries');
    expect(
      dayButtonName({ date: '2026-11-21', earnedCents: 0, deliveries: 0, state: 'future' }),
    ).toBe("Saturday, Nov 21: hasn't happened yet");
    expect(dayLabel({ date: '2026-11-20', earnedCents: 0, deliveries: 0, state: 'today' })).toBe(
      'Today',
    );
    expect(dayLabel({ date: '2026-11-16', earnedCents: 0, deliveries: 0, state: 'past' })).toBe(
      'Mon',
    );
  });

  it('sizes bars against the best day with a sliver above $0', () => {
    expect(barShare(4185, 4185)).toBe(1);
    expect(barShare(0, 4185)).toBe(0);
    expect(barShare(10, 4185)).toBe(0.05);
  });

  it('heads each day with what he earned', () => {
    expect(dayHeader('2026-11-20', '2026-11-20', 1957)).toBe('Today · $19.57');
    expect(dayHeader('2026-11-19', '2026-11-20', 3620)).toBe('Thursday, Nov 19 · $36.20');
    expect(periodAnnouncement('Last week', 9640)).toBe('Last week: $96.40');
  });
});

describe('today and the goal (1.4, 1.5)', () => {
  it('speaks the ring', () => {
    expect(goalOfWords(4000)).toBe('of $40 goal');
    expect(ringSentence(1957, 4000)).toBe('Today $19.57 of your $40 goal, 49 percent');
    expect(ringSentence(4120, 4000)).toBe('Today $41.20, goal of $40 reached');
    expect(goalReachedAnnouncement(4120)).toBe('Goal reached. $41.20 today.');
  });

  it('never preselects a goal for a partner without one (U7)', () => {
    expect(goalChoiceOf(null)).toBeNull();
    expect(goalChoiceOf(5000)).toBe(5000);
    expect(goalChoiceOf(4000)).toBe('custom');
  });

  it('parses whole dollars from $10 to $1,000', () => {
    expect(parseGoalDollars('40')).toBe(4000);
    expect(parseGoalDollars('$1,000')).toBe(100_000);
    expect(parseGoalDollars('9')).toBeNull();
    expect(parseGoalDollars('1001')).toBeNull();
    expect(parseGoalDollars('40.50')).toBeNull();
    expect(parseGoalDollars('')).toBeNull();
    expect(goalFromChoice('none', '')).toBeNull();
    expect(goalFromChoice(10_000, '')).toBe(10_000);
    expect(goalFromChoice('custom', 'abc')).toBeUndefined();
  });
});

describe('the list rows (1.7)', () => {
  it('writes a cash delivery with its tip', () => {
    const delivery = row({});
    expect(rowFirstLine(delivery, TZ)).toBe('7:46 pm · Order 1042 · Boston 02109');
    expect(rowSecondLine(delivery, TZ)).toBe('includes $5.00 tip · cash collected $58.97');
    expect(rowAmount(delivery)).toBe('$7.64');
    expect(deliveryRowName(delivery, TZ)).toBe(
      'Order 1042, 7:46 pm, $7.64, includes $5.00 tip, cash collected $58.97',
    );
    expect(opensSheet(delivery)).toBe(true);
  });

  it('leaves the second line out for a card delivery without a tip', () => {
    expect(rowSecondLine(row({ tipCents: null, cashCents: null }), TZ)).toBeNull();
  });

  it('writes a cancellation after pickup', () => {
    const cancelled = row({ kind: 'cancelledAfterPickup', orderNumber: '1043', amountCents: 264 });
    expect(rowFirstLine(cancelled, TZ)).toBe('7:46 pm · Order 1043 · cancelled after pickup');
    expect(rowSecondLine(cancelled, TZ)).toBe('delivery fee');
  });

  it('writes staff rows with their time first on the second line', () => {
    const at = '2026-11-20T19:10:00.000Z'; // 2:10 pm
    const cash = row({ kind: 'cashHandedIn', at, amountCents: 8495, deliveryId: null });
    expect(rowFirstLine(cash, TZ)).toBe('Cash handed in');
    expect(rowSecondLine(cash, TZ)).toBe('2:10 pm · Recorded by Foodz support');
    expect(rowAmount(cash)).toBe('$84.95');
    expect(opensSheet(cash)).toBe(false);

    const added = row({
      kind: 'added',
      at,
      amountCents: 300,
      message: 'Waited 20 min at the kitchen for order 1050.',
    });
    expect(rowFirstLine(added, TZ)).toBe('Added by Foodz');
    expect(rowSecondLine(added, TZ)).toBe('2:10 pm · Waited 20 min at the kitchen for order 1050.');
    expect(rowAmount(added)).toBe('+$3.00');

    const takenOff = row({ kind: 'takenOff', at, amountCents: -200, message: null });
    expect(rowFirstLine(takenOff, TZ)).toBe('Taken off by Foodz');
    expect(rowSecondLine(takenOff, TZ)).toBe('2:10 pm');
    expect(rowAmount(takenOff)).toBe('−$2.00');

    const payout = row({
      kind: 'payout',
      at,
      amountCents: 9640,
      method: 'bank-transfer',
      reference: 'Week of Nov 9',
    });
    expect(rowFirstLine(payout, TZ)).toBe('Paid to you · Bank transfer');
    expect(rowSecondLine(payout, TZ)).toBe('2:10 pm · Week of Nov 9');
    expect(rowAmount(payout)).toBe('$96.40');
    expect(rowSecondLine(row({ kind: 'payout', at, reference: null }), TZ)).toBe('2:10 pm');
  });
});

describe('the delivery sheet (1.8)', () => {
  it('writes the subtitle, steps and ending', () => {
    expect(
      deliverySubtitle({ date: '2026-11-20', areaWords: 'Boston 02109', distanceKm: 1.3 }),
    ).toBe('Fri, Nov 20 · Boston 02109 · 1.3 km from the kitchen');
    expect(deliverySubtitle({ date: '2026-11-20', areaWords: null, distanceKm: null })).toBe(
      'Fri, Nov 20',
    );
    expect(stepWords({ kind: 'pickedUp', at: '2026-11-21T00:42:00.000Z' }, TZ)).toBe(
      'Picked up 7:42 pm',
    );
    expect(endedWords('code')).toBe('Delivered with the code');
    expect(endedWords('demo')).toBe('Delivered with the code');
    expect(endedWords('staff-confirmed')).toBe('Confirmed by Foodz support');
    expect(endedWords('admin-override')).toBe('Marked delivered by Foodz');
    expect(endedWords('cancelled-after-pickup')).toMatch(/^Cancelled after pickup\./);
  });
});

describe('cash (1.3, 1.9)', () => {
  it('words the three card states', () => {
    expect(cashCardWords({ state: 'owesYou', balanceCents: 6705, holdingCents: 5897 })).toEqual({
      heading: 'Foodz owes you $67.05',
      body: "You're holding $58.97 in customers' cash. It's taken off what Foodz pays you. Foodz pays on Mondays for the week before.",
    });
    expect(cashCardWords({ state: 'owesYou', balanceCents: 9640, holdingCents: 0 }).body).toBe(
      'Foodz pays on Mondays for the week before.',
    );
    expect(cashCardWords({ state: 'handIn', balanceCents: -14270, holdingCents: 16480 })).toEqual({
      heading: 'Hand in $142.70',
      body: "You've collected more cash than Foodz owes you. Hand it in at Foodz Kitchen, 88 Harbor Street.",
    });
    expect(cashCardWords({ state: 'square', balanceCents: 0, holdingCents: 0 })).toEqual({
      heading: "You're all square.",
      body: null,
    });
  });

  const breakdown: CashBreakdown = {
    from: 'payout',
    fromAt: '2026-11-16T15:05:00.000Z',
    payoutCents: 9640,
    carriedCents: 0,
    earnedCents: 12_602,
    cashCollectedCents: 14_392,
    cashHandedInCents: 8495,
    resultCents: 6705,
  };

  it('explains the balance from the last payout', () => {
    expect(workedOutStart(breakdown, TZ)).toBe('Last payout: Mon, Nov 16 · $96.40');
    expect(workedOutRows(breakdown)).toEqual([
      { label: 'You earned', value: '$126.02' },
      { label: 'Cash you collected', value: '−$143.92' },
      { label: 'Cash you handed in', value: '+$84.95' },
    ]);
    expect(workedOutTotal(6705)).toEqual({
      label: '= Foodz owes you',
      spokenLabel: 'Equals: Foodz owes you',
      value: '$67.05',
      spoken: 'Equals: Foodz owes you $67.05',
    });
    expect(workedOutTotal(-14_270).label).toBe('= You hand in');
    expect(workedOutTotal(0).spoken).toBe("Equals: You're all square");
  });

  it('adds "Carried over" when a payout left a balance (conflict 10)', () => {
    expect(workedOutRows({ ...breakdown, carriedCents: 1200 })[0]).toEqual({
      label: 'Carried over',
      value: '$12.00',
    });
    expect(workedOutRows({ ...breakdown, carriedCents: -500 })[0]?.value).toBe('−$5.00');
  });

  it('starts from the first delivery without a payout', () => {
    expect(
      workedOutStart(
        { ...breakdown, from: 'firstDelivery', fromAt: '2026-11-09T17:00:00.000Z' },
        TZ,
      ),
    ).toBe('Since your first delivery: Mon, Nov 9');
    expect(workedOutStart({ ...breakdown, from: 'none', fromAt: null }, TZ)).toBeNull();
  });

  it('dates offline figures', () => {
    expect(offlineLine('2026-11-21T00:52:00.000Z', TZ)).toBe('Offline · figures from 7:52 pm');
  });
});

describe('Home, the delivered screen and the cancel notice (1.11)', () => {
  it('writes the Home line', () => {
    expect(todayLine({ earnedCents: 1957, deliveries: 3 })).toBe('Today · $19.57 · 3 deliveries');
    expect(todayLine({ earnedCents: 764, deliveries: 1 })).toBe('Today · $7.64 · 1 delivery');
    expect(todayLine({ earnedCents: 0, deliveries: 0 })).toBe('Today · no deliveries yet');
    expect(todayLine({ earnedCents: 300, deliveries: 0 })).toBe('Today · $3.00 · 0 deliveries');
  });

  it('writes the delivered line and the fee sentence', () => {
    expect(deliveredTodayLine({ earnedCents: 1957, deliveries: 3 })).toBe(
      'Today: $19.57 · 3 deliveries',
    );
    expect(keepsFeeSentence(264)).toBe("You'll still get the $2.64 delivery fee.");
  });
});

describe('ratings (1.12)', () => {
  it('words the Profile row from the published figure', () => {
    expect(ratingsRowLine(null)).toBe('No ratings yet');
    expect(ratingsRowLine({ average: 4.5, count: 8 })).toBe(
      '4.5 · 8 ratings · Updates after every 5 new ratings',
    );
    expect(ratingsRowLine({ average: 5, count: 1 })).toBe(
      '5.0 · 1 rating · Customers see your rating once you have 5.',
    );
  });

  it('speaks the summary and the tag counts', () => {
    expect(ratingsSentence(4.5, 8)).toBe(
      'Rated 4.5 out of 5 from 8 ratings, updates after every 5 new ratings',
    );
    expect(ratingsSentence(4.6, 3)).toBe('Rated 4.6 out of 5 from 3 ratings');
    expect(tagSentence('friendly', 5)).toBe('Friendly, picked 5 times');
    expect(tagSentence('late', 1)).toBe('Late, picked once');
  });
});

describe('loading states (review S4, S5, P5)', () => {
  it('never leaves a paused read on its skeleton', () => {
    expect(loadView({ hasData: false, isError: false, paused: true })).toBe('offline');
    expect(loadView({ hasData: false, isError: false, paused: false })).toBe('skeleton');
    expect(loadView({ hasData: false, isError: true, paused: true })).toBe('error');
    expect(loadView({ hasData: true, isError: true, paused: true })).toBe('data');
  });

  it('shows one problem block, not one for the week and one for the list', () => {
    expect(listLoadView('error', 'error')).toBe('hidden');
    expect(listLoadView('offline', 'offline')).toBe('hidden');
    expect(listLoadView('error', 'data')).toBe('error');
    expect(listLoadView('skeleton', 'data')).toBe('skeleton');
  });

  it("doesn't tell a suspended partner to go online", () => {
    expect(noEarningsCopy(true)).toEqual({
      heading: 'No earnings yet',
      line: null,
      homeAction: false,
    });
    expect(noEarningsCopy(false).line).toMatch(/^Go online to get your first order\./);
    expect(noEarningsCopy(false).homeAction).toBe(true);
  });
});
