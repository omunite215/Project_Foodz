import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { UserActor } from '@/server/auth/session';
import { db } from '@/server/db/client';
import { runAs, runAsSystem } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import { AppError } from '@/server/errors';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';
import { nextHeaders, newBrowser, switchBrowser } from './support/browser';

vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);

const {
  checkDeliveryArea,
  createAddress,
  deleteAddress,
  getAddress,
  getAddressBook,
  searchAddresses,
  setDefaultAddress,
  updateAddress,
} = await import('@/server/modules/addresses/service');

// Straight north of the kitchen at 42.3505, -71.0450 (S4.7 edge pins), and seeded test places.
const PLACES = {
  peterborough: {
    line1: '12 Peterborough Street',
    city: 'Boston, MA 02215',
    lat: 42.3467,
    lng: -71.0972,
  },
  faneuil: { line1: '1 Faneuil Hall Square', city: 'Boston, MA 02109', lat: 42.36, lng: -71.0548 },
  edgeInside: { line1: 'Edge inside', city: 'Boston, MA', lat: 42.4216, lng: -71.045 },
  edgeOutside: { line1: 'Edge outside', city: 'Boston, MA', lat: 42.4234, lng: -71.045 },
  quincy: { line1: '1 Quincy Center Plaza', city: 'Quincy, MA 02169', lat: 42.2513, lng: -71.0036 },
};

let migrator: PrismaClient;

const customer = (isDemo = false): UserActor => ({
  kind: 'user',
  userId: uuid(),
  role: 'customer',
  isDemo,
});

/** Created as the table owner, the way the seed does: only it may flag demo accounts. */
async function createUsers(...actors: UserActor[]) {
  await migrator.user.createMany({
    data: actors.map((actor) => ({
      id: actor.userId,
      name: actor.isDemo ? 'Demo Person' : 'Real Person',
      email: `${actor.userId}@test.dev`,
      isDemo: actor.isDemo,
      role: actor.role,
    })),
  });
}

const home = (place = PLACES.peterborough, extra: Record<string, unknown> = {}) => ({
  kind: 'HOME' as const,
  line2: 'Apt 3',
  notes: 'Buzzer 3, leave at the door',
  ...place,
  ...extra,
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected an error');
    },
    (error: unknown) => error,
  );

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

