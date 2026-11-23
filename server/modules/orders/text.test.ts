import { describe, expect, it } from 'vitest';
import {
  cardLabel,
  cardPausedMessage,
  cardSpoken,
  cashLimitMessage,
  clockAt,
  declineMessage,
  expiryText,
  isCardExpired,
  kitchenStartedMessage,
  outsideAreaMessage,
  priceChangedMessage,
  soldOutMessage,
  storeClosedMessage,
  unpaidOrderMessage,
} from './text';

const NEW_YORK = 'America/New_York';

describe('cards as shown (S6.10 to S6.13)', () => {
  it('names the brand and the last 4, and reads them out in words', () => {
    expect(cardLabel('visa', '4242')).toBe('Visa •••• 4242');
    expect(cardLabel('amex', '0005')).toBe('American Express •••• 0005');
    expect(cardLabel('something_new', '1111')).toBe('Card •••• 1111');
    expect(cardSpoken('mastercard', '4444')).toBe('Mastercard ending in 4444');
    expect(expiryText(8, 2026)).toBe('08/26');
    expect(expiryText(12, 2034)).toBe('12/34');
  });

  it('calls a card expired once its month is over', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    expect(isCardExpired(10, 2026, now)).toBe(true);
    expect(isCardExpired(11, 2026, now)).toBe(false);
    expect(isCardExpired(12, 2034, now)).toBe(false);
  });
});

describe('declines in plain words (S6.8, design 2.18)', () => {
  it.each([
    [
      { code: 'card_declined', declineCode: 'generic_decline' },
      'Your card was declined. Try another card, or pay with cash.',
    ],
    [
      { code: 'card_declined', declineCode: 'fraudulent' },
      'Your card was declined. Try another card, or pay with cash.',
    ],
    [
      { code: 'card_declined', declineCode: 'insufficient_funds' },
      'Your card was declined for insufficient funds. Try another card, or pay with cash.',
    ],
    [
      { code: 'expired_card', declineCode: null },
      'This card has expired. Check the date, or use another card.',
    ],
    [
      { code: 'incorrect_cvc', declineCode: null },
      "The CVC doesn't match this card. Check the 3 digits on the back.",
    ],
    [
      { code: 'processing_error', declineCode: null },
      "We couldn't reach your bank. Try again in a moment.",
    ],
    [
      { code: 'payment_intent_authentication_failure', declineCode: null },
      "Your bank couldn't confirm it's you, so the payment didn't go through. Try again, or use another card.",
    ],
  ])('%j', (decline, text) => {
    expect(declineMessage(decline)).toBe(text);
    expect(text).not.toMatch(/error|invalid|fraud/i);
  });

  it('names a saved card that was declined', () => {
    expect(declineMessage({ code: 'card_declined', declineCode: null }, 'Visa •••• 4242')).toBe(
      'Your Visa •••• 4242 was declined. Use another card, or pay with cash.',
    );
  });
});

describe('refusals at the press', () => {
  it('says when the store closed and when it opens (S3.5)', () => {
    expect(
      storeClosedMessage(
        { at: '2026-11-20T03:00:00.000Z', weekday: 'thu', time: '22:00', day: 'today' },
        { at: '2026-11-20T16:00:00.000Z', weekday: 'fri', time: '11:00', day: 'tomorrow' },
      ),
    ).toBe(
      'We closed at 10 pm while you were checking out. You can order from 11 am tomorrow. Your cart is saved.',
    );
    expect(storeClosedMessage(null, null)).toBe("We're closed right now. Your cart is saved.");
  });

  it('gives the cash limit and the total (S5.2)', () => {
    expect(cashLimitMessage(27003, 10000)).toBe(
      'Cash is available for orders up to $100.00. This one is $270.03, so please pay by card.',
    );
  });

  it('words the unpaid order, the pause, the kitchen and sold-out dishes', () => {
    expect(unpaidOrderMessage('1042', 5397, '2026-11-20T00:52:00Z', NEW_YORK)).toBe(
      'Order 1042 is waiting for payment ($53.97). It expires at 7:52 pm.',
    );
    expect(cardPausedMessage('2026-11-21T01:40:00Z', NEW_YORK)).toBe(
      'Too many declined payments. You can try a card again at 8:40 pm, or pay with cash.',
    );
    expect(kitchenStartedMessage('1042', '(617) 555-0142')).toBe(
      "The kitchen has already started on order 1042, so it can't be cancelled here. Call us on (617) 555-0142.",
    );
    expect(soldOutMessage(['Naengmyeon'])).toBe(
      'Naengmyeon sold out while you were checking out. Remove it to continue, or go back to your cart.',
    );
    expect(outsideAreaMessage('Quincy Center', 11.5, 8)).toBe(
      "We don't deliver to Quincy Center yet. It's about 11.5 km away, and we deliver within 8 km.",
    );
  });

  it('gives clock times in the store’s zone, without ":00" on the hour', () => {
    expect(clockAt('2026-11-21T03:00:00Z', NEW_YORK)).toBe('10 pm');
    expect(clockAt('2026-11-20T16:05:00Z', NEW_YORK)).toBe('11:05 am');
  });
});

describe('a changed total (S8.2)', () => {
  it('says from, to, why, and what to press', () => {
    expect(priceChangedMessage(5397, 5611, 'Gimbap is now $13.99 (was $12.99)', 'card')).toBe(
      'Your total changed from $53.97 to $56.11 because Gimbap is now $13.99 (was $12.99). Check the summary, then press Pay $56.11 to continue.',
    );
    expect(priceChangedMessage(5397, 5297, null, 'cash')).toBe(
      'Your total changed from $53.97 to $52.97. Check the summary, then press Place order · $52.97 to continue.',
    );
  });
});
