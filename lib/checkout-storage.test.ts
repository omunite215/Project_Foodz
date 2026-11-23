// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetCheckout,
  isConfirming,
  markArrival,
  markClearCart,
  markConfirming,
  NO_CHOICES,
  readAttempt,
  readChoices,
  readPlacedHere,
  takeArrival,
  takeClearCart,
  writeAttempt,
  writeChoices,
  writePlacedHere,
} from './checkout-storage';

const ORDER = '01a201a9-7986-74dd-9f5a-15ae7a8fe737';

describe('checkout tab storage (security S12)', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('forgets the note, the tip, the attempt key and the order just placed when the session ends', () => {
    writeChoices({
      tip: { kind: 'other' },
      otherText: '5.50',
      note: 'Peanut allergy, buzzer 4B',
      summaryOpen: true,
    });
    writeAttempt({ key: 'a'.repeat(24), fingerprint: '[]', pressed: true });
    writePlacedHere({ orderId: ORDER, number: '1042', confirming: true });
    markArrival(ORDER);
    markConfirming(ORDER);
    markClearCart(ORDER);
    expect(readChoices().note).toBe('Peanut allergy, buzzer 4B');

    forgetCheckout();

    expect(readChoices()).toEqual(NO_CHOICES);
    expect(readAttempt()).toBeNull();
    expect(readPlacedHere()).toBeNull();
    expect(takeArrival(ORDER)).toBe(false);
    expect(isConfirming(ORDER)).toBe(false);
    expect(takeClearCart(ORDER)).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('leaves what other parts of the site keep in the tab', () => {
    window.sessionStorage.setItem('foodz.cart.point', '{"line1":"1 Faneuil Hall Square"}');
    writeChoices({ ...NO_CHOICES, note: 'Ring twice' });
    forgetCheckout();
    expect(window.sessionStorage.getItem('foodz.cart.point')).not.toBeNull();
  });
});
