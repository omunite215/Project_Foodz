import { describe, expect, it } from 'vitest';
import { midpoint, msUntil, undoDeadline } from './clock';

describe('the undo deadline (A4.7, A8.1)', () => {
  const move = { at: '2026-11-23T12:00:00.000Z', undoUntil: '2026-11-23T12:00:10.000Z' };
  const sentAt = Date.parse('2026-11-23T12:00:00.000Z');

  it('counts the server window from when the move was sent', () => {
    // A slow answer: the confirmation came 9 s later, so 1 s of the window is left.
    const deadline = undoDeadline(move, sentAt, 0);
    expect(msUntil(deadline, 0, sentAt + 9_000)).toBe(1_000);
  });

  it('never runs past the server deadline, even with a clock that lags behind', () => {
    // The board believes the server is 50 s behind the device (a stale snapshot).
    const deadline = undoDeadline(move, sentAt + 50_000, -50_000);
    expect(Date.parse(deadline)).toBeLessThanOrEqual(Date.parse(move.undoUntil));
    expect(msUntil(deadline, -50_000, sentAt + 50_000 + 10_000)).toBeLessThanOrEqual(0);
  });

  it('keeps the window when the clocks agree', () => {
    const offset = 3_000;
    const deadline = undoDeadline(
      { at: '2026-11-23T12:00:03.000Z', undoUntil: '2026-11-23T12:00:13.000Z' },
      sentAt,
      offset,
    );
    expect(msUntil(deadline, offset, sentAt)).toBe(10_000);
  });
});

describe('the snapshot time', () => {
  it('is halfway through the request', () => {
    expect(midpoint(1_000, 3_000)).toBe(2_000);
  });
});
