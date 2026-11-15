import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, prisma } from '@/server/db/client';
import { type Actor, runAs, runAsSystem } from '@/server/db/context';

const customerA = uuid();
const customerB = uuid();
const partnerUser = uuid();
let partnerId = '';
let orderOfA = '';
let orderOfB = '';

const asCustomer = (userId: string): Actor => ({
  kind: 'user',
  userId,
  role: 'customer',
  isDemo: false,
});
const asRole = (role: 'kitchen' | 'support' | 'partner', userId = uuid()): Actor => ({
  kind: 'user',
  userId,
  role,
  isDemo: false,
});

function orderData(userId: string, number: string) {
  return {
    number,
    userId,
    paymentMethod: 'CASH' as const,
    contactName: 'Test',
    contactPhone: '+15550000000',
    addressText: '1 Test Street',
    addressLat: 42.34,
    addressLng: -71.09,
    distanceKm: 2,
    subtotalCents: 2000,
    deliveryFeeCents: 300,
    taxCents: 125,
    totalCents: 2425,
  };
}

beforeAll(async () => {
  await runAsSystem('test setup', async (ctx) => {
    await db(ctx).user.createMany({
      data: [
        { id: customerA, name: 'A', email: `a-${customerA}@test.dev` },
        { id: customerB, name: 'B', email: `b-${customerB}@test.dev` },
        { id: partnerUser, name: 'P', email: `p-${partnerUser}@test.dev`, role: 'partner' },
      ],
    });
    const partner = await db(ctx).deliveryPartner.create({
      data: { userId: partnerUser, vehicleType: 'SCOOTER', status: 'APPROVED' },
    });
    partnerId = partner.id;
  });

  orderOfA = await runAs(asCustomer(customerA), async (ctx) => {
    const order = await db(ctx).order.create({ data: orderData(customerA, `A-${Date.now()}`) });
    return order.id;
  });
  orderOfB = await runAs(asCustomer(customerB), async (ctx) => {
    const order = await db(ctx).order.create({ data: orderData(customerB, `B-${Date.now()}`) });
    return order.id;
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('row-level security on orders', () => {
  it('shows customers only their own orders', async () => {
    const seen = await runAs(asCustomer(customerA), (ctx) =>
      db(ctx).order.findMany({ select: { id: true } }),
    );
    expect(seen.map((o) => o.id)).toEqual([orderOfA]);
  });

  it('silently skips other customers’ rows on update and delete', async () => {
    const result = await runAs(asCustomer(customerA), async (ctx) => ({
      updated: await db(ctx).order.updateMany({ where: { id: orderOfB }, data: { note: 'x' } }),
      deleted: await db(ctx).order.deleteMany({ where: { id: orderOfB } }),
    }));
    expect(result.updated.count).toBe(0);
    expect(result.deleted.count).toBe(0);
  });

  it('rejects creating an order on someone else’s account', async () => {
    await expect(
      runAs(asCustomer(customerA), (ctx) =>
        db(ctx).order.create({ data: orderData(customerB, `X-${Date.now()}`) }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('returns nothing to anonymous requests', async () => {
    const count = await runAs({ kind: 'anonymous' }, (ctx) => db(ctx).order.count());
    expect(count).toBe(0);
  });

  it('lets kitchen staff see orders but not customer addresses', async () => {
    const { orders, addresses } = await runAs(asRole('kitchen'), async (ctx) => {
      await runAsSystem('seed address', (sys) =>
        db(sys).address.create({
          data: {
            userId: customerA,
            label: 'Home',
            line1: '1 Test St',
            city: 'Boston',
            lat: 1,
            lng: 1,
          },
        }),
      );
      return {
        orders: await db(ctx).order.count(),
        addresses: await db(ctx).address.count(),
      };
    });
    expect(orders).toBeGreaterThanOrEqual(2);
    expect(addresses).toBe(0);
  });

  it('shows a partner only the orders they are delivering', async () => {
    const partner = asRole('partner', partnerUser);
    const before = await runAs(partner, (ctx) => db(ctx).order.count());
    expect(before).toBe(0);

    await runAsSystem('assign delivery', (ctx) =>
      db(ctx).delivery.create({
        data: { orderId: orderOfA, partnerId, otpHash: 'x', status: 'ASSIGNED' },
      }),
    );

    const visible = await runAs(partner, (ctx) => db(ctx).order.findMany({ select: { id: true } }));
    expect(visible.map((o) => o.id)).toEqual([orderOfA]);
  });
});

describe('audit log', () => {
  it('can be written but never changed or deleted by the app role', async () => {
    await runAsSystem('audit test', (ctx) =>
      db(ctx).auditLog.create({ data: { action: 'test.write', targetType: 'test' } }),
    );
    await expect(
      runAsSystem('audit tamper', (ctx) =>
        db(ctx).auditLog.deleteMany({ where: { action: 'test.write' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runAsSystem('audit tamper', (ctx) =>
        db(ctx).auditLog.updateMany({
          where: { action: 'test.write' },
          data: { action: 'changed' },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('schema privileges', () => {
  it('prevents the app role from changing the schema', async () => {
    await expect(
      prisma.$executeRawUnsafe('CREATE TABLE should_not_exist (id int)'),
    ).rejects.toThrow(/permission denied/i);
  });
});
