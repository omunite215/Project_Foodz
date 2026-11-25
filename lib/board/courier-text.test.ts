import { describe, expect, it } from 'vitest';
import type { BoardCourier } from '@/server/modules/delivery/schema';
import {
  acceptedAt,
  assignRowLine,
  assignRowSpoken,
  assignTags,
  cardTone,
  courierLineText,
  courierLinesToRead,
  courierMenuFor,
  courierReadKey,
  couriersChipText,
  newerCouriersCount,
  deliveryChangedText,
  holdingCourier,
  isDeliveryChangedDetails,
  noCourierBannerText,
  noCourierOrders,
  nobodyOnline,
  offerRowDetails,
  offerSecondsLeft,
  offlineCountText,
  outcomeLook,
  outcomeText,
  shortOf,
  takeOffOutcome,
  vehicleSpoken,
} from './courier-text';

const TZ = 'America/New_York';
const NOW = new Date('2026-11-21T00:40:00.000Z');

const line = (patch: Partial<BoardCourier>): BoardCourier => ({
  state: 'between',
  tone: 'neutral',
  words: 'Finding a courier · within 4 km',
  expiresAt: null,
  offeredBy: null,
  shortName: null,
  vehicleWords: null,
  plate: null,
  distanceWords: null,
  deliveryVersion: 3,
  ...patch,
});

describe('the courier line', () => {
  it('adds the seconds of an open offer from the server clock', () => {
    const offered = line({
      state: 'offered',
      words: 'Offered to Grace O.',
      shortName: 'Grace O.',
      expiresAt: new Date(NOW.getTime() + 24_500).toISOString(),
    });
    expect(courierLineText(offered, NOW)).toMatchObject({
      words: 'Offered to Grace O.',
      seconds: '24 s left',
      spoken: 'Courier: offered to Grace O., 24 seconds left',
    });
    expect(offerSecondsLeft(new Date(NOW.getTime() - 5_000).toISOString(), NOW)).toBe(0);
    expect(offerSecondsLeft(null, NOW)).toBeNull();
  });

  it('keeps the capital of a name at the start of the spoken line (review S4)', () => {
    const staff = line({
      state: 'staffOffered',
      words: 'Morgan offered it to Luis M.',
      shortName: 'Luis M.',
      offeredBy: 'Morgan',
      expiresAt: new Date(NOW.getTime() + 58_200).toISOString(),
    });
    expect(courierLineText(staff, NOW).spoken).toBe(
      'Courier: Morgan offered it to Luis M., 58 seconds left',
    );
    expect(
      courierLineText(line({ state: 'starting', words: 'Finding a courier…' }), NOW).spoken,
    ).toBe('Courier: finding a courier…');
  });

  it('spells out an assigned courier for screen readers', () => {
    const assigned = line({
      state: 'assigned',
      tone: 'positive',
      words: 'Luis M. · Scooter 7KT 342 · 0.9 km away',
      shortName: 'Luis M.',
      vehicleWords: 'Scooter · 7KT 342',
      plate: '7KT 342',
      distanceWords: '0.9 km away',
    });
    expect(courierLineText(assigned, NOW).spoken).toBe(
      'Courier: Luis M., scooter, plate 7KT 342, 0.9 km away',
    );
    // Out for delivery: the name and vehicle only, neutral (A34.2).
    expect(courierLineText(assigned, NOW, 'PICKED_UP')).toMatchObject({
      words: 'Luis M. · Scooter 7KT 342',
      tone: 'neutral',
      spoken: 'Courier: Luis M., scooter, plate 7KT 342',
    });
    expect(vehicleSpoken('Bicycle')).toBe('bicycle');
    expect(vehicleSpoken(null)).toBeNull();
  });

  it('reads red and amber states as words', () => {
    expect(
      courierLineText(
        line({ state: 'escalated', tone: 'red', words: 'No courier after 5 min · still looking' }),
        NOW,
      ).spoken,
    ).toBe('Courier: no courier after 5 min, still looking');
    expect(
      courierLineText(
        line({
          state: 'assignedStale',
          tone: 'amber',
          words: 'Luis M. · no location for 12 min',
          shortName: 'Luis M.',
        }),
        NOW,
      ).spoken,
    ).toBe('Courier: Luis M., no location for 12 min');
  });

  it('gives the card the worse of the time and courier tones', () => {
    expect(cardTone('ok', 'red')).toBe('late');
    expect(cardTone('ok', 'amber')).toBe('soon');
    expect(cardTone('late', 'amber')).toBe('late');
    expect(cardTone('soon', 'positive')).toBe('soon');
    expect(cardTone('ok', null)).toBe('ok');
  });
});

