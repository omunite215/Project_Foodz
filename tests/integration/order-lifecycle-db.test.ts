import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Role } from '@/server/auth/roles';
import { db, prisma } from '@/server/db/client';
import { type Actor, runAs, runAsSystem } from '@/server/db/context';
import { type Prisma, PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';

/*
 * The F5 migration as the app's database role meets it (contract 9): what each staff role may
 * change on an order, the status's version, the ready-by snapshot, code release, account
 * anonymisation mid-order, the masked views for the demo admin, the append-only timeline and
 * the menu guard. These hold even if a service check were missing.
 */

let migrator: PrismaClient;
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();
const ids = {
  real: uuid(),
  other: uuid(),
  sample: uuid(),
  kitchen: uuid(),
  sampleKitchen: uuid(),
  support: uuid(),
  admin: uuid(),
  editor: uuid(),
  demoAdmin: uuid(),
};
const dishes: Record<string, { id: string; prepMinutes: number; title: string }> = {};
let personalCode = '';
let publicCode = '';

const as = (role: Role | 'system', userId = uuid(), isDemo = false): Actor =>
  role === 'system' ? { kind: 'system', reason: 'test' } : { kind: 'user', userId, role, isDemo };
const kitchen = () => as('kitchen', ids.kitchen);
const support = () => as('support', ids.support);
const admin = () => as('admin', ids.admin);
const demoAdmin = () => as('admin', ids.demoAdmin, true);

async function order(
  extra: Partial<Prisma.OrderUncheckedCreateInput> = {},
  lines: { slug: string; quantity?: number; note?: string }[] = [{ slug: 'gimbap' }],
) {
  const created = await runAsSystem('test order', async (ctx) => {
    const row = await db(ctx).order.create({
      data: {
        number: `DB-${TAG}-${uuid().slice(-8)}`,
        userId: ids.real,
        status: 'PLACED',
        paymentMethod: 'CASH',
        contactName: 'Maya Lopez',
        contactPhone: '+16175550142',
        addressText: '12 Peterborough Street, Apt 3, Boston, MA 02215',
        addressLabel: "Mum's place",
        addressLine1: '12 Peterborough Street',
        addressLine2: 'Apt 3',
        addressCity: 'Boston, MA 02215',
        courierInstructions: 'Buzzer 3',
        addressLat: 42.346712,
        addressLng: -71.097234,
        distanceKm: 4.3,
        note: 'More spicy',
        subtotalCents: 2598,
        deliveryFeeCents: 414,
        taxCents: 182,
        totalCents: 3194,
        placedAt: new Date(),
        ...extra,
      },
      select: { id: true },
    });
    await db(ctx).orderItem.createMany({
      data: lines.map((line) => ({
        orderId: row.id,
        menuItemId: dishes[line.slug]!.id,
        title: dishes[line.slug]!.title,
        unitPriceCents: 1299,
        quantity: line.quantity ?? 1,
        flavors: [],
        note: line.note ?? null,
      })),
    });
    return row;
  });
  return created.id;
}

const read = (id: string) =>
  migrator.order.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      version: true,
      statusChangedVersion: true,
      prepMinutes: true,
      paymentStatus: true,
      totalCents: true,
      cancelReason: true,
    },
  });

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  for (const dish of await migrator.menuItem.findMany({
    select: { id: true, slug: true, prepMinutes: true, title: true },
  })) {
    dishes[dish.slug] = dish;
  }
  await migrator.user.createMany({
    data: [
      { id: ids.real, name: 'Maya Lopez', email: `maya-${ids.real}@example.com` },
      { id: ids.other, name: 'Omar Other', email: `omar-${ids.other}@example.com` },
      {
        id: ids.sample,
        name: 'Priya Shah',
        email: `priya-${ids.sample}@foodz.example`,
        isSample: true,
      },
      {
        id: ids.kitchen,
        name: 'Real Cook',
        email: `cook-${ids.kitchen}@example.com`,
        role: 'kitchen',
      },
      {
        id: ids.sampleKitchen,
        name: 'Alex Kim',
        email: `alex-${ids.sampleKitchen}@foodz.example`,
        role: 'kitchen',
        isSample: true,
      },
      {
        id: ids.support,
        name: 'Morgan Diaz',
        email: `morgan-${ids.support}@example.com`,
        role: 'support',
      },
      {
        id: ids.admin,
        name: 'Foodz Admin',
        email: `admin-${ids.admin}@example.com`,
        role: 'admin',
      },
      {
        id: ids.editor,
        name: 'Taylor Brooks',
        email: `taylor-${ids.editor}@example.com`,
        role: 'content_editor',
      },
      {
        id: ids.demoAdmin,
        name: 'Demo Admin',
        email: `demo-${ids.demoAdmin}@foodz.example`,
        role: 'admin',
        isDemo: true,
      },
    ],
  });
  personalCode = `MINE${TAG}`;
  publicCode = `ALL${TAG}`;
  await migrator.coupon.createMany({
    data: [
      {
        code: personalCode,
        type: 'FIXED',
        value: 200,
        ownerUserId: ids.real,
        isStoreCredit: true,
        usageLimit: 1,
        usedCount: 1,
      },
      { code: publicCode, type: 'PERCENT', value: 10 },
    ],
  });
}, 120_000);

