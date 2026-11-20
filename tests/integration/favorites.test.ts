import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { db } from '@/server/db/client';
import { runAs } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';
import { nextHeaders, newBrowser, switchBrowser } from './support/browser';

/*
 * Favorites (F3 S5) through their Server Actions: hearting, the list, the 100 limit, the demo
 * exception (B13), the data export, and row-level security keeping them to their owner.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const authActions = await import('@/server/modules/auth/actions');
const account = await import('@/server/modules/account/actions');
const favorites = await import('@/server/modules/favorites/actions');

let migrator: PrismaClient;
const dish: Record<string, string> = {};

async function signUp(tag = 'fav') {
  const browser = switchBrowser(newBrowser());
  const email = `${tag}-${uuid()}@example.com`;
  const result = await authActions.signUpAction({
    name: 'Maya Lopez',
    email,
    password: 'correct horse battery',
    captchaToken: 'ok',
  });
  expect(result?.data?.signedIn).toBe(true);
  const { id } = await migrator.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { browser, userId: id };
}

const heart = (slug: string, on = true) =>
  favorites.setFavoriteAction({ menuItemId: dish[slug]!, on });

const byId = (a: string, b: string) => a.localeCompare(b);

const customer = (userId: string) =>
  ({ kind: 'user', userId, role: 'customer', isDemo: false }) as const;

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  for (const row of await migrator.menuItem.findMany({ select: { id: true, slug: true } })) {
    dish[row.slug] = row.id;
  }
}, 120_000);

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

describe('hearting dishes (S5.2, S5.8)', () => {
  it('saves and removes a favorite, idempotently, and lists newest first', async () => {
    await signUp();
    expect((await heart('bulgogi'))?.data).toEqual({
      menuItemId: dish.bulgogi,
      on: true,
      count: 1,
      limit: 100,
    });
    // The same tap again changes nothing.
    expect((await heart('bulgogi'))?.data?.count).toBe(1);
    await heart('naengmyeon');
    await heart('gimbap');
    expect((await heart('gimbap', false))?.data).toMatchObject({ on: false, count: 2 });
    expect((await heart('gimbap', false))?.data?.count).toBe(2);

    const list = (await favorites.listFavoritesAction())?.data;
    expect(list?.dishes.map((d) => d.slug)).toEqual(['naengmyeon', 'bulgogi']);
    expect(list).toMatchObject({ count: 2, limit: 100 });
    // A sold-out favorite stays, flagged (S5.4).
    expect(list?.dishes[0]).toMatchObject({ title: 'Naengmyeon', isAvailable: false });
    expect(Date.parse(list!.dishes[0]!.savedAt)).toBeGreaterThan(0);

    expect((await favorites.listFavoriteIdsAction())?.data?.ids.toSorted(byId)).toEqual(
      [dish.bulgogi!, dish.naengmyeon!].toSorted(byId),
    );
    expect((await account.getAccountAction())?.data?.favoriteCount).toBe(2);
  });

  it('ends a fast double tap without an error or a duplicate', async () => {
    await signUp();
    const results = await Promise.all([heart('kimchi'), heart('kimchi'), heart('kimchi')]);
    for (const result of results) expect(result?.serverError).toBeUndefined();
    expect((await favorites.listFavoriteIdsAction())?.data?.ids).toEqual([dish.kimchi]);
  });

  it('drops a dish taken off the menu from the list (S5.7)', async () => {
    await signUp();
    const temporary = await migrator.menuItem.create({
      data: {
        slug: `gone-${uuid()}`,
        title: 'Seasonal dish',
        description: 'Only for a while.',
        priceCents: 1000,
        cuisine: 'THAI',
      },
      select: { id: true },
    });
    await favorites.setFavoriteAction({ menuItemId: temporary.id, on: true });
    await migrator.menuItem.delete({ where: { id: temporary.id } });
    expect((await favorites.listFavoritesAction())?.data?.dishes).toEqual([]);
  });

  it('refuses a dish that isn’t on the menu, a guest, and any user id in the input', async () => {
    await signUp();
    expect(
      (await favorites.setFavoriteAction({ menuItemId: uuid(), on: true }))?.serverError,
    ).toMatchObject({
      code: 'NOT_FOUND',
      message: "That dish isn't on our menu any more.",
    });
    // Turning off a heart that isn't there is fine.
    expect((await favorites.setFavoriteAction({ menuItemId: uuid(), on: false }))?.data?.on).toBe(
      false,
    );

    const other = await signUp('victim');
    const input = { menuItemId: dish.gimbap!, on: true, userId: other.userId };
    const tampered = await favorites.setFavoriteAction(input);
    expect(tampered?.validationErrors).toBeDefined();
    expect(await migrator.favorite.count({ where: { userId: other.userId } })).toBe(0);

    switchBrowser(newBrowser());
    for (const result of [
      await heart('gimbap'),
      await favorites.listFavoritesAction(),
      await favorites.listFavoriteIdsAction(),
    ]) {
      expect(result?.serverError?.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('limits (S5.10, B13)', () => {
  it('keeps at most 100 favorites', async () => {
    const { userId } = await signUp();
    const tag = uuid().slice(-8);
    await migrator.menuItem.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        slug: `limit-${tag}-${i}`,
        title: `Limit dish ${i}`,
        description: 'For the favorites limit.',
        priceCents: 1000,
        cuisine: 'THAI' as const,
      })),
    });
    try {
      const extra = await migrator.menuItem.findMany({
        where: { slug: { startsWith: `limit-${tag}-` } },
        select: { id: true },
      });
      await migrator.favorite.createMany({
        data: extra.map((row) => ({ userId, menuItemId: row.id })),
      });
      expect((await heart('gimbap'))?.serverError).toMatchObject({
        code: 'LIMIT_REACHED',
        message: 'You can keep up to 100 favorites. Remove one to add another.',
      });
      // Removing still works at the limit, and frees a place.
      await favorites.setFavoriteAction({ menuItemId: extra[0]!.id, on: false });
      expect((await heart('gimbap'))?.data?.count).toBe(100);
    } finally {
      await migrator.menuItem.deleteMany({ where: { slug: { startsWith: `limit-${tag}-` } } });
    }
  });

  it('allows 60 changes a minute per account', async () => {
    await signUp();
    for (let i = 0; i < 60; i++) {
      expect((await heart('gimbap', i % 2 === 0))?.serverError).toBeUndefined();
    }
    const refused = (await heart('gimbap'))?.serverError;
    expect(refused).toMatchObject({ code: 'RATE_LIMITED' });
    expect(refused?.message).toMatch(/^You're changing favorites very fast\. Try again in /);
  });

  it('lets the shared demo customer keep favorites, unlike the rest of the account (B13)', async () => {
    const { userId } = await signUp('demo');
    await migrator.user.update({ where: { id: userId }, data: { isDemo: true } });
    expect((await heart('bulgogi'))?.data?.on).toBe(true);
    expect((await favorites.listFavoritesAction())?.data?.count).toBe(1);
    // The rest of the account stays read-only.
    expect((await account.updateProfileAction({ name: 'Someone else' }))?.serverError?.code).toBe(
      'DEMO_READ_ONLY',
    );
  });
});

describe('only the owner (S5.11)', () => {
  it('hides favorites from everyone else and refuses changes to them in the database', async () => {
    const owner = await signUp('owner');
    await heart('bulgogi');
    const other = await signUp('other');

    const seen = await runAs(customer(other.userId), (ctx) =>
      db(ctx).favorite.findMany({ select: { userId: true } }),
    );
    expect(seen.some((row) => row.userId === owner.userId)).toBe(false);

    const removed = await runAs(customer(other.userId), (ctx) =>
      db(ctx).favorite.deleteMany({ where: { userId: owner.userId } }),
    );
    expect(removed.count).toBe(0);

    await expect(
      runAs(customer(other.userId), (ctx) =>
        db(ctx).favorite.create({ data: { userId: owner.userId, menuItemId: dish.gimbap! } }),
      ),
    ).rejects.toThrow(/row-level security/);

    const anonymous = await runAs({ kind: 'anonymous' }, (ctx) => db(ctx).favorite.count());
    expect(anonymous).toBe(0);
    expect(await migrator.favorite.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('includes favorites in "Download my data" with dish names and dates', async () => {
    await signUp();
    await heart('pho-bo');
    const exported = (await account.exportMyDataAction())?.data?.data;
    expect(exported?.favorites).toEqual([
      { dish: 'Phở Bò', savedAt: expect.any(String) as string },
    ]);
  });
});
