import { describe, expect, it } from 'vitest';
import {
  acceptName,
  deliverPaymentWords,
  earnWords,
  endedNotice,
  goneNotice,
  howOffersWorkItems,
  isApplePhone,
  kitchenLine,
  leavingWords,
  mapsHref,
  missedNotice,
  offerKindLine,
  offerSummary,
  offerTitle,
  payLabel,
  phoneDisplay,
  pickUpPaymentWords,
  releaseNotice,
  RING_LENGTH,
  ringOffset,
  secondsLeft,
  telHref,
  withoutThen,
} from './offer-text';

describe('the offer card', () => {
  it('names the dialog and the band by the kind of offer', () => {
    expect(offerTitle('auto')).toBe('New order');
    expect(offerTitle('staff')).toBe('New order');
    expect(offerTitle('practice')).toBe('Practice offer');
    expect(offerTitle(null)).toBe('New order');
    expect(offerKindLine('auto')).toBeNull();
    expect(offerKindLine('staff')).toBe('Foodz support picked you for this order.');
    expect(offerKindLine('practice')).toBe("It isn't a real order.");
    expect(payLabel('practice')).toBe("You'd earn");
    expect(payLabel('auto')).toBe('You earn');
  });

  it('names the slider with the pay', () => {
    expect(acceptName({ kind: 'auto', payText: '$7.64' })).toBe('Accept order, earn $7.64');
    expect(acceptName({ kind: 'practice', payText: '$5.64' })).toBe('Accept practice offer');
    expect(acceptName(null)).toBe('Accept order');
  });

  it('adds the seconds left to the server summary', () => {
    const summary =
      'You earn $7.64, includes $5.00 tip. Foodz Kitchen · 0.2 km from you. Boston 02109 · 1.3 km from the kitchen. 3 items. Cash order · collect $58.97';
    expect(offerSummary(summary, 27)).toBe(`${summary}. 27 seconds to answer.`);
    expect(offerSummary(`${summary}.`, 1)).toBe(`${summary}. 1 second to answer.`);
    expect(offerSummary(null, 30)).toBe('Loading the offer… 30 seconds to answer.');
  });
});

describe('the countdown', () => {
  const expiresAt = '2026-11-20T23:40:30.000Z';
  const opened = Date.parse('2026-11-20T23:40:00.000Z');

  it('counts on the server clock, never below zero', () => {
    expect(secondsLeft(expiresAt, 0, opened)).toBe(30);
    // A card 3 s late starts at 27.
    expect(secondsLeft(expiresAt, 0, opened + 3_000)).toBe(27);
    // The phone is five minutes behind: the offset corrects it.
    expect(secondsLeft(expiresAt, 5 * 60_000, opened - 5 * 60_000)).toBe(30);
    expect(secondsLeft(expiresAt, 0, opened + 45_000)).toBe(0);
    expect(secondsLeft(expiresAt, 0, opened + 400)).toBe(29);
  });

  it('draws the ring as the share left', () => {
    expect(ringOffset(30, 30)).toBe(0);
    expect(ringOffset(0, 30)).toBeCloseTo(RING_LENGTH);
    expect(ringOffset(15, 30)).toBeCloseTo(RING_LENGTH / 2);
    expect(ringOffset(90, 60)).toBe(0);
    expect(ringOffset(5, 0)).toBeCloseTo(RING_LENGTH);
  });
});

describe('endings', () => {
  it('says "missed" only for a timeout and nothing for a decline or going offline', () => {
    expect(endedNotice('expired')?.text).toBe('Offer missed. The time ran out.');
    expect(endedNotice('withdrawn-order')?.text).toBe(
      'This offer was withdrawn because the order changed.',
    );
    expect(endedNotice('withdrawn-staff')?.text).toBe('This offer was withdrawn.');
    expect(endedNotice('taken')?.text).toBe('Another partner took this order.');
    expect(endedNotice('declined')).toBeNull();
    expect(endedNotice('withdrawn-offline')).toBeNull();
  });

  it('maps refused answers to the same notices', () => {
    expect(goneNotice('expired').text).toBe('Offer missed. The time ran out.');
    expect(goneNotice('taken').text).toBe('Another partner took this order.');
    expect(goneNotice('order-changed').text).toContain('because the order changed');
    expect(goneNotice('withdrawn').text).toBe('This offer was withdrawn.');
  });

  it('words what happened to his order, never naming staff', () => {
    expect(releaseNotice('takenOff', '1042').text).toBe(
      "Foodz support took order 1042 off you. You don't need to pick it up.",
    );
    expect(releaseNotice('cancelled', '1042').text).toBe(
      "Order 1042 was cancelled. You don't need to pick it up.",
    );
    expect(releaseNotice('handedOver', '1042').text).toBe(
      "Order 1042 was handed over another way. You don't need to pick it up.",
    );
    expect(releaseNotice('movedBack', '1042')).toEqual({
      text: 'The kitchen needs a few more minutes for order 1042. Keep heading over.',
      tone: 'muted',
      icon: 'clock',
    });
  });

  it('warns at one miss before the limit only', () => {
    expect(missedNotice(1, 3)).toBeNull();
    expect(missedNotice(2, 3)?.text).toBe(
      "You've missed 2 offers in a row. If you miss the next one, we'll take you offline so other partners get orders.",
    );
    expect(missedNotice(3, 3)).toBeNull();
  });
});

