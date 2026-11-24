import { describe, expect, it } from 'vitest';
import type { CustomerDispatchView } from '@/server/modules/delivery/schema';
import { orderViewFixture } from '@/components/orders/orders.fixtures';
import {
  courierChangedText,
  courierShown,
  courierTimelineText,
  deliveredByLine,
  ratingWords,
  statusAnnouncement,
  stepLine,
  vehicleSpokenWords,
} from './order-progress';

/* F7 design 3: the customer's line under the h1, the courier block and its words. */

const LUIS: NonNullable<CustomerDispatchView['courier']> = {
  firstName: 'Luis',
  photoUrl: null,
  photoExpiresAt: null,
  vehicle: 'SCOOTER',
  vehicleWords: 'Scooter · 7KT 342',
  plate: '7KT 342',
  rating: null,
};

const order = (
  status: 'READY' | 'PICKED_UP' | 'DELIVERED',
  dispatch: CustomerDispatchView,
  extra: Partial<ReturnType<typeof orderViewFixture>['progress']> = {},
) =>
  orderViewFixture({
    status,
    progress: { ...orderViewFixture().progress, ...extra, dispatch },
  });

describe('the line under the h1', () => {
  it('follows the courier search while the order is ready', () => {
    expect(
      stepLine(
        order('READY', { state: 'searching', courier: null, changed: false }),
        'ready',
        false,
      ),
    ).toBe("It's packed. We're finding a courier to bring it to you.");
    expect(
      stepLine(order('READY', { state: 'slow', courier: null, changed: false }), 'ready', false),
    ).toBe(
      "It's packed, but finding a courier is taking longer than usual. We're on it and will update this page.",
    );
    expect(
      stepLine(
        order('READY', { state: 'assigned', courier: LUIS, changed: false }),
        'ready',
        false,
      ),
    ).toBe("It's packed. Luis is on the way to pick it up.");
  });

  it('leaves the apology to the arrival note once the window has passed (D27)', () => {
    const late = order(
      'READY',
      { state: 'slow', courier: null, changed: false },
      {
        arrival: {
          kind: 'pastDue',
          from: '2026-11-20T00:20:00.000Z',
          to: '2026-11-20T00:30:00.000Z',
          lateMinutes: null,
          behind: false,
        },
      },
    );
    expect(stepLine(late, 'ready', false)).toBe(
      "It's packed. We're finding a courier to bring it to you.",
    );
  });

  it('names the courier on the way, and after delivery', () => {
    const onItsWay = order('PICKED_UP', { state: 'pickedUp', courier: LUIS, changed: false });
    expect(stepLine(onItsWay, 'pickedUp', false)).toBe('Luis is bringing your order.');
    expect(statusAnnouncement(onItsWay)).toBe(
      'Order 1042: On its way. Luis is bringing your order.',
    );
    const otherWay = order('PICKED_UP', { state: 'none', courier: null, changed: false });
    expect(stepLine(otherWay, 'pickedUp', false)).toBe('Your order has left the kitchen.');
    expect(
      deliveredByLine(order('DELIVERED', { state: 'delivered', courier: LUIS, changed: false })),
    ).toBe('Delivered by Luis.');
    expect(
      deliveredByLine(order('DELIVERED', { state: 'delivered', courier: null, changed: false })),
    ).toBeNull();
  });

  it("keeps F5's line without the courier view", () => {
    const older = orderViewFixture({ status: 'READY' });
    expect(stepLine(older, 'ready', false)).toBe("It's packed and waiting for the courier.");
  });
});

describe('the courier block', () => {
  it('shows from acceptance until delivery only', () => {
    expect(courierShown(order('READY', { state: 'assigned', courier: LUIS, changed: false }))).toBe(
      LUIS,
    );
    expect(
      courierShown(order('PICKED_UP', { state: 'pickedUp', courier: LUIS, changed: false })),
    ).toBe(LUIS);
    expect(
      courierShown(order('DELIVERED', { state: 'delivered', courier: LUIS, changed: false })),
    ).toBeNull();
    expect(
      courierShown(order('READY', { state: 'searching', courier: null, changed: false })),
    ).toBeNull();
  });

  it('reads the vehicle, the rating and a change of courier', () => {
    expect(vehicleSpokenWords('Scooter · 7KT 342')).toBe('Scooter, plate 7KT 342');
    expect(vehicleSpokenWords('Bicycle')).toBe('Bicycle');
    expect(ratingWords({ average: 4.6, count: 31 })).toEqual({
      text: '4.6 · 31 ratings',
      spoken: 'Rated 4.6 from 31 ratings',
    });
    expect(ratingWords({ average: 5, count: 1 })?.text).toBe('5.0 · 1 rating');
    expect(ratingWords(null)).toBeNull();
    expect(courierChangedText('Grace')).toBe(
      'Your courier changed. Grace is now on the way to pick it up.',
    );
    expect(courierTimelineText('Luis')).toBe('Luis is on the way to the kitchen');
  });
});
