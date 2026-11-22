import { describe, expect, it } from 'vitest';
import type { BoardAbilities } from './schema';
import {
  cancelReasonFor,
  cardActions,
  stepUpNeeded,
  staffTransitionAllowed,
  undoUntil,
  undoVerdict,
  versionStillCurrent,
} from './state';

const NONE: BoardAbilities = {
  move: false,
  undo: false,
  moveBack: false,
  refuse: false,
  cancel: false,
  handOver: false,
  setAvailability: false,
  readOnly: false,
};
const KITCHEN: BoardAbilities = {
  ...NONE,
  move: true,
  undo: true,
  refuse: true,
  setAvailability: true,
};
const SUPPORT: BoardAbilities = { ...NONE, cancel: true };
const ADMIN: BoardAbilities = {
  ...NONE,
  move: true,
  undo: true,
  moveBack: true,
  cancel: true,
  handOver: true,
  setAvailability: true,
};
const DEMO: BoardAbilities = { ...ADMIN, readOnly: true };

describe('versionStillCurrent (A5.2, A5.3)', () => {
  it('goes ahead on the version the person saw', () => {
    expect(versionStillCurrent({ version: 3, statusChangedVersion: 3 }, 3)).toBe(true);
  });

  it('goes ahead when only money changed since (a Stripe refund, a dispute)', () => {
    expect(versionStillCurrent({ version: 5, statusChangedVersion: 3 }, 3)).toBe(true);
  });

  it('refuses when the status changed since, even back to the same status', () => {
    expect(versionStillCurrent({ version: 4, statusChangedVersion: 4 }, 3)).toBe(false);
    // Moved forward and back again: the status reads the same, but it changed twice.
    expect(versionStillCurrent({ version: 5, statusChangedVersion: 5 }, 3)).toBe(false);
  });

  it('refuses a version from the future', () => {
    expect(versionStillCurrent({ version: 3, statusChangedVersion: 3 }, 9)).toBe(false);
  });
});

describe('staffTransitionAllowed (the orders guard, B1)', () => {
  it('lets the kitchen go one step at a time, back one step (undo) and refuse a New order', () => {
    expect(staffTransitionAllowed('kitchen', 'PLACED', 'ACCEPTED')).toBe(true);
    expect(staffTransitionAllowed('kitchen', 'PREPARING', 'READY')).toBe(true);
    expect(staffTransitionAllowed('kitchen', 'READY', 'PREPARING')).toBe(true);
    expect(staffTransitionAllowed('kitchen', 'PLACED', 'CANCELLED')).toBe(true);

    expect(staffTransitionAllowed('kitchen', 'PLACED', 'PREPARING')).toBe(false);
    expect(staffTransitionAllowed('kitchen', 'ACCEPTED', 'CANCELLED')).toBe(false);
    expect(staffTransitionAllowed('kitchen', 'READY', 'PICKED_UP')).toBe(false);
    expect(staffTransitionAllowed('kitchen', 'PICKED_UP', 'DELIVERED')).toBe(false);
  });

  it('lets support only cancel, from New to Ready', () => {
    for (const from of ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'] as const) {
      expect(staffTransitionAllowed('support', from, 'CANCELLED')).toBe(true);
    }
    expect(staffTransitionAllowed('support', 'PICKED_UP', 'CANCELLED')).toBe(false);
    expect(staffTransitionAllowed('support', 'PLACED', 'ACCEPTED')).toBe(false);
  });

  it('lets admin hand over by hand and move back from Out for delivery', () => {
    expect(staffTransitionAllowed('admin', 'READY', 'PICKED_UP')).toBe(true);
    expect(staffTransitionAllowed('admin', 'PICKED_UP', 'DELIVERED')).toBe(true);
    expect(staffTransitionAllowed('admin', 'PICKED_UP', 'READY')).toBe(true);
    expect(staffTransitionAllowed('admin', 'PICKED_UP', 'CANCELLED')).toBe(false);
    expect(staffTransitionAllowed('admin', 'DELIVERED', 'PICKED_UP')).toBe(false);
    expect(staffTransitionAllowed('admin', 'CANCELLED', 'PLACED')).toBe(false);
  });

  it('never lets staff touch an order waiting for payment', () => {
    for (const role of ['kitchen', 'support', 'admin'] as const) {
      expect(staffTransitionAllowed(role, 'PENDING_PAYMENT', 'PLACED')).toBe(false);
      expect(staffTransitionAllowed(role, 'PENDING_PAYMENT', 'CANCELLED')).toBe(false);
    }
  });

  it('records the kitchen refusing and everyone else cancelling', () => {
    expect(cancelReasonFor('kitchen')).toBe('kitchen-refused');
    expect(cancelReasonFor('support')).toBe('staff');
    expect(cancelReasonFor('admin')).toBe('staff');
  });
});

