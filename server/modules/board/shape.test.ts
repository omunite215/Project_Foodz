import { describe, expect, it } from 'vitest';
import { type EventFacts, type OrderFacts, timelineOf, type Viewer } from './shape';

/*
 * The staff timeline's role shaping (F5 A10.3, F8 A47 and A53.2): what the kitchen sees of a
 * delivery's end.
 */

const AT = new Date('2026-11-21T00:46:00.000Z');

const order: OrderFacts = {
  id: '0193a000-0000-7000-8000-000000000101',
  number: '1042',
  status: 'DELIVERED',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  contactName: 'Priya Shah',
  contactPhone: '+16175550123',
  addressLabel: null,
  addressLine1: '1 Faneuil Hall Square',
  addressLine2: null,
  addressCity: 'Boston, MA 02109',
  addressText: '1 Faneuil Hall Square, Boston, MA 02109',
  courierInstructions: null,
  note: null,
  distanceKm: 1.3,
  subtotalCents: 4800,
  discountCents: 0,
  deliveryFeeCents: 399,
  deliveryDiscountCents: 0,
  taxCents: 300,
  taxRateBps: 625,
  tipCents: 500,
  totalCents: 5897,
  refundedCents: 0,
  promoCode: null,
  cardBrand: null,
  cardLast4: null,
  disputeStatus: 'NONE',
  disputeOpenedAt: null,
  disputeClosedAt: null,
  arrivalFromMinutes: 35,
  arrivalToMinutes: 45,
  autoRefundReason: null,
  hasPaymentIntent: false,
  placedAt: AT,
  acceptedAt: AT,
  preparingAt: AT,
  readyAt: AT,
  pickedUpAt: AT,
  deliveredAt: AT,
  cancelledAt: null,
  cancelReason: null,
  cancelCode: null,
  cancelLineIds: [],
  prepMinutes: 15,
  version: 9,
  statusChangedVersion: 9,
  createdAt: AT,
  updatedAt: AT,
  masked: false,
};

/** A50: support confirmed the hand-over with a note about the door. */
const staffDelivered: EventFacts = {
  id: '0193a000-0000-7000-8000-000000000201',
  type: 'delivered',
  fromStatus: 'PICKED_UP',
  toStatus: 'DELIVERED',
  actorId: null,
  data: {
    actor: 'staff',
    reason: 'customer-confirmed',
    note: 'Left with the concierge at the front desk',
    cashCollectedCents: 5897,
    by: { name: 'Morgan Diaz', role: 'support' },
  },
  createdAt: AT,
};

const viewer = (role: Viewer['role']): Viewer => ({ userId: 'u1', role, isDemo: false });
const deliveredRow = (role: Viewer['role']) =>
  timelineOf(viewer(role), order, [], [staffDelivered]).find((row) => row.type === 'delivered');

const rowOf = (role: Viewer['role'], event: EventFacts) =>
  timelineOf(viewer(role), order, [], [event]).find((row) => row.type === event.type);

describe('a staff hand-over on the timeline (gate S12)', () => {
  it("never shows the kitchen the staff member's note about the door", () => {
    const row = deliveredRow('kitchen');
    expect(row).toMatchObject({ type: 'delivered', note: null, cashCollectedCents: null });
  });

  it('keeps the note and the cash for support and admin', () => {
    expect(deliveredRow('support')).toMatchObject({
      note: 'Left with the concierge at the front desk',
      cashCollectedCents: 5897,
    });
    expect(deliveredRow('admin')).toMatchObject({
      note: 'Left with the concierge at the front desk',
    });
  });
});

describe('the other door notes on the timeline (gate S13)', () => {
  /** A50 "Cancel and bring it back": staff couldn't reach the customer at the door. */
  const unreachable: EventFacts = {
    ...staffDelivered,
    id: '0193a000-0000-7000-8000-000000000202',
    type: 'cancelled',
    toStatus: 'CANCELLED',
    data: {
      actor: 'staff',
      reason: 'customer-unreachable',
      note: 'Buzzer at 4B broken, no answer on the phone',
      by: { name: 'Morgan Diaz', role: 'support' },
    },
  };
  /** ADMIN's Mark delivered while a courier holds the order: F5's handOver writes no actor. */
  const adminHandOver: EventFacts = {
    ...staffDelivered,
    id: '0193a000-0000-7000-8000-000000000203',
    data: {
      reason: 'courier-app-down',
      note: 'Courier says he left it at the side door',
      by: { name: 'Avery Lee', role: 'admin' },
    },
  };

  it('never shows the kitchen the note on a "Cancel and bring it back"', () => {
    expect(rowOf('kitchen', unreachable)).toMatchObject({ type: 'cancelled', note: null });
    expect(rowOf('support', unreachable)).toMatchObject({
      note: 'Buzzer at 4B broken, no answer on the phone',
    });
  });

  it("never shows the kitchen the note on ADMIN's hand-over for a courier", () => {
    expect(rowOf('kitchen', adminHandOver)).toMatchObject({ type: 'delivered', note: null });
    expect(rowOf('admin', adminHandOver)).toMatchObject({
      note: 'Courier says he left it at the side door',
    });
  });
});
