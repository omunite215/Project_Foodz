import { describe, expect, it } from 'vitest';
import { PROMO_UNAVAILABLE, promoMessage } from './promo-text';

const BOSTON = { timeZone: 'America/New_York' };

describe('refusal sentences (S4 table)', () => {
  it('words R1 to R9 as the story does, never saying "invalid"', () => {
    const cases: [string, Parameters<typeof promoMessage>[1], string][] = [
      [
        'NOPE',
        { code: 'notFound', rule: 'R1' },
        "We couldn't find the code NOPE. Check the spelling, or try another code.",
      ],
      [
        'NEXTWEEK',
        // Seeded on Friday 20 November 2026, starting 7 days later (evening in Boston).
        { code: 'notStarted', rule: 'R2', startsAt: '2026-11-27T23:00:00.000Z' },
        'NEXTWEEK starts on Friday, November 27. You can use it from then.',
      ],
      [
        'SUMMER25',
        { code: 'ended', rule: 'R3', endedAt: '2026-10-21T23:00:00.000Z' },
        "SUMMER25 ended on October 21, so it can't be used any more.",
      ],
      ['FIRST100', { code: 'usedUp', rule: 'R4' }, 'Sorry, FIRST100 has run out.'],
      [
        'WELCOME10',
        { code: 'signInRequired', rule: 'R5', perCustomer: 1 },
        "Sign in to use WELCOME10. It's one per customer, so we need to know it's you.",
      ],
      [
        'WELCOME10',
        { code: 'alreadyUsed', rule: 'R6', perCustomer: 1 },
        "You've already used WELCOME10. It's one per customer.",
      ],
      [
        'WELCOME10',
        { code: 'onHold', rule: 'R7', orderNumber: '1042' },
        "WELCOME10 is on hold for your unpaid order 1042. It frees up if you cancel that order, or if it isn't paid within 15 minutes.",
      ],
      [
        'KBBQ5',
        { code: 'notForTheseDishes', rule: 'R8', cuisines: ['KOREAN'] },
        'KBBQ5 is for Korean dishes. Add a Korean dish to use it.',
      ],
      [
        'WELCOME10',
        {
          code: 'minimumNotReached',
          rule: 'R9',
          minSubtotalCents: 1500,
          eligibleCents: 699,
          shortfallCents: 801,
          cuisines: [],
        },
        'WELCOME10 needs a subtotal of $15.00. Add $8.01 more to use it.',
      ],
      [
        'KBBQ5',
        {
          code: 'minimumNotReached',
          rule: 'R9',
          minSubtotalCents: 2500,
          eligibleCents: 699,
          shortfallCents: 1801,
          cuisines: ['KOREAN'],
        },
        'KBBQ5 needs $25.00 of Korean dishes. You have $6.99, so add $18.01 more.',
      ],
    ];
    for (const [code, reason, sentence] of cases) {
      const text = promoMessage(code, reason, BOSTON);
      expect(text).toBe(sentence);
      expect(text.toLowerCase()).not.toContain('invalid');
    }
  });

  it('names several cuisines in plain words', () => {
    expect(
      promoMessage(
        'ASIA5',
        { code: 'notForTheseDishes', rule: 'R8', cuisines: ['THAI', 'VIETNAMESE'] },
        BOSTON,
      ),
    ).toBe('ASIA5 is for Thai and Vietnamese dishes. Add a Thai or Vietnamese dish to use it.');
    expect(promoMessage('TWICE', { code: 'alreadyUsed', rule: 'R6', perCustomer: 2 }, BOSTON)).toBe(
      "You've already used TWICE 2 times. It's 2 per customer.",
    );
  });

  it('passes the limiter’s own wait through, and says when the checker is down', () => {
    expect(
      promoMessage(
        'KBBQ5',
        { code: 'rateLimited', rule: null },
        {
          ...BOSTON,
          rateLimitMessage: 'Too many codes tried. You can try again in 10 minutes.',
        },
      ),
    ).toBe('Too many codes tried. You can try again in 10 minutes.');
    expect(promoMessage('KBBQ5', { code: 'unavailable', rule: null }, BOSTON)).toBe(
      PROMO_UNAVAILABLE,
    );
  });
});
