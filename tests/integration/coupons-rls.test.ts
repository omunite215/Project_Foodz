import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Role } from '@/server/auth/roles';
import { db } from '@/server/db/client';
import { type Actor, runAs } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';

/*
 * Row-level security on coupons (F3, story B7): a personal or store-credit code is visible only
 * to its owner and to staff who may handle it, so the database itself answers "not found" to
 * everyone else. Public codes stay readable by every visitor.
 */

let migrator: PrismaClient;
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();
const PUBLIC = `PUBLIC-${TAG}`;
const REAL_CREDIT = `CREDIT-${TAG}-REAL`;
const SAMPLE_CREDIT = `CREDIT-${TAG}-SAMPLE`;
const owner = uuid();
const sampleOwner = uuid();
const stranger = uuid();

const as = (userId: string, role: Role = 'customer', isDemo = false): Actor => ({
  kind: 'user',
  userId,
  role,
  isDemo,
});

const visibleCodes = (actor: Actor) =>
  runAs(actor, async (ctx) =>
    (
      await db(ctx).coupon.findMany({
        where: { code: { in: [PUBLIC, REAL_CREDIT, SAMPLE_CREDIT] } },
        select: { code: true },
        orderBy: { code: 'asc' },
      })
    ).map((row) => row.code),
  );

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.user.createMany({
    data: [
      { id: owner, name: 'Owner', email: `owner-${owner}@test.dev` },
      { id: sampleOwner, name: 'Sample', email: `sample-${sampleOwner}@test.dev`, isSample: true },
      { id: stranger, name: 'Stranger', email: `stranger-${stranger}@test.dev` },
    ],
  });
  await migrator.coupon.createMany({
    data: [
      { code: PUBLIC, type: 'PERCENT', value: 10 },
      { code: REAL_CREDIT, type: 'FIXED', value: 800, ownerUserId: owner, isStoreCredit: true },
      {
        code: SAMPLE_CREDIT,
        type: 'FIXED',
        value: 500,
        ownerUserId: sampleOwner,
        isStoreCredit: true,
      },
    ],
  });
});

afterAll(async () => {
  await migrator.coupon.deleteMany({
    where: { code: { in: [PUBLIC, REAL_CREDIT, SAMPLE_CREDIT] } },
  });
  await migrator.$disconnect();
});

describe('reading coupons', () => {
  it('shows public codes to everyone and a personal code only to its owner', async () => {
    expect(await visibleCodes({ kind: 'anonymous' })).toEqual([PUBLIC]);
    expect(await visibleCodes(as(stranger))).toEqual([PUBLIC]);
    expect(await visibleCodes(as(owner))).toEqual([REAL_CREDIT, PUBLIC].toSorted());
    // Kitchen and content staff have no business with store credit.
    expect(await visibleCodes(as(uuid(), 'kitchen'))).toEqual([PUBLIC]);
    expect(await visibleCodes(as(uuid(), 'content_editor'))).toEqual([PUBLIC]);
  });

  it('shows every code to support, admin and background jobs, but hides real people’s from demo staff', async () => {
    const all = [REAL_CREDIT, SAMPLE_CREDIT, PUBLIC].toSorted();
    expect(await visibleCodes(as(uuid(), 'support'))).toEqual(all);
    expect(await visibleCodes(as(uuid(), 'admin'))).toEqual(all);
    expect(await visibleCodes({ kind: 'system', reason: 'test' })).toEqual(all);
    expect(await visibleCodes(as(uuid(), 'admin', true))).toEqual(
      [SAMPLE_CREDIT, PUBLIC].toSorted(),
    );
  });

  it('cannot be got round by looking the code up directly', async () => {
    const found = await runAs(as(stranger), (ctx) =>
      db(ctx).coupon.findUnique({ where: { code: REAL_CREDIT }, select: { value: true } }),
    );
    expect(found).toBeNull();
  });
});

const issue = (actor: Actor) =>
  runAs(actor, (ctx) =>
    db(ctx).coupon.create({
      data: { code: `ISSUED-${TAG}-${uuid().slice(-6).toUpperCase()}`, type: 'FIXED', value: 100 },
      select: { code: true },
    }),
  );

describe('changing coupons', () => {
  it('lets only support, admin and jobs issue codes, and never demo staff', async () => {
    await expect(issue(as(stranger))).rejects.toThrow(/row-level security/);
    await expect(issue({ kind: 'anonymous' })).rejects.toThrow(/row-level security/);
    await expect(issue(as(uuid(), 'admin', true))).rejects.toThrow(/row-level security/);
    const issued = await issue(as(uuid(), 'support'));
    await migrator.coupon.delete({ where: { code: issued.code } });
  });

  it('never lets a customer change or delete someone else’s personal code', async () => {
    const changed = await runAs(as(stranger), (ctx) =>
      db(ctx).coupon.updateMany({ where: { code: REAL_CREDIT }, data: { value: 99_999 } }),
    );
    expect(changed.count).toBe(0);
    const deleted = await runAs(as(stranger), (ctx) =>
      db(ctx).coupon.deleteMany({ where: { code: { in: [PUBLIC, REAL_CREDIT] } } }),
    );
    expect(deleted.count).toBe(0);
    // A customer can't change a public code, claim it, or raise their own store credit.
    const before = await migrator.coupon.findUniqueOrThrow({
      where: { code: PUBLIC },
      select: { value: true, ownerUserId: true },
    });
    const publicChanged = await runAs(as(stranger), (ctx) =>
      db(ctx).coupon.updateMany({
        where: { code: PUBLIC },
        data: { value: 99_999, ownerUserId: stranger },
      }),
    );
    expect(publicChanged.count).toBe(0);
    const ownChanged = await runAs(as(owner), (ctx) =>
      db(ctx).coupon.updateMany({ where: { code: REAL_CREDIT }, data: { value: 99_999 } }),
    );
    expect(ownChanged.count).toBe(0);
    expect(
      await migrator.coupon.findUniqueOrThrow({
        where: { code: PUBLIC },
        select: { value: true, ownerUserId: true },
      }),
    ).toEqual(before);
    expect(
      await migrator.coupon.findUniqueOrThrow({
        where: { code: REAL_CREDIT },
        select: { value: true },
      }),
    ).toEqual({ value: 800 });
  });

  it('lets support change a code, but never demo staff', async () => {
    const supportChanged = await runAs(as(uuid(), 'support'), (ctx) =>
      db(ctx).coupon.updateMany({ where: { code: PUBLIC }, data: { isActive: true } }),
    );
    expect(supportChanged.count).toBe(1);
    const demoChanged = await runAs(as(uuid(), 'admin', true), (ctx) =>
      db(ctx).coupon.updateMany({ where: { code: PUBLIC }, data: { isActive: false } }),
    );
    expect(demoChanged.count).toBe(0);
  });

  it('never lets store credit exist without an owner, so it can never read as public', async () => {
    await expect(
      migrator.coupon.create({
        data: { code: `CREDIT-${TAG}-NOBODY`, type: 'FIXED', value: 500, isStoreCredit: true },
      }),
    ).rejects.toThrow(/coupons_store_credit_owner/);
  });

  it('keeps codes in the form the cart looks them up in', async () => {
    await expect(
      migrator.coupon.create({ data: { code: 'lower-case', type: 'FIXED', value: 1 } }),
    ).rejects.toThrow(/coupons_code_format/);
    await expect(
      migrator.coupon.create({ data: { code: 'HAS SPACE', type: 'FIXED', value: 1 } }),
    ).rejects.toThrow(/coupons_code_format/);
  });
});
