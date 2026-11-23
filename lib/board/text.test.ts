import { describe, expect, it } from 'vitest';
import { cardTiming } from '@/server/modules/board/timing';
import {
  at,
  fullCard,
  fullPreview,
  kitchenCard,
  kitchenPreview,
  NOW,
  seed,
  TIMELINE,
  TZ,
} from '@/components/board/board.fixtures';
import {
  alsoSoldOutText,
  backOnlineText,
  boardClock,
  cancelOutcomeLines,
  changedWhileDecidingText,
  clockWithSeconds,
  columnSpoken,
  conflictText,
  countChipText,
  dishChoiceLabels,
  expandLabel,
  goneNotice,
  howItWentLine,
  methodLine,
  movedAnnouncement,
  movedBackAnnouncement,
  newBelowText,
  newOrdersAnnouncement,
  paymentChipText,
  placedLine,
  promisedLine,
  refuseOutcomeText,
  sessionEndingText,
  soldOutStripText,
  tabText,
  timeBlockText,
  timelineText,
  waitingBannerText,
} from './text';

const now = new Date(NOW);
const block = (number: string, clock = now) => {
  const card = kitchenCard(seed(number));
  return timeBlockText(cardTiming(card, clock), card, TZ);
};

describe('the time block (design 2.5, fixtures at 7:30 pm)', () => {
  it('says how each fixture is doing, in words', () => {
    expect(block('S1102')).toMatchObject({
      tone: 'late',
      before: 'Late · waiting',
      figure: '6 min',
      line: 'Placed 7:24 pm',
      spoken: 'Placed 7:24 pm, late, waiting 6 min',
    });
    expect(block('S1101')).toMatchObject({ tone: 'ok', before: 'Waiting', figure: '1 min' });
    expect(block('S1103')).toMatchObject({
      tone: 'ok',
      figure: '16 min',
      after: 'left',
      line: 'Ready by 7:46 pm',
      spoken: 'Ready by 7:46 pm, 16 min left',
    });
    expect(block('S1104')).toMatchObject({ tone: 'soon', before: 'Due in', figure: '3 min' });
    expect(block('S1105')).toMatchObject({ tone: 'late', before: 'Late', figure: '10 min' });
    expect(block('S1106')).toMatchObject({
      tone: 'ok',
      before: 'Ready',
      figure: '4 min',
      line: null,
    });
    expect(block('S1107')).toMatchObject({
      tone: 'late',
      before: 'Waiting',
      figure: '16 min',
      after: 'for pickup',
      spoken: 'Waiting 16 min for pickup',
    });
  });

  it('has words for the first minute', () => {
    expect(block('S1101', new Date(at('19:29')))).toMatchObject({
      before: 'Just in',
      figure: null,
    });
    expect(block('S1104', new Date(at('19:32')))).toMatchObject({
      before: 'Due in',
      figure: '1 min',
    });
    expect(block('S1104', new Date(Date.parse(at('19:33')) - 20_000))).toMatchObject({
      before: 'Due now',
      figure: null,
    });
    expect(block('S1106', new Date(at('19:26')))).toMatchObject({ before: 'Ready just now' });
    // Never "Late 0 min" (design review row 16).
    expect(block('S1104', new Date(Date.parse(at('19:33')) + 20_000))).toMatchObject({
      tone: 'late',
      before: 'Late · just now',
      figure: null,
      spoken: 'Ready by 7:33 pm, late, just now',
    });
  });

  it('reads an order out for delivery', () => {
    const card = fullCard(seed('S1106'), { status: 'PICKED_UP', pickedUpAt: at('19:18') });
    expect(timeBlockText(cardTiming(card, now), card, TZ)).toMatchObject({
      before: 'Out',
      figure: '12 min',
      line: 'Picked up 7:18 pm',
      spoken: 'Picked up 7:18 pm, out 12 min',
    });
  });
});