const ready = (patch: Partial<BoardCourier>) => ({ status: 'READY', courier: line(patch) });

const readyCard = (patch: {
  id?: string;
  status?: string;
  version?: number;
  courier?: BoardCourier | null;
}) => ({
  id: 'a',
  status: 'READY',
  version: 4,
  courier: null,
  ...patch,
});

describe('reading the courier line of a card that just became Ready (A34.1)', () => {
  const card = readyCard;

  it('asks for Ready cards without a line, once per card version', () => {
    const cards = [
      card({}),
      card({ id: 'b', courier: line({ state: 'starting' }) }),
      card({ id: 'c', status: 'COOKING' }),
      card({ id: 'd', status: 'PICKED_UP' }),
    ];
    expect(courierLinesToRead(cards, new Set())).toEqual(['a']);
    const asked = new Set([courierReadKey(cards[0]!)]);
    expect(courierLinesToRead(cards, asked)).toEqual([]);
    // Undone and marked ready again: a new version, read again.
    expect(courierLinesToRead([card({ version: 6 })], asked)).toEqual(['a']);
  });
});

describe('the couriers count from the ops channel (A35.1)', () => {
  it('takes a count read later than the one shown, and skips an older one', () => {
    const at = '2026-11-21T00:40:05.000Z';
    expect(newerCouriersCount(0, { online: 3, free: 2, at })).toEqual({
      count: { online: 3, free: 2 },
      at: Date.parse(at),
    });
    expect(newerCouriersCount(Date.parse(at) + 1, { online: 2, free: 1, at })).toBeNull();
    expect(newerCouriersCount(0, { online: 2, free: 1, at: 'not a time' })).toBeNull();
  });
});

describe('the card menu and banners', () => {
  it('offers courier items to support and admin only, by state', () => {
    expect(courierMenuFor(ready({ state: 'between' }), 'full')).toEqual(['assignCourier']);
    expect(courierMenuFor(ready({ state: 'notLooking' }), 'full')).toEqual([
      'assignCourier',
      'findCourier',
    ]);
    expect(courierMenuFor(ready({ state: 'assigned' }), 'full')).toEqual([
      'takeOffCourier',
      'chooseAnother',
    ]);
    expect(courierMenuFor(ready({ state: 'between' }), 'kitchen')).toEqual([]);
    expect(
      courierMenuFor({ status: 'PICKED_UP', courier: line({ state: 'assigned' }) }, 'full'),
    ).toEqual([]);
  });

  it('names who holds a ready order', () => {
    expect(holdingCourier(line({ state: 'assigned', shortName: 'Luis M.' }))).toBe('Luis M.');
    expect(holdingCourier(line({ state: 'offered', shortName: 'Grace O.' }))).toBeNull();
    expect(holdingCourier(null)).toBeNull();
  });

  it('words the no-courier banners per role', () => {
    const one = [{ number: '1042' }];
    expect(noCourierBannerText(one, 'full')).toEqual({
      text: 'Order 1042 has no courier after 5 minutes. Assign one, or call the customer.',
      action: 'assign',
    });
    expect(noCourierBannerText(one, 'kitchen')?.text).toBe(
      'Order 1042 has no courier after 5 minutes. Ask support or the shift lead to assign one.',
    );
    expect(noCourierBannerText([...one, { number: '1043' }], 'kitchen')).toEqual({
      text: '2 ready orders have no courier.',
      action: 'show',
    });
    expect(noCourierBannerText([], 'full')).toBeNull();
    const cards = [ready({ state: 'escalated' }), ready({ state: 'nobodyOnline' })];
    expect(noCourierOrders(cards)).toHaveLength(1);
    expect(nobodyOnline(cards)).toBe(true);
  });

  it('counts couriers without names', () => {
    expect(couriersChipText({ online: 4, free: 2 })).toEqual({
      text: 'Couriers · 4 online · 2 free',
      spoken: 'Couriers: 4 online, 2 free',
    });
    expect(couriersChipText({ online: 0, free: 0 }).text).toBe('No couriers online');
  });
});

