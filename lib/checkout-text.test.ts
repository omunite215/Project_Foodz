import { describe, expect, it } from 'vitest';
import {
  arrivalWords,
  attemptFingerprint,
  cardErrorAnnouncement,
  cardErrorText,
  cashBoxText,
  itemsText,
  newAttemptKey,
  noWayToPayText,
  orderLinesLabel,
  parseTipAmount,
  payButtonLabel,
  payPendingLabel,
  tipChoiceFor,
  tipTileName,
} from './checkout-text';

describe('parseTipAmount (design 2.11)', () => {
  it.each([
    ['5', 500],
    ['5.0', 500],
    ['5.00', 500],
    ['5.5', 550],
    ['$5', 500],
    [' 12.34 ', 1234],
    ['.5', 50],
    ['0', 0],
    ['100', 10_000],
    ['100.00', 10_000],
  ])('reads %j as %i cents', (raw, cents) => {
    expect(parseTipAmount(raw)).toEqual({ kind: 'ok', cents });
  });

  it('treats blank as empty', () => {
    expect(parseTipAmount('  ')).toEqual({ kind: 'empty' });
  });

  it.each(['5.555', '-5', 'five', '1,000', '5.5.5', '$'])('refuses %j in words', (raw) => {
    expect(parseTipAmount(raw)).toEqual({
      kind: 'error',
      message: 'Enter an amount in dollars and cents, like 5.50.',
    });
  });

  it('refuses more than $100.00', () => {
    expect(parseTipAmount('100.01')).toEqual({
      kind: 'error',
      message: 'Tips can be up to $100.00.',
    });
  });
});

describe('tipChoiceFor', () => {
  it('sends presets as percentages, never as amounts worked out here', () => {
    expect(tipChoiceFor({ kind: 'percent', percent: 15 }, { kind: 'empty' }, null)).toEqual({
      kind: 'percent',
      percent: 15,
    });
    expect(tipChoiceFor({ kind: 'none' }, { kind: 'ok', cents: 500 }, 500)).toEqual({
      kind: 'none',
    });
  });

  it('keeps the last valid amount while Other holds an error', () => {
    const error = { kind: 'error', message: 'x' } as const;
    expect(tipChoiceFor({ kind: 'other' }, error, 500)).toEqual({ kind: 'amount', cents: 500 });
    expect(tipChoiceFor({ kind: 'other' }, error, null)).toEqual({ kind: 'none' });
    expect(tipChoiceFor({ kind: 'other' }, { kind: 'ok', cents: 0 }, 500)).toEqual({
      kind: 'amount',
      cents: 0,
    });
  });
});

describe('tip tile names (S13.3)', () => {
  it('reads the label and the amount', () => {
    expect(tipTileName({ kind: 'none' }, null)).toBe('No tip');
    expect(tipTileName({ kind: 'percent', percent: 15 }, 720)).toBe('15 %, $7.20');
    expect(tipTileName({ kind: 'other' }, null)).toBe('Other');
    expect(tipTileName({ kind: 'other' }, 500)).toBe('Other, $5.00');
  });
});

describe('arrivalWords (design 2.10)', () => {
  it('gives the window and the clock time in the store time zone', () => {
    const words = arrivalWords(
      { status: 'ok', fromMinutes: 35, toMinutes: 45, by: '2026-11-20T00:45:00.000Z' },
      'America/New_York',
      null,
    );
    expect(words.line1).toBe('Arrives in about 35–45 min');
    expect(words.line2).toBe('by 7:45 pm');
    expect(words.spoken).toBe('Arrives in about 35 to 45 minutes, by 7:45 pm');
  });

  it('asks for an address, or says when ordering opens', () => {
    expect(arrivalWords({ status: 'noAddress' }, 'UTC', null).line1).toBe(
      'Choose an address to see when it arrives.',
    );
    const closed = arrivalWords({ status: 'closed' }, 'UTC', 'Ordering opens at 11 am');
    expect(closed.line1).toBe('Ordering opens at 11 am');
    expect(closed.line2).toBe("We'll show the arrival time when we open.");
  });
});

