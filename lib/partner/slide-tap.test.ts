import { describe, expect, it } from 'vitest';
import { NO_TAP, nextTap, stillArmed, TAP_WINDOW_MS, type TapState } from './slide-tap';

/* The slider's two-tap accept (design 1.5, review B1). */

function taps(times: number[]) {
  let state: TapState = NO_TAP;
  return times.map((now) => {
    const next = nextTap(state, now);
    state = next.state;
    return next.outcome;
  });
}

describe('two taps to accept', () => {
  it('arms on the first tap and accepts on a second within 3 s', () => {
    expect(taps([1_000, 2_000])).toEqual(['arm', 'accept']);
    expect(taps([1_000, 1_400])).toEqual(['arm', 'accept']);
  });

  it('arms again when the second tap comes after the window', () => {
    expect(taps([1_000, 1_000 + 3_500])).toEqual(['arm', 'arm']);
    expect(taps([1_000, 1_000 + 3_500, 1_000 + 4_500])).toEqual(['arm', 'arm', 'accept']);
  });

  it('takes one press reported twice as one tap', () => {
    // The button's click and the handle's click for the same press.
    expect(taps([1_000, 1_010, 2_000])).toEqual(['arm', 'ignore', 'accept']);
    expect(taps([1_000, 1_010, 1_015])).toEqual(['arm', 'ignore', 'ignore']);
  });

  it('says whether "Tap again to accept" still applies', () => {
    const armed = nextTap(NO_TAP, 1_000).state;
    expect(stillArmed(armed, 1_000 + TAP_WINDOW_MS - 1)).toBe(true);
    expect(stillArmed(armed, 1_000 + TAP_WINDOW_MS)).toBe(false);
    expect(stillArmed(NO_TAP, 5)).toBe(false);
  });
});
