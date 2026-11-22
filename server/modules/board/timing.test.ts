import { describe, expect, it } from 'vitest';
import { cardTiming, isLate, type TimedCard } from './timing';

// The story's fixtures at T = 7:30 pm Boston (23:30 UTC on 20 November 2026, EST).
const T = new Date('2026-11-20T23:30:00Z');
const at = (clock: string) => `2026-11-20T${clock}:00.000Z`;

const card = (overrides: Partial<TimedCard> & Pick<TimedCard, 'status'>): TimedCard => ({
  placedAt: at('23:29'),
  readyAt: null,
  pickedUpAt: null,
  readyBy: null,
  ...overrides,
});

describe('cardTiming with the board fixtures (A2.5)', () => {
  it('S1101: new a minute ago, fine', () => {
    expect(cardTiming(card({ status: 'PLACED' }), T)).toEqual({
      kind: 'waiting',
      minutes: 1,
      tone: 'ok',
    });
  });

  it('S1102: waiting 6 minutes is late', () => {
    const timing = cardTiming(card({ status: 'PLACED', placedAt: at('23:24') }), T);
    expect(timing).toEqual({ kind: 'waiting', minutes: 6, tone: 'late' });
    expect(isLate(timing)).toBe(true);
  });

  it('turns amber at 3 minutes in New', () => {
    expect(cardTiming(card({ status: 'PLACED', placedAt: at('23:27') }), T).tone).toBe('soon');
  });

  it('S1103: accepted, 16 minutes left', () => {
    expect(
      cardTiming(card({ status: 'ACCEPTED', placedAt: at('23:26'), readyBy: at('23:46') }), T),
    ).toEqual({
      kind: 'readyBy',
      readyBy: at('23:46'),
      minutesLeft: 16,
      lateMinutes: null,
      tone: 'ok',
    });
  });

  it('S1104: due in 3 minutes is amber', () => {
    expect(
      cardTiming(card({ status: 'PREPARING', placedAt: at('23:13'), readyBy: at('23:33') }), T),
    ).toMatchObject({ minutesLeft: 3, tone: 'soon' });
  });

  it('S1105: 10 minutes past ready-by is late', () => {
    expect(
      cardTiming(card({ status: 'PREPARING', placedAt: at('23:00'), readyBy: at('23:20') }), T),
    ).toMatchObject({ minutesLeft: null, lateMinutes: 10, tone: 'late' });
  });

  it('is due now at the ready-by itself, and late a moment after', () => {
    const due = card({ status: 'PREPARING', readyBy: T.toISOString() });
    expect(cardTiming(due, T)).toMatchObject({ minutesLeft: 0, tone: 'soon' });
    expect(cardTiming(due, new Date(T.getTime() + 1_000))).toMatchObject({
      lateMinutes: 0,
      tone: 'late',
    });
  });

  it('has no tone without a ready-by (an order from before F5)', () => {
    expect(cardTiming(card({ status: 'ACCEPTED' }), T)).toEqual({
      kind: 'readyBy',
      readyBy: null,
      minutesLeft: null,
      lateMinutes: null,
      tone: 'ok',
    });
  });

  it('S1106 and S1107: ready 4 minutes is fine, 16 minutes is late', () => {
    expect(cardTiming(card({ status: 'READY', readyAt: at('23:26') }), T)).toEqual({
      kind: 'ready',
      minutes: 4,
      tone: 'ok',
    });
    expect(cardTiming(card({ status: 'READY', readyAt: at('23:14') }), T)).toEqual({
      kind: 'ready',
      minutes: 16,
      tone: 'late',
    });
    expect(cardTiming(card({ status: 'READY', readyAt: at('23:19') }), T).tone).toBe('soon');
  });

  it('counts out for delivery without a tone', () => {
    expect(cardTiming(card({ status: 'PICKED_UP', pickedUpAt: at('23:18') }), T)).toEqual({
      kind: 'out',
      minutes: 12,
      tone: 'ok',
    });
  });

  it('rounds down and never counts below zero (a device clock a little ahead)', () => {
    expect(cardTiming(card({ status: 'PLACED' }), new Date('2026-11-20T23:31:59Z'))).toMatchObject({
      minutes: 2,
    });
    expect(cardTiming(card({ status: 'PLACED' }), new Date('2026-11-20T23:28:00Z'))).toMatchObject({
      minutes: 0,
    });
  });
});