describe('the offers list', () => {
  it('styles and words each outcome', () => {
    expect(outcomeLook('accepted', 'Accepted after 6 s')).toBe('accepted');
    expect(outcomeLook('expired', 'Missed')).toBe('missed');
    expect(outcomeLook('expired', "Didn't reach the phone")).toBe('unseen');
    expect(outcomeLook('declined', 'Declined after 4 s')).toBe('plain');
    expect(outcomeText('open', 'Open', new Date(NOW.getTime() + 24_000).toISOString(), NOW)).toBe(
      'Open · 24 s left',
    );
    expect(outcomeText('declined', 'Declined after 4 s', null, NOW)).toBe('Declined after 4 s');
  });

  it('describes who sent each offer and when it was seen', () => {
    expect(
      offerRowDetails(
        {
          sentBy: 'Foodz (automatic)',
          reachWords: 'Within 2 km',
          distanceWords: '1.4 km from the kitchen',
          seenAt: '2026-11-21T00:40:13.000Z',
        },
        TZ,
      ),
    ).toBe('Foodz (automatic) · Within 2 km · 1.4 km from the kitchen · Seen 7:40:13 pm');
    expect(
      offerRowDetails(
        {
          sentBy: 'Morgan Diaz (Support)',
          reachWords: null,
          distanceWords: '0.6 km from the kitchen',
          seenAt: null,
        },
        TZ,
      ),
    ).toBe('Morgan Diaz (Support) · 0.6 km from the kitchen');
    expect(acceptedAt({ at: '2026-11-21T00:42:00.000Z', outcomeWords: 'Accepted after 6 s' })).toBe(
      '2026-11-21T00:42:06.000Z',
    );
  });
});

describe('the assign and take-off dialogs', () => {
  const row = {
    name: 'Grace Okafor',
    words: 'Grace Okafor · Bicycle · 1.4 km from the kitchen · waiting 10 min',
  };

  it('splits and speaks a courier row', () => {
    expect(assignRowLine(row)).toBe('Bicycle · 1.4 km from the kitchen · waiting 10 min');
    expect(assignRowSpoken(row)).toBe(
      'Grace Okafor, bicycle, 1.4 km from the kitchen, waiting 10 minutes',
    );
    expect(
      assignRowSpoken({
        name: 'Lena Fischer',
        words: 'Lena Fischer · Bicycle · no location · waiting 1 min',
      }),
    ).toBe('Lena Fischer, bicycle, no location, waiting 1 minute');
  });

  it('words the tags and the offline count', () => {
    expect(
      assignTags(
        {
          declinedAt: '2026-11-21T00:41:00.000Z',
          gaveBackAt: '2026-11-21T00:45:00.000Z',
          staleMinutes: 3,
          outOfRangeKm: 8.4,
        },
        TZ,
      ),
    ).toEqual([
      'Declined this order at 7:41 pm',
      'Gave back this order at 7:45 pm',
      'Location not shared for 3 min',
      '8.4 km away, outside the 8 km range',
    ]);
    expect(offlineCountText(3)).toBe("3 approved couriers are offline and can't be assigned.");
    expect(offlineCountText(1)).toBe("1 approved courier is offline and can't be assigned.");
  });

  it('names people the board way', () => {
    expect(shortOf('Grace Okafor')).toBe('Grace O.');
    expect(shortOf('Riley')).toBe('Riley');
    expect(takeOffOutcome('Luis M.')).toBe(
      "We'll tell Luis and start looking for another courier. Luis won't be offered this order again automatically.",
    );
  });

  it('says what changed meanwhile', () => {
    const accepted = {
      orderId: 'o1',
      current: { status: 'ASSIGNED' as const, version: 7 },
      how: 'accepted' as const,
      by: { kind: 'partner' as const, shortName: 'Luis M.' },
      at: '2026-11-21T00:46:00.000Z',
    };
    expect(isDeliveryChangedDetails(accepted)).toBe(true);
    expect(isDeliveryChangedDetails({ how: 'x' })).toBe(false);
    expect(deliveryChangedText('1042', accepted, TZ, 'fallback')).toBe(
      'Luis M. accepted order 1042 a moment ago.',
    );
    expect(
      deliveryChangedText(
        '1042',
        {
          ...accepted,
          how: 'offered',
          by: { kind: 'staff', name: 'Morgan Diaz', role: 'support' },
        },
        TZ,
        'fallback',
      ),
    ).toBe(
      'Order 1042 changed a moment ago: Morgan Diaz offered it to a courier at 7:46 pm. Check it and try again.',
    );
    expect(
      deliveryChangedText(
        '1042',
        { ...accepted, how: 'other', by: { kind: 'system' } },
        TZ,
        'fallback',
      ),
    ).toBe('fallback');
  });
});
