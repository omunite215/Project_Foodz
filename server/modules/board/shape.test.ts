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
