import { describe, expect, it } from 'vitest';
import type { DeliveryLine } from '@/server/modules/tracking/schema';
import {
  attentionListLine,
  attentionLook,
  deliveryLineSpoken,
  deliveryTone,
  demoRunningText,
  lateChip,
  readyFor,
  sortCouriers,
  sortDeliveries,
  stepsOf,
  stuckActionsFor,
} from './tracking-text';

const line = (patch: Partial<DeliveryLine>): DeliveryLine => ({
  state: 'onTheWay',
  words: 'Luis M. · 0.9 km to go · arriving 7:46 pm',
  tone: 'neutral',
  icon: 'truck',
  spoken: 'Luis M., 0.9 km to go, arriving 7:46 pm',
  ...patch,
});

describe('the Out-for-delivery line (A48)', () => {
  it('speaks with a prefix and keeps the name', () => {
    expect(deliveryLineSpoken(line({}))).toBe('Courier: Luis M., 0.9 km to go, arriving 7:46 pm');
  });

  it('takes the worst tone, and red when late against the promise', () => {
    expect(deliveryTone('ok', line({}))).toBe('ok');
    expect(deliveryTone('ok', line({ tone: 'amber' }))).toBe('soon');
    expect(deliveryTone('ok', line({ tone: 'red' }))).toBe('late');
    expect(deliveryTone('soon', line({ late: true }))).toBe('late');
    expect(deliveryTone('late', line({ tone: 'positive' }))).toBe('late');
    expect(deliveryTone('soon', null)).toBe('soon');
  });
});

const card = (delivery: DeliveryLine) => ({ status: 'PICKED_UP', delivery });

describe('stuck deliveries (A49, A50)', () => {
  it('offers the actions only when stuck, and never to the kitchen', () => {
    expect(stuckActionsFor(card(line({})), 'full')).toEqual([]);
    expect(stuckActionsFor(card(line({ state: 'noAnswer', tone: 'amber' })), 'full')).toEqual([]);
    expect(stuckActionsFor(card(line({ state: 'noAnswer', tone: 'red' })), 'full')).toEqual([
      'confirmHandover',
      'askToWait',
      'cancelUnreachable',
    ]);
    expect(stuckActionsFor(card(line({ state: 'locked', tone: 'red' })), 'full')).toEqual([
      'confirmHandover',
      'cancelUnreachable',
    ]);
    expect(stuckActionsFor(card(line({ state: 'problem' })), 'full')).toEqual([
      'cancelUnreachable',
    ]);
    expect(stuckActionsFor(card(line({ state: 'locked' })), 'kitchen')).toEqual([]);
  });

  it('turns a no-answer banner red from 5 minutes', () => {
    expect(attentionLook({ kind: 'no-answer', minutes: 2 })).toEqual({
      variant: 'warning',
      icon: 'door',
    });
    expect(attentionLook({ kind: 'no-answer', minutes: 5 }).variant).toBe('error');
    expect(attentionLook({ kind: 'locked', minutes: 0 }).variant).toBe('error');
    expect(
      attentionListLine({
        orderId: 'o',
        orderNumber: '1042',
        kind: 'no-answer',
        since: '',
        minutes: 6,
        words: '',
      }),
    ).toBe("Order 1042 · isn't answering · 6 min");
  });
});

describe('the live map (A46)', () => {
  it('sorts couriers by what needs staff first, then by name', () => {
    const couriers = [
      { state: 'free' as const, freshness: 'live' as const, fullName: 'Ana Ruiz' },
      { state: 'delivering' as const, freshness: 'live' as const, fullName: 'Luis Moreno' },
      { state: 'toKitchen' as const, freshness: 'stale' as const, fullName: 'Grace Oh' },
      { state: 'noAnswer' as const, freshness: 'live' as const, fullName: 'Diego Paz' },
    ];
    expect(sortCouriers(couriers).map((courier) => courier.fullName)).toEqual([
      'Diego Paz',
      'Grace Oh',
      'Luis Moreno',
      'Ana Ruiz',
    ]);
  });

  it('sorts deliveries by lateness, then estimate', () => {
    const rows = [
      { number: '1041', lateMinutes: 0, etaAt: '2026-11-21T00:50:00Z' },
      { number: '1042', lateMinutes: 8, etaAt: '2026-11-21T00:46:00Z' },
      { number: '1043', lateMinutes: 0, etaAt: '2026-11-21T00:45:00Z' },
    ];
    expect(sortDeliveries(rows).map((row) => row.number)).toEqual(['1042', '1043', '1041']);
    expect(lateChip(8)).toBe('8 min late');
    expect(lateChip(0)).toBe('On time');
  });

  it('words the ready time, the demo run and the steps', () => {
    const now = Date.parse('2026-11-21T00:46:00Z');
    expect(readyFor('2026-11-21T00:40:00Z', now)).toBe('Ready 6 min');
    expect(demoRunningText('D-1', '2026-11-21T00:49:30Z', now)).toBe(
      'Demo delivery running · order D-1 · 4 min left',
    );
    expect(
      stepsOf(
        {
          assignedAt: '2026-11-21T00:40:00Z',
          atKitchenAt: '2026-11-21T00:41:00Z',
          pickedUpAt: null,
          deliveredAt: null,
        },
        (iso) => iso.slice(11, 16),
      ),
    ).toEqual(['Accepted 00:40', 'At the kitchen 00:41']);
  });
});