describe('column words (design 2.3)', () => {
  const count = { shown: 2, total: 2, late: 1, filtered: false };
  it('names columns, tabs and the collapse button', () => {
    expect(columnSpoken('new', count)).toBe('New, 2 orders, 1 late');
    expect(columnSpoken('accepted', { shown: 1, total: 1, late: 0, filtered: false })).toBe(
      'Accepted, 1 order',
    );
    expect(tabText('preparing', count)).toBe('Preparing 2 · 1 late');
    expect(tabText('outForDelivery', { shown: 0, total: 0, late: 0, filtered: false })).toBe(
      'Out 0',
    );
    expect(expandLabel('new', count)).toBe('Expand New column, 2 orders, 1 late');
    expect(newBelowText(1)).toBe('1 new order below');
    expect(newBelowText(2)).toBe('2 new orders below');
  });

  it('says how many are shown with filters on', () => {
    const filtered = { shown: 2, total: 5, late: 0, filtered: true };
    expect(countChipText(filtered)).toBe('2 of 5');
    // An empty column says "0", never "0 of 0" (design review row 17).
    const none = { shown: 0, total: 0, late: 0, filtered: true };
    expect(countChipText(none)).toBe('0');
    expect(columnSpoken('outForDelivery', none)).toBe('Out for delivery, 0 orders');
    expect(columnSpoken('preparing', filtered)).toBe('Preparing, 2 of 5 orders shown');
  });
});

describe('cards (design 2.6)', () => {
  it('words the payment for each role', () => {
    expect(paymentChipText(kitchenCard(seed('S1102')).payment)).toBe('Cash');
    expect(paymentChipText(kitchenCard(seed('S1101')).payment)).toBe('Card · paid');
    expect(paymentChipText(fullCard(seed('S1102')).payment)).toBe('Cash · $23.46 to collect');
    expect(paymentChipText(fullCard(seed('S1101')).payment)).toBe('Card · $53.97 paid');
  });

  it('times read with their minutes', () => {
    expect(boardClock(at('19:00'), TZ)).toBe('7:00 pm');
    expect(clockWithSeconds('2026-11-21T00:31:08.000Z', TZ)).toBe('7:31:08 pm');
  });
});

describe('announcements and notices', () => {
  it('announces new orders and moves', () => {
    expect(newOrdersAnnouncement([{ number: '1043', itemCount: 3 }])).toBe(
      'New order 1043, 3 items',
    );
    expect(
      newOrdersAnnouncement([
        { number: '1043', itemCount: 3 },
        { number: '1044', itemCount: 1 },
        { number: '1045', itemCount: 2 },
      ]),
    ).toBe('3 new orders');
    expect(movedAnnouncement('S1103', 'PREPARING')).toBe('Order S1103 moved to Preparing');
    expect(movedBackAnnouncement('S1103', 'ACCEPTED')).toBe('Order S1103 moved back to Accepted');
  });

  it('says who cancelled a card that left (A3.7)', () => {
    const gone = {
      id: 'x',
      number: '1043',
      status: 'CANCELLED' as const,
      version: 9,
      left: 'cancelled' as const,
      at: NOW,
    };
    expect(goneNotice({ ...gone, by: { kind: 'customer' } })).toBe(
      'Order 1043 was cancelled by the customer.',
    );
    expect(
      goneNotice({ ...gone, by: { kind: 'staff', name: 'Morgan Diaz', role: 'support' } }),
    ).toBe('Order 1043 was cancelled by Morgan Diaz (Support).');
    expect(goneNotice({ ...gone, left: 'delivered', by: null })).toBeNull();
  });

  it('turns ORDER_CHANGED into calm sentences (A5.1, A5.2, A5.4)', () => {
    const alex = { kind: 'staff', name: 'Alex Kim', role: 'kitchen' } as const;
    expect(
      conflictText(
        {
          orderId: 'x',
          number: 'S1103',
          current: { status: 'PREPARING', version: 5 },
          lastChange: { how: 'moved', by: alex, at: at('19:41') },
        },
        'PREPARING',
        TZ,
      ),
    ).toBe('Already cooking · moved by Alex Kim at 7:41 pm');
    expect(
      conflictText(
        {
          orderId: 'x',
          number: '1042',
          current: { status: 'ACCEPTED', version: 7 },
          lastChange: {
            how: 'moved-back',
            by: { kind: 'staff', name: 'Foodz Admin', role: 'admin' },
            at: at('19:41'),
          },
        },
        'READY',
        TZ,
      ),
    ).toBe(
      "Order 1042 changed a moment ago. It's now Accepted (moved back by Foodz Admin). Check it and try again.",
    );
    expect(
      conflictText(
        {
          orderId: 'x',
          number: '1044',
          current: { status: 'CANCELLED', version: 4 },
          lastChange: { how: 'cancelled-by-customer', by: { kind: 'customer' }, at: at('19:31') },
        },
        'ACCEPTED',
        TZ,
      ),
    ).toBe('Order 1044 was cancelled by the customer at 7:31 pm.');
  });

  it('says what changed while a dialog was open (A5.5)', () => {
    expect(
      changedWhileDecidingText(
        '1044',
        'PREPARING',
        { kind: 'staff', name: 'Alex Kim', role: 'kitchen' },
        at('19:44'),
        TZ,
        'Cancel it anyway?',
      ),
    ).toBe(
      "Order 1044 changed while you were deciding. It's now Preparing (Alex Kim, 7:44 pm). Cancel it anyway?",
    );
  });
});

