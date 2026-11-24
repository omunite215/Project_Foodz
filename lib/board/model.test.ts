import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@/server/db/enums';
import { LATENESS } from '@/server/modules/board/schema';
import type { OrderChangedEvent } from '@/lib/realtime/events';
import {
  at,
  fullCard,
  fullCards,
  kitchenCard,
  kitchenCards,
  NOW,
  ORDER_ID,
  seed,
} from '@/components/board/board.fixtures';
import { COLUMN_HASHES } from './text';
import {
  applyEvent,
  columnFromHash,
  diffCards,
  diffCount,
  eventVerdict,
  filtersQuery,
  groupByColumn,
  lateNow,
  matchesFilters,
  mergeCards,
  neighbourAfterLeaving,
  parseFilters,
  waitingOver,
} from './model';

const now = new Date(NOW);
const event = (status: OrderStatus, version: number, orderId = ORDER_ID(3)): OrderChangedEvent => ({
  orderId,
  status,
  version,
  at: at('19:31'),
});

describe('columns (A2.1, A2.2)', () => {
  it('fills the kitchen board oldest first, with no Out for delivery', () => {
    const grouped = groupByColumn(kitchenCards(), ['new', 'accepted', 'preparing', 'ready']);
    expect(grouped.new.map((card) => card.number)).toEqual(['S1102', 'S1101']);
    expect(grouped.accepted.map((card) => card.number)).toEqual(['S1103']);
    expect(grouped.preparing.map((card) => card.number)).toEqual(['S1105', 'S1104']);
    // Ready by the time it became ready.
    expect(grouped.ready.map((card) => card.number)).toEqual(['S1107', 'S1106']);
    expect(grouped.outForDelivery).toEqual([]);
  });

  it('keeps cards out of columns this board does not show', () => {
    const out = fullCard(seed('S1106'), { status: 'PICKED_UP', pickedUpAt: at('19:20') });
    expect(groupByColumn([out], ['new', 'accepted', 'preparing', 'ready']).outForDelivery).toEqual(
      [],
    );
  });
});

describe('filters (A11.2)', () => {
  it('reads and writes the address', () => {
    expect(parseFilters(new URLSearchParams('late=1&pay=cash'))).toEqual({
      late: true,
      pay: 'cash',
    });
    expect(parseFilters(new URLSearchParams('pay=bitcoin'))).toEqual({ late: false, pay: null });
    expect(filtersQuery({ late: true, pay: 'card' })).toBe('late=1&pay=card');
    expect(filtersQuery({ late: false, pay: null })).toBe('');
  });

  it('combines late and payment', () => {
    const cards = fullCards();
    const shown = cards.filter((card) =>
      matchesFilters(card, { late: true, pay: 'cash' }, lateNow(card, now, LATENESS)),
    );
    expect(shown.map((card) => card.number)).toEqual(['S1102']);
  });
});

describe('realtime events (A12.5)', () => {
  const card = kitchenCard(seed('S1103'));

  it('ignores old events and repeats', () => {
    expect(eventVerdict(card, event('PREPARING', 3), 'kitchen')).toBe('ignore');
    expect(eventVerdict(card, event('ACCEPTED', 4), 'kitchen')).toBe('ignore');
  });

  it('applies a new status on the board from the event itself', () => {
    expect(eventVerdict(card, event('PREPARING', 5), 'kitchen')).toBe('apply');
    const moved = applyEvent(card, event('PREPARING', 5));
    expect(moved).toMatchObject({ status: 'PREPARING', version: 5, preparingAt: at('19:31') });
  });

  it('fetches new orders, orders that left, and money changes for views with money', () => {
    expect(eventVerdict(undefined, event('PLACED', 1, ORDER_ID(42)), 'kitchen')).toBe('fetch');
    expect(eventVerdict(card, event('CANCELLED', 5), 'kitchen')).toBe('fetch');
    expect(eventVerdict(card, event('PICKED_UP', 5), 'kitchen')).toBe('fetch');
    expect(eventVerdict(fullCard(seed('S1103')), event('ACCEPTED', 5), 'full')).toBe('fetch');
    expect(eventVerdict(card, event('ACCEPTED', 5), 'kitchen')).toBe('apply');
  });

  it('ignores events for orders this board never shows', () => {
    expect(eventVerdict(undefined, event('DELIVERED', 9, ORDER_ID(42)), 'full')).toBe('ignore');
    expect(eventVerdict(undefined, event('PICKED_UP', 9, ORDER_ID(42)), 'kitchen')).toBe('ignore');
  });

  it('clears the later step times when a step is taken back, and ends the Undo', () => {
    const ready = kitchenCard(seed('S1106'), {
      undo: { eventId: ORDER_ID(77), type: 'READY', until: NOW },
    });
    expect(applyEvent(ready, event('PREPARING', 7, ready.id))).toMatchObject({
      status: 'PREPARING',
      readyAt: null,
      preparingAt: ready.preparingAt,
      undo: null,
    });
  });
});

describe('fresh copies (A12.3, A12.4)', () => {
  it('keeps a card the screen holds at a newer version', () => {
    const held = kitchenCard(seed('S1103'), { status: 'PREPARING', version: 6 });
    const incoming = kitchenCard(seed('S1103'));
    expect(mergeCards([held], [incoming])).toEqual([held]);
  });

  it('counts what changed while away', () => {
    const before = kitchenCards();
    const after = [
      ...before.filter((card) => card.number !== 'S1102' && card.number !== 'S1103'),
      kitchenCard(seed('S1103'), { status: 'PREPARING', version: 5 }),
      kitchenCard(seed('S1101'), { id: ORDER_ID(43), number: '1043' }),
    ];
    const diff = diffCards(before, after);
    expect(diff).toEqual({ added: [ORDER_ID(43)], changed: [ORDER_ID(3)], removed: [ORDER_ID(2)] });
    expect(diffCount(diff)).toBe(3);
  });
});

describe('waiting and focus', () => {
  it('lists New orders over five minutes, oldest first (A3.6)', () => {
    expect(waitingOver(kitchenCards(), now, 5).map((card) => card.number)).toEqual(['S1102']);
    expect(waitingOver(kitchenCards(), now, 1).map((card) => card.number)).toEqual([
      'S1102',
      'S1101',
    ]);
  });

  it('moves focus to the next card, the one before, or the heading (A16.4)', () => {
    expect(neighbourAfterLeaving(['a', 'b', 'c'], 'a')).toBe('b');
    expect(neighbourAfterLeaving(['a', 'b', 'c'], 'c')).toBe('b');
    expect(neighbourAfterLeaving(['a'], 'a')).toBeNull();
  });

  it('opens the phone tab named in the address', () => {
    expect(columnFromHash('#ready', ['new', 'ready'], COLUMN_HASHES)).toBe('ready');
    expect(columnFromHash('#out', ['new', 'ready'], COLUMN_HASHES)).toBeNull();
  });
});