describe('saving addresses', () => {
  it('saves the first address as the default, with its distance from the kitchen', async () => {
    const maya = customer();
    await createUsers(maya);
    const saved = await createAddress(maya, home());
    expect(saved).toMatchObject({
      kind: 'HOME',
      label: 'Home',
      line1: '12 Peterborough Street',
      line2: 'Apt 3',
      isDefault: true,
      deliverable: true,
    });
    expect(saved.distanceKm).toBeCloseTo(4.3, 1);

    // The geography point follows the coordinates.
    const [point] = await migrator.$queryRaw<{ wkt: string }[]>`
      SELECT ST_AsText(location::geometry) AS wkt FROM addresses WHERE id = ${saved.id}::uuid`;
    expect(point?.wkt).toBe('POINT(-71.0972 42.3467)');
  });

  it('accepts the 7.9 km pin and refuses the 8.1 km pin with the S4.6 sentence', async () => {
    const maya = customer();
    await createUsers(maya);
    await expect(createAddress(maya, home(PLACES.edgeInside))).resolves.toMatchObject({
      deliverable: true,
    });

    const refused = await errorOf(createAddress(maya, home(PLACES.edgeOutside, { kind: 'WORK' })));
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ code: 'OUTSIDE_DELIVERY_AREA', status: 422 });
    expect((refused as AppError).details).toMatchObject({ radiusKm: 8 });
    expect((refused as AppError).message).toMatch(
      /^Sorry, we don't deliver to Edge outside yet\. It's about 8\.1 km from our kitchen at 88 Harbor Street, and we deliver within 8 km\.$/,
    );
    expect((await getAddressBook(maya)).addresses).toHaveLength(1);
  });

  it('keeps text exactly as typed, markup included, and refuses control characters', async () => {
    const maya = customer();
    await createUsers(maya);
    const saved = await createAddress(
      maya,
      home(PLACES.faneuil, { notes: '<script>alert(1)</script>' }),
    );
    expect(saved.notes).toBe('<script>alert(1)</script>');
    await expect(
      createAddress(maya, home(PLACES.faneuil, { notes: 'line\nbreak' })),
    ).rejects.toThrow(/letters, numbers and punctuation/);
  });

  it('refuses malformed input and unknown fields', async () => {
    const maya = customer();
    await createUsers(maya);
    for (const input of [
      { ...home(), kind: 'OTHER' },
      { ...home(), label: 'x'.repeat(31), kind: 'OTHER' },
      { ...home(), notes: 'x'.repeat(201) },
      { ...home(), lat: 91 },
      { ...home(), lng: Number.NaN },
      { ...home(), userId: uuid() },
      { ...home(), isDefault: 'yes' },
    ]) {
      await expect(createAddress(maya, input)).rejects.toThrow(
        /invalid|expected|too big|too small|unrecognized|name|characters/i,
      );
    }
    expect((await getAddressBook(maya)).addresses).toHaveLength(0);
  });

  it('stores a named Other place', async () => {
    const maya = customer();
    await createUsers(maya);
    const saved = await createAddress(maya, { ...home(), kind: 'OTHER', label: "Mum's" });
    expect(saved).toMatchObject({ kind: 'OTHER', label: "Mum's" });
  });

  it('allows ten addresses and refuses the eleventh before checking anything else', async () => {
    const maya = customer();
    await createUsers(maya);
    for (let i = 0; i < 10; i++) {
      await createAddress(maya, home(PLACES.faneuil, { line2: `Unit ${i}` }));
    }
    const book = await getAddressBook(maya);
    expect(book).toMatchObject({ limit: 10, canAdd: false, canEdit: true });
    const refused = await errorOf(createAddress(maya, home(PLACES.quincy, { line2: 'Unit 11' })));
    expect(refused).toMatchObject({
      code: 'LIMIT_REACHED',
      message: 'You can save up to 10 addresses. Delete one to add another.',
    });
  });

  it('turns a double submit into one address', async () => {
    const maya = customer();
    await createUsers(maya);
    const [first, second] = await Promise.all([
      createAddress(maya, home()),
      createAddress(maya, home()),
    ]);
    expect(second.id).toBe(first.id);
    expect((await getAddressBook(maya)).addresses).toHaveLength(1);
  });

  it('keeps exactly one default when saves race', async () => {
    const maya = customer();
    await createUsers(maya);
    await Promise.all(
      ['A', 'B', 'C', 'D'].map((unit) =>
        createAddress(maya, home(PLACES.faneuil, { line2: unit, isDefault: true })),
      ),
    );
    const { addresses } = await getAddressBook(maya);
    expect(addresses).toHaveLength(4);
    expect(addresses.filter((a) => a.isDefault)).toHaveLength(1);
  });
});