describe('cardActions (design 2.7)', () => {
  it('gives the kitchen one button per step and "Can\'t make it" on New cards only', () => {
    expect(cardActions(KITCHEN, 'PLACED')).toEqual({
      primary: 'ACCEPTED',
      menu: ['details', 'refuse'],
      disabled: false,
    });
    expect(cardActions(KITCHEN, 'PREPARING')).toEqual({
      primary: 'READY',
      menu: ['details'],
      disabled: false,
    });
    expect(cardActions(KITCHEN, 'READY').primary).toBeNull();
  });

  it('gives support no button, and cancel from New to Ready', () => {
    expect(cardActions(SUPPORT, 'PLACED')).toEqual({
      primary: null,
      menu: ['details', 'cancel'],
      disabled: false,
    });
    expect(cardActions(SUPPORT, 'PICKED_UP').menu).toEqual(['details']);
  });

  it('gives admin hand-overs and move back', () => {
    expect(cardActions(ADMIN, 'READY')).toEqual({
      primary: 'pickUp',
      menu: ['details', 'moveBack', 'pickUp', 'cancel'],
      disabled: false,
    });
    expect(cardActions(ADMIN, 'PICKED_UP')).toEqual({
      primary: 'deliver',
      menu: ['details', 'moveBack', 'deliver'],
      disabled: false,
    });
    expect(cardActions(ADMIN, 'PLACED').menu).toEqual(['details', 'cancel']);
  });

  it('shows the demo admin everything disabled', () => {
    expect(cardActions(DEMO, 'ACCEPTED')).toEqual({
      primary: 'PREPARING',
      menu: ['details', 'moveBack', 'cancel'],
      disabled: true,
    });
  });
});

describe('stepUpNeeded (A7.10, U4)', () => {
  const now = new Date('2026-11-20T19:30:00Z');
  const paidCard = {
    status: 'PREPARING' as const,
    paymentMethod: 'card' as const,
    paymentStatus: 'PAID' as const,
    hasPaymentIntent: true,
    refundableCents: 5903,
  };

  it('asks for a code to refund a card after Accept once the last check is stale', () => {
    expect(stepUpNeeded(paidCard, null, now)).toBe(true);
    expect(stepUpNeeded(paidCard, new Date('2026-11-20T19:29:59Z'), now)).toBe(true);
    expect(stepUpNeeded(paidCard, new Date('2026-11-20T19:35:00Z'), now)).toBe(false);
    expect(stepUpNeeded({ ...paidCard, paymentStatus: 'PARTIALLY_REFUNDED' }, null, now)).toBe(
      true,
    );
  });

  it('never asks for New orders, cash, unpaid, sample or fully refunded ones', () => {
    expect(stepUpNeeded({ ...paidCard, status: 'PLACED' }, null, now)).toBe(false);
    expect(stepUpNeeded({ ...paidCard, paymentMethod: 'cash' }, null, now)).toBe(false);
    expect(stepUpNeeded({ ...paidCard, paymentStatus: 'UNPAID' }, null, now)).toBe(false);
    expect(stepUpNeeded({ ...paidCard, hasPaymentIntent: false }, null, now)).toBe(false);
    expect(stepUpNeeded({ ...paidCard, refundableCents: 0 }, null, now)).toBe(false);
  });
});

describe('undoVerdict (A8.1, A8.2)', () => {
  const at = new Date('2026-11-20T19:30:00Z');
  const move = { actorId: 'alex', at, versionAfter: 4 };
  const later = (ms: number) => new Date(at.getTime() + ms);

  it('allows your own move within the window and its grace', () => {
    expect(undoVerdict(move, { statusChangedVersion: 4 }, 'alex', later(9_000))).toBe('ok');
    expect(undoVerdict(move, { statusChangedVersion: 4 }, 'alex', later(12_000))).toBe('ok');
  });

  it('refuses late, someone else, or after another status change', () => {
    expect(undoVerdict(move, { statusChangedVersion: 4 }, 'alex', later(12_001))).toBe('expired');
    expect(undoVerdict(move, { statusChangedVersion: 4 }, 'daniel', later(1_000))).toBe('notYours');
    expect(undoVerdict(move, { statusChangedVersion: 5 }, 'alex', later(1_000))).toBe('changed');
  });

  it('shows Undo for exactly the window', () => {
    expect(undoUntil(at).toISOString()).toBe('2026-11-20T19:30:10.000Z');
  });
});