describe('banners (design 1.5)', () => {
  it('words the session, back online and waiting banners', () => {
    expect(sessionEndingText(at('23:42'), TZ)).toBe(
      'Your session ends at 11:42 pm. Sign in again now to keep the board live.',
    );
    expect(backOnlineText(2)).toBe('Back online. 2 orders changed while you were away.');
    expect(backOnlineText(1)).toBe('Back online. 1 order changed while you were away.');
    expect(backOnlineText(0)).toBe('Back online. Nothing changed while you were away.');
    expect(waitingBannerText([{ number: '1042', minutes: 6 }], 5)).toEqual({
      text: "Order 1042 has waited 6 minutes. Accept it, or tell the customer we can't make it.",
      action: 'Show order 1042',
    });
    expect(
      waitingBannerText(
        [
          { number: '1042', minutes: 8 },
          { number: '1043', minutes: 6 },
        ],
        5,
      ),
    ).toEqual({ text: '2 orders have waited over 5 minutes.', action: 'Show the oldest' });
    expect(waitingBannerText([], 5)).toBeNull();
  });

  it('lists sold-out dishes on the strip (design 4.4)', () => {
    expect(soldOutStripText(['Pad Thai', 'Naengmyeon'])).toBe('Sold out: Pad Thai, Naengmyeon');
    expect(soldOutStripText(['Pad Thai', 'Naengmyeon', 'Bulgogi', 'Kimchi', 'Gimbap'])).toBe(
      'Sold out: Pad Thai, Naengmyeon, Bulgogi and 2 more',
    );
  });
});