describe('default address', () => {
  it('moves the default and picks the newest when the default is deleted', async () => {
    const maya = customer();
    await createUsers(maya);
    const homeAddress = await createAddress(maya, home());
    const work = await createAddress(maya, { ...home(PLACES.faneuil), kind: 'WORK' });
    const other = await createAddress(maya, {
      ...home(PLACES.edgeInside),
      kind: 'OTHER',
      label: 'Gym',
    });
    expect(homeAddress.isDefault).toBe(true);
    expect(work.isDefault).toBe(false);

    await setDefaultAddress(maya, { id: work.id });
    let book = await getAddressBook(maya);
    expect(book.addresses[0]).toMatchObject({ id: work.id, isDefault: true });
    expect(book.addresses.filter((a) => a.isDefault)).toHaveLength(1);

    // Unticking default on the default keeps it.
    await updateAddress(maya, {
      ...home(PLACES.faneuil),
      kind: 'WORK',
      id: work.id,
      isDefault: false,
    });
    expect((await getAddress(maya, work.id))?.isDefault).toBe(true);

    const result = await deleteAddress(maya, { id: work.id });
    expect(result).toEqual({ deletedId: work.id, newDefault: { id: other.id, label: 'Gym' } });
    book = await getAddressBook(maya);
    expect(book.addresses.map((a) => [a.id, a.isDefault])).toEqual([
      [other.id, true],
      [homeAddress.id, false],
    ]);
  });

  it('re-checks the area when an address moves', async () => {
    const maya = customer();
    await createUsers(maya);
    const saved = await createAddress(maya, home());
    await expect(
      updateAddress(maya, { ...home(PLACES.quincy), id: saved.id }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_DELIVERY_AREA' });
    const moved = await updateAddress(maya, { ...home(PLACES.faneuil), id: saved.id });
    expect(moved).toMatchObject({ line1: '1 Faneuil Hall Square', isDefault: true });
    const [point] = await migrator.$queryRaw<{ wkt: string }[]>`
      SELECT ST_AsText(location::geometry) AS wkt FROM addresses WHERE id = ${saved.id}::uuid`;
    expect(point?.wkt).toBe('POINT(-71.0548 42.36)');
  });

  it('flags saved addresses that fall outside after the radius shrinks (S4.13)', async () => {
    const maya = customer();
    await createUsers(maya);
    await createAddress(maya, home(PLACES.edgeInside));
    await migrator.siteSettings.update({ where: { id: 1 }, data: { deliveryRadiusKm: 5 } });
    try {
      const [address] = (await getAddressBook(maya)).addresses;
      expect(address).toMatchObject({ deliverable: false });
      expect(address?.distanceKm).toBeCloseTo(7.9, 1);
    } finally {
      await migrator.siteSettings.update({ where: { id: 1 }, data: { deliveryRadiusKm: 8 } });
    }
  });
});

describe('another person’s address (S4.14)', () => {
  it('answers not found and changes nothing', async () => {
    const maya = customer();
    const sam = customer();
    await createUsers(maya, sam);
    const mine = await createAddress(maya, home());

    expect(await getAddress(sam, mine.id)).toBeNull();
    expect(await getAddress(sam, uuid())).toBeNull();
    expect(await getAddress(sam, 'not-a-uuid')).toBeNull();
    for (const attempt of [
      () => updateAddress(sam, { ...home(PLACES.faneuil), id: mine.id }),
      () => setDefaultAddress(sam, { id: mine.id }),
      () => deleteAddress(sam, { id: mine.id }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Address not found.',
      });
    }
    expect(await getAddress(maya, mine.id)).toMatchObject({ line1: '12 Peterborough Street' });
  });

  it('is invisible and unchangeable through the database itself', async () => {
    const maya = customer();
    const sam = customer();
    await createUsers(maya, sam);
    const mine = await createAddress(maya, home());

    const result = await runAs(sam, async (ctx) => ({
      seen: await db(ctx).address.count({ where: { id: mine.id } }),
      updated: (await db(ctx).address.updateMany({ where: { id: mine.id }, data: { notes: 'x' } }))
        .count,
      deleted: (await db(ctx).address.deleteMany({ where: { id: mine.id } })).count,
    }));
    expect(result).toEqual({ seen: 0, updated: 0, deleted: 0 });

    await expect(
      runAs(sam, (ctx) =>
        db(ctx).address.create({
          data: {
            userId: maya.userId,
            label: 'Home',
            line1: 'x',
            city: 'y',
            lat: 42.35,
            lng: -71.05,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('demo customer (U2)', () => {
  it('can read and check, but never save', async () => {
    const dana = customer(true);
    await createUsers(dana);
    await runAsSystem('seed demo address', (ctx) =>
      db(ctx).address.create({
        data: {
          userId: dana.userId,
          kind: 'HOME',
          label: 'Home',
          isDefault: true,
          ...PLACES.peterborough,
        },
      }),
    );

    const book = await getAddressBook(dana);
    expect(book).toMatchObject({ canAdd: false, canEdit: false });
    expect(book.addresses).toHaveLength(1);
    await expect(
      checkDeliveryArea(dana, { lat: PLACES.quincy.lat, lng: PLACES.quincy.lng }),
    ).resolves.toMatchObject({ deliverable: false });

    const id = book.addresses[0]!.id;
    for (const attempt of [
      () => createAddress(dana, home(PLACES.faneuil)),
      () => updateAddress(dana, { ...home(PLACES.faneuil), id }),
      () => setDefaultAddress(dana, { id }),
      () => deleteAddress(dana, { id }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: 'DEMO_READ_ONLY',
        message: "Demo accounts can't change this.",
      });
    }

    // The database refuses too, whatever the service does.
    await expect(
      runAs(dana, (ctx) =>
        db(ctx).address.create({
          data: {
            userId: dana.userId,
            label: 'Home',
            line1: 'x',
            city: 'y',
            lat: 42.35,
            lng: -71.05,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    const blocked = await runAs(dana, async (ctx) => ({
      updated: (await db(ctx).address.updateMany({ where: { id }, data: { notes: 'mine now' } }))
        .count,
      deleted: (await db(ctx).address.deleteMany({ where: { id } })).count,
    }));
    expect(blocked).toEqual({ updated: 0, deleted: 0 });
  });
});

describe('delivery check (S4.6)', () => {
  it('decides on the server and words the answer', async () => {
    const maya = customer();
    await createUsers(maya);
    const { lat, lng } = PLACES.peterborough;
    await expect(checkDeliveryArea(maya, { lat, lng })).resolves.toMatchObject({
      deliverable: true,
      radiusKm: 8,
      storeStreet: '88 Harbor Street',
      message: 'We deliver here · about 4.3 km from our kitchen',
    });
    const outside = await checkDeliveryArea(maya, {
      lat: PLACES.quincy.lat,
      lng: PLACES.quincy.lng,
      line1: '1 Quincy Center Plaza',
    });
    expect(outside.deliverable).toBe(false);
    expect(outside.message).toMatch(
      /^Sorry, we don't deliver to 1 Quincy Center Plaza yet\. It's about 1\d\.\d km from our kitchen at 88 Harbor Street, and we deliver within 8 km\.$/,
    );
  });

  it('refuses coordinates that are not numbers on Earth', async () => {
    const maya = customer();
    for (const input of [
      { lat: 'x', lng: 1 },
      { lat: 1 },
      { lat: 100, lng: 0 },
      { lat: 0, lng: 181 },
    ]) {
      await expect(checkDeliveryArea(maya, input)).rejects.toThrow(
        /invalid|expected|too big|too small|unrecognized|name|characters/i,
      );
    }
  });
});

describe('address search', () => {
  it('asks Photon on its fixed host and returns US suggestions', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        features: [
          {
            geometry: { coordinates: [-71.0983681, 42.3434343] },
            properties: {
              osm_type: 'N',
              osm_id: 1,
              countrycode: 'US',
              housenumber: '12',
              street: 'Peterborough Street',
              city: 'Boston',
              state: 'Massachusetts',
              postcode: '02215',
            },
          },
        ],
      }),
    );
    const results = await searchAddresses(customer(), { query: '12 Peterborough' });
    expect(results).toEqual([
      expect.objectContaining({
        line1: '12 Peterborough Street',
        city: 'Boston, MA 02215',
        hasHouseNumber: true,
      }),
    ]);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url instanceof URL ? url.origin : '').toBe('https://photon.komoot.io');
  });

  it('says the search is unavailable when Photon fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    await expect(searchAddresses(customer(), { query: '12 Peterborough' })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: "We can't look up addresses right now. Please try again in a minute.",
    });
  });

  it('refuses a query that is too short', async () => {
    await expect(searchAddresses(customer(), { query: 'ab' })).rejects.toThrow(/at least 3/);
  });
});

describe('address actions', () => {
  it('refuse callers without a session and change nothing (S2.6)', async () => {
    switchBrowser(newBrowser());
    const { createAddressAction, listAddressesAction } =
      await import('@/server/modules/addresses/actions');
    expect((await listAddressesAction())?.serverError).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await createAddressAction(home()))?.serverError).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
