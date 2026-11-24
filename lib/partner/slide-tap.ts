/*
 * The slider's two-tap accept (F7 design 1.5, U13, P22.2), as one pure rule so every caller
 * (the button's click, Draggable's click on the handle) goes through the same path. The first
 * tap arms the control at once; a second tap within 3 seconds accepts; after that a tap arms it
 * again. One press can reach the control twice (the button and the handle, or a synthetic click
 * after a touch): a second report within 80 ms of the first is the same press.
 */

export const TAP_WINDOW_MS = 3_000;
export const SAME_PRESS_MS = 80;

export interface TapState {
  /** When the control was armed (performance.now()), or null. */
  armedAt: number | null;
  /** The last press taken, to fold a doubled report of one press into one. */
  lastPressAt: number | null;
}

export const NO_TAP: TapState = { armedAt: null, lastPressAt: null };

export type TapOutcome = 'arm' | 'accept' | 'ignore';

export function nextTap(state: TapState, now: number): { outcome: TapOutcome; state: TapState } {
  if (state.lastPressAt !== null && now - state.lastPressAt < SAME_PRESS_MS) {
    return { outcome: 'ignore', state };
  }
  if (state.armedAt !== null && now - state.armedAt < TAP_WINDOW_MS) {
    return { outcome: 'accept', state: { armedAt: null, lastPressAt: now } };
  }
  return { outcome: 'arm', state: { armedAt: now, lastPressAt: now } };
}

/** Whether "Tap again to accept" still applies at `now`. */
export const stillArmed = (state: TapState, now: number) =>
  state.armedAt !== null && now - state.armedAt < TAP_WINDOW_MS;