describe('dialogs (design 3)', () => {
  it('tells apart a dish on two lines by its extras', () => {
    const lines = [
      { ...seed('S1101').lines[0]!, id: 'a', title: 'Gimbap', flavors: ['Gochujang'] },
      { ...seed('S1101').lines[0]!, id: 'b', title: 'Gimbap', flavors: [] },
      { ...seed('S1101').lines[1]!, id: 'c' },
    ];
    expect([...dishChoiceLabels(lines).values()]).toEqual([
      'Gimbap (Gochujang)',
      'Gimbap',
      'Pad Thai',
    ]);
  });

  it('offers to mark ticked dishes sold out, leaving out those already sold out', () => {
    const lines = seed('S1101').lines;
    expect(alsoSoldOutText(lines, [lines[1]!.id])).toBe('Also mark Pad Thai sold out on the menu');
    expect(
      alsoSoldOutText(
        lines,
        lines.map((item) => item.id),
      ),
    ).toBe('Also mark Gimbap and Pad Thai sold out on the menu');
    expect(alsoSoldOutText([{ ...lines[1]!, soldOut: true }], [lines[1]!.id])).toBeNull();
  });

  it('says what will happen', () => {
    expect(refuseOutcomeText(kitchenPreview())).toBe(
      'The customer gets a full refund to their card and a message saying why.',
    );
    expect(refuseOutcomeText(kitchenPreview({ refund: 'none' }))).toBe(
      'Nothing was charged. The customer gets a message saying why.',
    );
    expect(cancelOutcomeLines(fullPreview({ kitchenStarted: true }))).toEqual([
      "We'll refund $59.03 to Visa •••• 4242 in full, tip included. Partial refunds come later, in Refunds.",
      'LASTONE will be released so it can be used again.',
      'The kitchen has already started on this order.',
    ]);
    expect(
      cancelOutcomeLines(fullPreview({ refund: { kind: 'none' }, codeToRelease: null })),
    ).toEqual(["Nothing was charged, so there's nothing to refund."]);
    expect(
      cancelOutcomeLines(fullPreview({ refund: { kind: 'sample' }, codeToRelease: null })),
    ).toEqual(["Sample order: there's no card payment to refund."]);
  });
});

describe('the detail (design 5)', () => {
  it('words times, the promise and how it went', () => {
    expect(placedLine(at('19:12'), now, TZ)).toBe('Placed 7:12 pm · 18 min ago');
    expect(promisedLine(at('20:09'), at('20:19'), TZ)).toBe('Promised for 8:09–8:19 pm');
    expect(
      howItWentLine({ acceptedAfterMinutes: 1, cookedInMinutes: 19, readyLateMinutes: 3 }),
    ).toBe('Accepted after 1 min · cooked in 19 min · ready 3 min late');
    expect(
      howItWentLine({ acceptedAfterMinutes: null, cookedInMinutes: null, readyLateMinutes: null }),
    ).toBeNull();
    expect(
      methodLine({
        method: 'card',
        cardLabel: 'Visa •••• 4242',
        paymentStatus: 'PAID',
        totalCents: 5397,
      }),
    ).toBe('Card · Visa •••• 4242 · Paid');
    expect(
      methodLine({ method: 'cash', cardLabel: null, paymentStatus: 'UNPAID', totalCents: 5397 }),
    ).toBe('Cash · $53.97 to collect');
  });

  it('words every timeline event (story B17)', () => {
    const sentences = TIMELINE.map((entry) => timelineText(entry).sentence);
    expect(sentences).toEqual([
      'Created, waiting for card payment',
      'Placed · paid with Visa •••• 4242',
      'Accepted by Alex Kim (Kitchen)',
      'Cooking started by Alex Kim (Kitchen)',
      'Ready · marked by Alex Kim (Kitchen) · 3 min late',
      'Alex Kim undid Mark ready',
      'Ready · marked by Alex Kim (Kitchen) · on time',
      'Moved back to Preparing by Foodz Admin (Admin): Marked ready by mistake',
      'Refused by Alex Kim (Kitchen): A dish is unavailable (Pad Thai)',
      'Pad Thai marked sold out by Alex Kim (Kitchen)',
      'Cancelled by Morgan Diaz (Support): Customer asked to cancel',
      'Refunded $59.03 to Visa •••• 4242',
      'Picked up · marked by Foodz Admin (Admin): Picked up by our own driver',
      'Delivered · marked by Foodz Admin (Admin) · cash $53.97 collected',
    ]);
    expect(timelineText(TIMELINE[10]!).note).toBe('Called back to confirm');
  });

  it('gives the kitchen refunds without amounts', () => {
    expect(
      timelineText({ ...TIMELINE[11]!, type: 'refunded', amountCents: null, cardLabel: null })
        .sentence,
    ).toBe('Refunded to the customer');
  });
});