describe('the pay button (design 2.16)', () => {
  it('carries the amount once the total is final', () => {
    expect(payButtonLabel('card', 5397)).toBe('Pay $53.97');
    expect(payButtonLabel('cash', 5397)).toBe('Place order · $53.97');
    expect(payButtonLabel('card', null)).toBe('Pay');
    expect(payButtonLabel('cash', null)).toBe('Place order');
    expect(payPendingLabel('card')).toBe('Paying…');
    expect(payPendingLabel('cash')).toBe('Placing your order…');
  });

  it('explains when there is no way to pay', () => {
    expect(noWayToPayText(null)).toBe(
      "This order is over the $100.00 cash limit, and card payments aren't set up on this computer.",
    );
    expect(noWayToPayText('8:40 pm')).toBe(
      'This order is over the $100.00 cash limit, and card payments are paused until 8:40 pm.',
    );
  });
});

describe('cashBoxText (S4.6, D27)', () => {
  it('says the tip is included only when there is one', () => {
    expect(cashBoxText(5397, 0)).toBe(
      'Pay $53.97 in cash when your order arrives. Please have the exact amount ready if you can.',
    );
    expect(cashBoxText(6117, 720)).toBe(
      'Pay $61.17 in cash when your order arrives, tip included. Please have the exact amount ready if you can.',
    );
  });
});

describe('cardErrorText (design 2.15)', () => {
  it.each([
    ['cardNumber', 'empty', 'Enter the card number.'],
    ['cardNumber', 'incomplete_number', 'Enter the full card number.'],
    [
      'cardNumber',
      'invalid_number',
      "That card number doesn't look right. Check it and try again.",
    ],
    ['cardExpiry', 'empty', 'Enter the expiration date.'],
    ['cardExpiry', 'incomplete_expiry', 'Enter the full expiration date, like 08/29.'],
    ['cardExpiry', 'invalid_expiry_year_past', 'That date is in the past.'],
    ['cardExpiry', 'invalid_expiry_month', "That date doesn't look right. Use MM/YY, like 08/29."],
    ['cardCvc', 'incomplete_cvc', 'Enter the 3-digit CVC from the back of your card.'],
    ['cardCvc', 'something_new', 'Check this field and try again.'],
  ] as const)('%s %s', (field, code, text) => {
    expect(cardErrorText(field, code)).toBe(text);
  });

  it('asks for 4 digits on the front of an American Express card', () => {
    expect(cardErrorText('cardCvc', 'empty', 'amex')).toBe(
      'Enter the 4-digit CVC from the front of your card.',
    );
  });

  it('never says "invalid"', () => {
    for (const field of ['cardNumber', 'cardExpiry', 'cardCvc'] as const) {
      for (const code of ['invalid_number', 'invalid_expiry_month', 'invalid_cvc', 'x']) {
        expect(cardErrorText(field, code).toLowerCase()).not.toContain('invalid');
      }
    }
  });

  it('announces with the field name first', () => {
    expect(cardErrorAnnouncement('cardNumber', 'Enter the card number.')).toBe(
      'Card number: Enter the card number.',
    );
  });
});

describe('the summary', () => {
  it('counts items and dishes', () => {
    expect(itemsText(1)).toBe('1 item');
    expect(itemsText(3)).toBe('3 items');
    expect(orderLinesLabel(3)).toBe('3 dishes in your order');
    expect(orderLinesLabel(1)).toBe('1 dish in your order');
  });
});

describe('the attempt key (B2)', () => {
  it('fits the server pattern and differs every time', () => {
    const key = newAttemptKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
    expect(newAttemptKey()).not.toBe(key);
  });

  it('fingerprints the same choices the same way, whatever their order', () => {
    const a = attemptFingerprint({ tip: { kind: 'percent', percent: 15 }, method: 'cash' });
    const b = attemptFingerprint({ method: 'cash', tip: { kind: 'percent', percent: 15 } });
    expect(a).toBe(b);
    expect(attemptFingerprint({ method: 'card', tip: { kind: 'percent', percent: 15 } })).not.toBe(
      a,
    );
    expect(attemptFingerprint({ tip: { kind: 'percent', percent: 20 }, method: 'cash' })).not.toBe(
      a,
    );
  });
});