describe('"How offers work"', () => {
  it('uses the server numbers', () => {
    const items = howOffersWorkItems({ reachesKm: [2, 4, 8], offerSeconds: 30, missLimit: 3 });
    expect(items.map((item) => item.text)).toEqual([
      'Offers go to partners near Foodz Kitchen first: within 2 km, then 4 km, then 8 km.',
      'Among partners that close, whoever has waited longest since their last order gets the next offer.',
      "You have 30 seconds to answer. Declining is fine and doesn't count against you.",
      'If you miss 3 offers in a row, we take you offline so other partners get orders.',
      'You get offers only while Foodz is open on your screen and sharing your location.',
    ]);
    expect(howOffersWorkItems({ reachesKm: [3], offerSeconds: 8, missLimit: 2 })[0]?.text).toBe(
      'Offers go to partners near Foodz Kitchen first: within 3 km.',
    );
  });
});

describe('the pick-up screen', () => {
  it('words pay, payment and the drop-off', () => {
    expect(earnWords('$7.64', 'includes $5.00 tip')).toBe('$7.64 · includes $5.00 tip');
    expect(earnWords('$2.64', null)).toBe('$2.64');
    expect(pickUpPaymentWords({ kind: 'cash', text: 'Cash order · collect $58.97' })).toBe(
      'Cash order · collect $58.97 at the door.',
    );
    expect(pickUpPaymentWords({ kind: 'card', text: 'Paid by card' })).toBe('Paid by card');
    expect(deliverPaymentWords({ kind: 'cash', text: 'Cash order · collect $1,058.97' })).toBe(
      'Collect $1,058.97 in cash.',
    );
    expect(deliverPaymentWords({ kind: 'card', text: 'Paid by card' })).toBe('Paid by card');
    expect(withoutThen('Then: Boston 02109 · 1.3 km from the kitchen')).toBe(
      'Boston 02109 · 1.3 km from the kitchen',
    );
  });

  it('names the kitchen and its street', () => {
    expect(kitchenLine('88 Harbor Street, Boston, MA 02210')).toBe(
      'Foodz Kitchen · 88 Harbor Street',
    );
    expect(kitchenLine('88 Harbor Street')).toBe('Foodz Kitchen · 88 Harbor Street');
  });

  it('shows and dials the kitchen phone', () => {
    expect(phoneDisplay('+16175550142')).toBe('(617) 555-0142');
    expect(phoneDisplay('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(telHref('+1 (617) 555-0142')).toBe('tel:+16175550142');
  });

  it('opens Apple Maps on iPhone and Google Maps elsewhere', () => {
    const kitchen = { lat: 42.3505, lng: -71.045 };
    expect(mapsHref(kitchen, { apple: true, bicycle: false })).toBe(
      'https://maps.apple.com/?daddr=42.3505,-71.045&dirflg=d',
    );
    expect(mapsHref(kitchen, { apple: false, bicycle: false })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=42.3505,-71.045&travelmode=driving',
    );
    expect(mapsHref(kitchen, { apple: false, bicycle: true })).toContain('travelmode=bicycling');
    expect(isApplePhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isApplePhone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isApplePhone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isApplePhone('Mozilla/5.0 (Linux; Android 15; Pixel 7)')).toBe(false);
  });

  it('asks before going offline or signing out with an order', () => {
    expect(leavingWords('1042', 'offline')).toMatchObject({
      title: 'You have order 1042',
      description:
        "You're picking up order 1042. Going offline gives it back so another partner can take it.",
      action: 'Give back and go offline',
    });
    expect(leavingWords('1042', 'signOut').action).toBe('Give back and sign out');
  });
});
