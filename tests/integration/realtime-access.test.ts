import { v7 as uuid } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { channels } from '@/lib/realtime/channels';
import type { Role } from '@/server/auth/roles';
import { db } from '@/server/db/client';
import { runAsSystem } from '@/server/db/context';
import { canSubscribe, type Subscriber } from '@/server/modules/realtime/service';

const customer = uuid();
const otherCustomer = uuid();
const courier = uuid();
const otherCourier = uuid();
let courierPartnerId = '';
let otherPartnerId = '';
let order = '';

const as = (userId: string, role: Role, extra: Partial<Subscriber> = {}): Subscriber => ({
  userId,
  role,
  isDemo: false,
  twoFactorEnabled: false,
  ...extra,
});

beforeAll(async () => {
  await runAsSystem('test setup', async (ctx) => {
    await db(ctx).user.createMany({
      data: [
        { id: customer, name: 'C', email: `c-${customer}@test.dev` },
        { id: otherCustomer, name: 'O', email: `o-${otherCustomer}@test.dev` },
        { id: courier, name: 'P', email: `p-${courier}@test.dev`, role: 'partner' },
        { id: otherCourier, name: 'Q', email: `q-${otherCourier}@test.dev`, role: 'partner' },
      ],
    });
    courierPartnerId = (
      await db(ctx).deliveryPartner.create({
        data: { userId: courier, vehicleType: 'SCOOTER', status: 'APPROVED' },
      })
    ).id;
    otherPartnerId = (
      await db(ctx).deliveryPartner.create({
        data: { userId: otherCourier, vehicleType: 'BICYCLE', status: 'APPROVED' },
      })
    ).id;
  });

  // Only the platform writes orders (F4 orders_insert), as checkout does on the customer's behalf.
  order = await runAsSystem('test setup: order', (ctx) =>
    db(ctx)
      .order.create({
        data: {
          number: `RT-${Date.now()}`,
          userId: customer,
          paymentMethod: 'CASH',
          contactName: 'C',
          contactPhone: '+15550000000',
          addressText: '1 Test Street',
          addressLat: 42.34,
          addressLng: -71.09,
          distanceKm: 2,
          subtotalCents: 2000,
          deliveryFeeCents: 300,
          taxCents: 125,
          totalCents: 2425,
        },
        select: { id: true },
      })
      .then((row) => row.id),
  );

  await runAsSystem('assign courier', (ctx) =>
    db(ctx).delivery.create({
      data: { orderId: order, partnerId: courierPartnerId, otpHash: 'x', status: 'ASSIGNED' },
    }),
  );
});

describe('realtime order channels', () => {
  it('admit the customer who placed the order and the courier delivering it', async () => {
    expect(await canSubscribe(as(customer, 'customer'), channels.order(order))).toBe(true);
    expect(await canSubscribe(as(courier, 'partner'), channels.order(order))).toBe(true);
  });

  it('refuse other customers and couriers', async () => {
    expect(await canSubscribe(as(otherCustomer, 'customer'), channels.order(order))).toBe(false);
    expect(await canSubscribe(as(otherCourier, 'partner'), channels.order(order))).toBe(false);
  });

  it('admit operations staff only with two-factor on', async () => {
    const kitchen = uuid();
    expect(await canSubscribe(as(kitchen, 'kitchen'), channels.order(order))).toBe(false);
    expect(
      await canSubscribe(as(kitchen, 'kitchen', { twoFactorEnabled: true }), channels.order(order)),
    ).toBe(true);
  });

  it('refuse staff whose role has nothing to do with orders', async () => {
    expect(
      await canSubscribe(
        as(uuid(), 'content_editor', { twoFactorEnabled: true }),
        channels.order(order),
      ),
    ).toBe(false);
  });

  it('give nothing away about orders that do not exist', async () => {
    expect(await canSubscribe(as(customer, 'customer'), channels.order(uuid()))).toBe(false);
  });
});

describe('other realtime channels', () => {
  it('let users hear only their own notifications', async () => {
    expect(await canSubscribe(as(customer, 'customer'), channels.user(customer))).toBe(true);
    expect(await canSubscribe(as(customer, 'customer'), channels.user(otherCustomer))).toBe(false);
  });

  it('send delivery offers only to the partner they are for', async () => {
    expect(await canSubscribe(as(courier, 'partner'), channels.partner(courierPartnerId))).toBe(
      true,
    );
    expect(await canSubscribe(as(courier, 'partner'), channels.partner(otherPartnerId))).toBe(
      false,
    );
    expect(await canSubscribe(as(customer, 'customer'), channels.partner(courierPartnerId))).toBe(
      false,
    );
  });

  it('open the ops channel to verified operations staff and the read-only demo admin', async () => {
    expect(
      await canSubscribe(as(uuid(), 'support', { twoFactorEnabled: true }), channels.ops),
    ).toBe(true);
    expect(await canSubscribe(as(uuid(), 'admin', { isDemo: true }), channels.ops)).toBe(true);
    expect(await canSubscribe(as(uuid(), 'admin'), channels.ops)).toBe(false);
    expect(await canSubscribe(as(customer, 'customer'), channels.ops)).toBe(false);
    expect(await canSubscribe(as(courier, 'partner'), channels.ops)).toBe(false);
  });

  it('refuse channels the app does not define', async () => {
    for (const name of ['public-news', `presence-order-${order}`, `private-order-${order}-x`]) {
      expect(await canSubscribe(as(customer, 'customer'), name)).toBe(false);
    }
  });
});

describe('the board channel (F5 A1.4, A1.5, T3, T17)', () => {
  it('admits kitchen, support and admin with two-factor, and refuses editors and staff without it', async () => {
    for (const role of ['kitchen', 'support', 'admin'] as const) {
      expect(await canSubscribe(as(uuid(), role, { twoFactorEnabled: true }), channels.ops)).toBe(
        true,
      );
      expect(await canSubscribe(as(uuid(), role), channels.ops)).toBe(false);
    }
    expect(
      await canSubscribe(as(uuid(), 'content_editor', { twoFactorEnabled: true }), channels.ops),
    ).toBe(false);
  });
});