afterAll(async () => {
  await migrator.$disconnect();
  await prisma.$disconnect();
  await redis.quit();
});

describe('what each staff role may change on an order (orders_guard_staff_write)', () => {
  it('lets the kitchen move one step at a time and refuse a New order, nothing more', async () => {
    const id = await order();
    await runAs(kitchen(), (ctx) =>
      db(ctx).order.update({
        where: { id },
        data: { version: { increment: 1 }, status: 'ACCEPTED', acceptedAt: new Date() },
      }),
    );
    expect(await read(id)).toMatchObject({
      status: 'ACCEPTED',
      version: 1,
      statusChangedVersion: 1,
    });

    // Skipping a step, money, cancelling after Accept, or a cancellation recorded as support's.
    await expect(
      runAs(kitchen(), (ctx) =>
        db(ctx).order.update({
          where: { id },
          data: { version: { increment: 1 }, status: 'READY' },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAs(kitchen(), (ctx) =>
        db(ctx).order.update({ where: { id }, data: { totalCents: 1, version: { increment: 1 } } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAs(kitchen(), (ctx) =>
        db(ctx).order.update({
          where: { id },
          data: {
            version: { increment: 1 },
            status: 'CANCELLED',
            cancelReason: 'kitchen-refused',
            cancelCode: 'too-busy',
            cancelledAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/permission denied/);

    const fresh = await order();
    await expect(
      runAs(kitchen(), (ctx) =>
        db(ctx).order.update({
          where: { id: fresh },
          data: {
            version: { increment: 1 },
            status: 'CANCELLED',
            cancelReason: 'staff',
            cancelCode: 'too-busy',
            cancelledAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    await runAs(kitchen(), (ctx) =>
      db(ctx).order.update({
        where: { id: fresh },
        data: {
          version: { increment: 1 },
          status: 'CANCELLED',
          cancelReason: 'kitchen-refused',
          cancelCode: 'too-busy',
          cancelledAt: new Date(),
        },
      }),
    );
    expect(await read(fresh)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'kitchen-refused',
    });
    expect((await read(id)).totalCents).toBe(3194);
  });

  it('lets staff enter or clear only the step time of their move, moving the version on (S16)', async () => {
    const id = await order();
    const write = (data: Prisma.OrderUpdateInput) =>
      runAs(kitchen(), (ctx) => db(ctx).order.update({ where: { id }, data }));
    const step = { increment: 1 };
    await expect(write({ status: 'ACCEPTED', acceptedAt: new Date() })).rejects.toThrow(
      /move the order's version on/,
    );
    await expect(
      write({ status: 'ACCEPTED', acceptedAt: new Date(), readyAt: new Date(), version: step }),
    ).rejects.toThrow(/does not change ready_at/);
    await expect(write({ status: 'ACCEPTED', version: step })).rejects.toThrow(
      /must enter accepted_at/,
    );
    await write({ status: 'ACCEPTED', acceptedAt: new Date(), version: step });
    await expect(write({ status: 'PLACED', version: step })).rejects.toThrow(
      /must clear accepted_at/,
    );
    await write({ status: 'PLACED', acceptedAt: null, version: step });
    await expect(
      write({
        status: 'CANCELLED',
        cancelReason: 'kitchen-refused',
        cancelCode: 'too-busy',
        cancelledAt: new Date(),
        preparingAt: new Date(),
        version: step,
      }),
    ).rejects.toThrow(/does not change preparing_at/);
    expect(await read(id)).toMatchObject({ status: 'PLACED', version: 2 });
  });

  it('lets support cancel New to Ready with a staff-cancel refund, never move or decide other refunds', async () => {
    const id = await order({ status: 'ACCEPTED' });
    await expect(
      runAs(support(), (ctx) =>
        db(ctx).order.update({
          where: { id },
          data: { version: { increment: 1 }, status: 'PREPARING' },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAs(support(), (ctx) =>
        db(ctx).order.update({
          where: { id },
          data: {
            version: { increment: 1 },
            status: 'CANCELLED',
            cancelReason: 'staff',
            cancelCode: 'customer-asked',
            cancelledAt: new Date(),
            autoRefundReason: 'customer-cancel',
          },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    await runAs(support(), (ctx) =>
      db(ctx).order.update({
        where: { id },
        data: {
          version: { increment: 1 },
          status: 'CANCELLED',
          cancelReason: 'staff',
          cancelCode: 'customer-asked',
          cancelledAt: new Date(),
          autoRefundReason: 'staff-cancel',
        },
      }),
    );
    expect(await read(id)).toMatchObject({ status: 'CANCELLED', cancelReason: 'staff' });
  });

  it('lets an admin mark a cash order delivered and paid, but never a card order paid', async () => {
    const cash = await order({ status: 'PICKED_UP' });
    await runAs(admin(), (ctx) =>
      db(ctx).order.update({
        where: { id: cash },
        data: {
          version: { increment: 1 },
          status: 'DELIVERED',
          deliveredAt: new Date(),
          paymentStatus: 'PAID',
        },
      }),
    );
    expect(await read(cash)).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });

    const card = await order({
      status: 'PICKED_UP',
      paymentMethod: 'CARD',
      paymentStatus: 'PARTIALLY_REFUNDED',
    });
    await expect(
      runAs(admin(), (ctx) =>
        db(ctx).order.update({
          where: { id: card },
          data: {
            version: { increment: 1 },
            status: 'DELIVERED',
            deliveredAt: new Date(),
            paymentStatus: 'PAID',
          },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    // The kitchen can't hand over at all.
    await expect(
      runAs(kitchen(), (ctx) =>
        db(ctx).order.update({
          where: { id: card },
          data: { version: { increment: 1 }, status: 'DELIVERED', deliveredAt: new Date() },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('changes no rows for customers, content editors and the demo admin (A13.5)', async () => {
    const id = await order();
    for (const actor of [
      as('customer', ids.real),
      as('content_editor', ids.editor),
      demoAdmin(),
      as('partner'),
    ]) {
      const changed = await runAs(actor, (ctx) =>
        db(ctx).order.updateMany({ where: { id }, data: { status: 'ACCEPTED' } }),
      );
      expect(changed.count).toBe(0);
    }
    expect((await read(id)).status).toBe('PLACED');
  });
});

describe("the status's version (orders_track_status)", () => {
  it('records every status change, F4 writes included, and only status changes', async () => {
    const id = await order({ status: 'PENDING_PAYMENT', paymentMethod: 'CARD', placedAt: null });
    // A platform write that changes the status without touching the version.
    await runAsSystem('test', (ctx) =>
      db(ctx).order.update({ where: { id }, data: { status: 'PLACED', paymentStatus: 'PAID' } }),
    );
    expect(await read(id)).toMatchObject({ version: 1, statusChangedVersion: 1 });
    // A refund (money only) moves the version but not the status's.
    await runAsSystem('test', (ctx) =>
      db(ctx).order.update({
        where: { id },
        data: {
          refundedCents: 100,
          paymentStatus: 'PARTIALLY_REFUNDED',
          version: { increment: 1 },
        },
      }),
    );
    expect(await read(id)).toMatchObject({ version: 2, statusChangedVersion: 1 });
    // Nobody can set it by hand.
    await runAsSystem('test', (ctx) =>
      db(ctx).order.update({ where: { id }, data: { statusChangedVersion: 99 } }),
    );
    expect((await read(id)).statusChangedVersion).toBe(1);
  });

  it('snapshots the longest prep of the dishes when the lines are written', async () => {
    const id = await order({}, [{ slug: 'samgyeopsal' }, { slug: 'pad-thai' }]);
    expect((await read(id)).prepMinutes).toBe(
      Math.max(dishes.samgyeopsal!.prepMinutes, dishes['pad-thai']!.prepMinutes),
    );
  });
});

async function withCode(code: string, status: 'PLACED' | 'CANCELLED') {
  const coupon = await migrator.coupon.findUniqueOrThrow({
    where: { code },
    select: { id: true },
  });
  const id = await order({
    status,
    couponId: coupon.id,
    promoCode: code,
    ...(status === 'CANCELLED' && {
      cancelledAt: new Date(),
      cancelReason: 'staff',
      cancelCode: 'too-busy',
    }),
  });
  await migrator.couponRedemption.create({
    data: {
      couponId: coupon.id,
      userId: ids.real,
      orderId: id,
      status: 'REDEEMED',
      discountCents: 200,
    },
  });
  return id;
}

const release = (actor: Actor, id: string) =>
  runAs(
    actor,
    (ctx) =>
      db(ctx).$queryRaw<
        { code: string | null }[]
      >`SELECT app_release_order_code(${id}::uuid) AS code`,
  ).then((rows) => rows[0]?.code ?? null);

describe('code release (app_release_order_code)', () => {
  it('gives a cancelled order its code back once, for operations staff', async () => {
    await migrator.coupon.update({ where: { code: personalCode }, data: { usedCount: 1 } });
    const id = await withCode(personalCode, 'CANCELLED');
    expect(await release(kitchen(), id)).toBe(personalCode);
    expect(await release(support(), id)).toBeNull();
    expect(
      (await migrator.coupon.findUniqueOrThrow({ where: { code: personalCode } })).usedCount,
    ).toBe(0);
    expect(
      (await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId: id } })).status,
    ).toBe('RELEASED');
  });

  it('refuses orders that are not cancelled, customers and the demo admin', async () => {
    const live = await withCode(publicCode, 'PLACED');
    await expect(release(admin(), live)).rejects.toThrow(/only for a cancelled order/);
    const cancelled = await withCode(publicCode, 'CANCELLED');
    await expect(release(as('customer', ids.real), cancelled)).rejects.toThrow(/permission denied/);
    await expect(release(demoAdmin(), cancelled)).rejects.toThrow(/permission denied/);
  });
});

describe('account anonymisation (F4 security S9 c)', () => {
  it('is refused while the caller has an order in progress, and runs once none is', async () => {
    const customer = uuid();
    await migrator.user.create({
      data: { id: customer, name: 'Lee Gone', email: `lee-${customer}@example.com` },
    });
    const id = await order({ userId: customer, status: 'ACCEPTED' });
    const anonymise = () =>
      runAs(
        as('customer', customer),
        (ctx) =>
          db(ctx).$queryRaw<
            { app_anonymize_own_orders: number }[]
          >`SELECT app_anonymize_own_orders()`,
      );
    await expect(anonymise()).rejects.toThrow(/in progress/);
    await migrator.order.update({ where: { id }, data: { status: 'DELIVERED' } });
    expect((await anonymise())[0]?.app_anonymize_own_orders).toBe(1);
    expect((await migrator.order.findUniqueOrThrow({ where: { id } })).contactName).toBe(
      'Deleted customer',
    );
  });
});

async function timelineOrder(userId: string) {
  const coupon = await migrator.coupon.findUniqueOrThrow({
    where: { code: personalCode },
    select: { id: true },
  });
  const id = await order(
    {
      userId,
      paymentMethod: 'CARD',
      paymentStatus: 'PAID',
      cardBrand: 'visa',
      cardLast4: '4242',
      couponId: coupon.id,
      promoCode: personalCode,
    },
    [{ slug: 'gimbap', note: 'No cucumber please' }],
  );
  await migrator.orderEvent.createMany({
    data: [
      {
        orderId: id,
        type: 'accepted',
        actorId: ids.kitchen,
        data: { by: { name: 'Real Cook', role: 'kitchen' }, versionAfter: 1 },
      },
      {
        orderId: id,
        type: 'preparing',
        actorId: ids.sampleKitchen,
        data: { by: { name: 'Alex Kim', role: 'kitchen' }, versionAfter: 2 },
      },
      {
        orderId: id,
        type: 'cancelled',
        actorId: ids.support,
        data: {
          actor: 'staff',
          by: { name: 'Morgan Diaz', role: 'support' },
          note: 'Called back to confirm',
          codeReleased: personalCode,
        },
      },
    ],
  });
  return id;
}

describe('what staff read through the directory views (F4 security S9 a, A14.2)', () => {
  interface Row {
    contact_name: string;
    contact_phone: string;
    address_line1: string | null;
    address_label: string | null;
    note: string | null;
    promo_code: string | null;
    card_brand: string | null;
    card_last4: string | null;
    total_cents: number;
    masked: boolean;
  }
  const orderRow = (actor: Actor, id: string) =>
    runAs(
      actor,
      (ctx) =>
        db(ctx).$queryRaw<Row[]>`
        SELECT contact_name, contact_phone, address_line1, address_label, note, promo_code,
               card_brand, card_last4, total_cents, masked
        FROM order_directory WHERE id = ${id}::uuid`,
    ).then((rows) => rows[0] ?? null);

  it("masks a real customer's contact, address, notes, own code and card digits for the demo admin", async () => {
    const id = await timelineOrder(ids.real);
    expect(await orderRow(demoAdmin(), id)).toEqual({
      contact_name: 'M•••',
      contact_phone: '•••42',
      address_line1: '•••',
      address_label: '•••',
      note: '•••',
      promo_code: null,
      card_brand: 'visa',
      card_last4: null,
      total_cents: 3194,
      masked: true,
    });
    const lines = await runAs(
      demoAdmin(),
      (ctx) =>
        db(ctx).$queryRaw<{ title: string; note: string | null }[]>`
        SELECT title, note FROM order_item_directory WHERE order_id = ${id}::uuid`,
    );
    expect(lines).toEqual([{ title: 'Gimbap', note: '•••' }]);
    const events = await runAs(
      demoAdmin(),
      (ctx) =>
        db(ctx).$queryRaw<
          {
            type: string;
            data: { by?: { name: string | null }; note?: string; codeReleased?: string };
          }[]
        >`
        SELECT type, data FROM order_event_directory WHERE order_id = ${id}::uuid ORDER BY type`,
    );
    const byType = Object.fromEntries(events.map((event) => [event.type, event.data]));
    // A real staff member's name is hidden; a sample one's is shown; the staff note is dropped.
    expect(byType.accepted?.by?.name).toBeNull();
    expect(byType.preparing?.by?.name).toBe('Alex Kim');
    expect(byType.cancelled?.note).toBeUndefined();
    // Nor which of her codes it gave back (S17).
    expect(byType.cancelled).not.toHaveProperty('codeReleased');
  });

  it('shows sample customers in full to the demo admin, and everyone in full to real staff', async () => {
    const sample = await timelineOrder(ids.sample);
    expect(await orderRow(demoAdmin(), sample)).toMatchObject({
      contact_name: 'Maya Lopez',
      card_last4: '4242',
      promo_code: personalCode,
      masked: false,
    });
    const real = await timelineOrder(ids.real);
    expect(await orderRow(kitchen(), real)).toMatchObject({
      contact_phone: '+16175550142',
      masked: false,
    });
    const events = await runAs(
      admin(),
      (ctx) =>
        db(ctx).$queryRaw<{ data: { by?: { name: string }; note?: string } }[]>`
        SELECT data FROM order_event_directory WHERE order_id = ${real}::uuid AND type = 'cancelled'`,
    );
    expect(events[0]?.data.note).toBe('Called back to confirm');
  });

  it('lets a customer read only her own orders through the views', async () => {
    const mine = await order();
    expect(await orderRow(as('customer', ids.real), mine)).not.toBeNull();
    expect(await orderRow(as('customer', ids.other), mine)).toBeNull();
  });
});

describe('the timeline is append-only (A8.5)', () => {
  it('refuses to change or remove an event for every app role', async () => {
    const id = await order();
    await migrator.orderEvent.create({
      data: { orderId: id, type: 'placed', data: { actor: 'customer' } },
    });
    for (const actor of [admin(), kitchen(), as('system')]) {
      const changed = await runAs(actor, async (ctx) => ({
        updated: await db(ctx).orderEvent.updateMany({
          where: { orderId: id },
          data: { type: 'forged' },
        }),
        removed: await db(ctx).orderEvent.deleteMany({ where: { orderId: id } }),
      }));
      expect(changed.updated.count).toBe(0);
      expect(changed.removed.count).toBe(0);
    }
    expect(await migrator.orderEvent.count({ where: { orderId: id, type: 'placed' } })).toBe(1);
  });
});

const setAvailable = (actor: Actor, available: boolean) =>
  runAs(actor, (ctx) =>
    db(ctx).menuItem.update({
      where: { id: dishes.tteokbokki!.id },
      data: { isAvailable: available, soldOutAt: available ? null : new Date() },
    }),
  );

describe('who may change a dish (menu_items_guard_write)', () => {
  it('lets the kitchen mark a dish sold out or back on, and nothing else', async () => {
    await setAvailable(kitchen(), false);
    await setAvailable(kitchen(), true);
    await expect(
      runAs(kitchen(), (ctx) =>
        db(ctx).menuItem.update({ where: { id: dishes.tteokbokki!.id }, data: { priceCents: 1 } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses support, customers and the demo admin; admins and editors edit the menu', async () => {
    for (const actor of [
      support(),
      as('customer', ids.real),
      demoAdmin(),
      { kind: 'anonymous' } as const,
    ]) {
      await expect(setAvailable(actor, false)).rejects.toThrow(/permission denied/);
    }
    const price = (
      await migrator.menuItem.findUniqueOrThrow({ where: { id: dishes.tteokbokki!.id } })
    ).priceCents;
    await runAs(as('content_editor', ids.editor), (ctx) =>
      db(ctx).menuItem.update({
        where: { id: dishes.tteokbokki!.id },
        data: { priceCents: price },
      }),
    );
    await setAvailable(admin(), true);
  });
});
