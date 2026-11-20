import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { UserActor } from '@/server/auth/session';
import { db, prisma } from '@/server/db/client';
import { runAs, runAsSystem } from '@/server/db/context';
import { type Prisma, PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { getPersonForStaff, updateProfile } from '@/server/modules/account/service';
import { listAddressesForStaff } from '@/server/modules/addresses/service';
import { newBrowser, requestHeaders, switchBrowser } from './support/browser';

// U4: real sign-ups' personal details are masked for any demo login, in the database itself.
// Demo accounts and seeded sample people are shown in full.

// This file imports server code statically, so the mocks load the harness themselves.
vi.mock('next/headers', async () => (await import('./support/browser')).nextHeaders);
vi.mock('next/headers.js', async () => (await import('./support/browser')).nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: async () => ({ ids: ['evt'] }) },
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const actor = (role: UserActor['role'], isDemo: boolean, userId = uuid()): UserActor => ({
  kind: 'user',
  userId,
  role,
  isDemo,
});

const realAdmin = actor('admin', false);
const demoAdmin = actor('admin', true);
const demoCustomer = actor('customer', true);
const kitchen = actor('kitchen', false);
const realCustomer = {
  id: uuid(),
  name: 'Maya Lopez',
  email: `maya-${uuid()}@example.com`,
  phone: '+16175550142',
};
const sampleCustomer = {
  id: uuid(),
  name: 'Priya Shah',
  email: `sample-${uuid()}@foodz.example`,
  phone: '+16175550177',
};

let migrator: PrismaClient;

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  // Only the table owner (the seed) can mark demo accounts and sample data.
  const seeded: Prisma.UserCreateManyInput[] = [
    { ...sampleCustomer, isSample: true },
    {
      id: demoCustomer.userId,
      name: 'Dana Customer',
      email: `dana-${uuid()}@foodz.example`,
      phone: '+16175550199',
      isDemo: true,
    },
    {
      id: demoAdmin.userId,
      name: 'Demo Admin',
      email: `demo-admin-${uuid()}@foodz.example`,
      role: 'admin',
      isDemo: true,
    },
  ];
  await migrator.user.createMany({ data: seeded });
  await migrator.address.create({
    data: {
      userId: sampleCustomer.id,
      kind: 'WORK',
      label: 'Work',
      line1: '1 Faneuil Hall Square',
      city: 'Boston, MA 02109',
      lat: 42.36,
      lng: -71.0548,
      isDefault: true,
    },
  });
  await runAsSystem('masking setup', async (ctx) => {
    // The app role may insert a person with both flags false.
    await db(ctx).user.createMany({ data: [{ ...realCustomer, isDemo: false }] });
    await db(ctx).address.createMany({
      data: [
        {
          userId: realCustomer.id,
          kind: 'HOME',
          label: 'Home',
          line1: '12 Peterborough Street',
          line2: 'Apt 3',
          city: 'Boston, MA 02215',
          notes: 'Buzzer 3',
          lat: 42.346712,
          lng: -71.097234,
          isDefault: true,
        },
        {
          userId: realCustomer.id,
          kind: 'OTHER',
          label: "Mum's place",
          line1: '1 Faneuil Hall Square',
          city: 'Boston, MA 02109',
          lat: 42.36,
          lng: -71.0548,
        },
        {
          userId: demoCustomer.userId,
          kind: 'HOME',
          label: 'Home',
          line1: '5 Demo Street',
          city: 'Boston, MA 02210',
          lat: 42.35,
          lng: -71.05,
          isDefault: true,
        },
      ],
    });
  });
});

afterAll(async () => {
  await migrator.$disconnect();
  await prisma.$disconnect();
  await redis.quit();
});

describe('people as staff see them', () => {
  it('shows a real admin everything', async () => {
    expect(await getPersonForStaff(realAdmin, realCustomer.id)).toMatchObject({
      name: 'Maya Lopez',
      email: realCustomer.email,
      phone: '+16175550142',
      masked: false,
    });
  });

  it('masks a real customer for the demo admin, but not demo accounts', async () => {
    expect(await getPersonForStaff(demoAdmin, realCustomer.id)).toMatchObject({
      name: 'M•••',
      email: 'm•••@•••',
      phone: '•••42',
      role: 'customer',
      isDemo: false,
      masked: true,
    });
    expect(await getPersonForStaff(demoAdmin, demoCustomer.userId)).toMatchObject({
      name: 'Dana Customer',
      phone: '+16175550199',
      masked: false,
    });
    expect(await getPersonForStaff(demoAdmin, demoAdmin.userId)).toMatchObject({
      name: 'Demo Admin',
      masked: false,
    });
  });

  it('is refused to roles without user access', async () => {
    await expect(getPersonForStaff(kitchen, realCustomer.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(getPersonForStaff(demoCustomer, realCustomer.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('addresses as staff see them', () => {
  it('masks a real customer’s addresses for the demo admin', async () => {
    const rows = await listAddressesForStaff(demoAdmin, realCustomer.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      label: 'Home',
      line1: '•••',
      line2: '•••',
      city: '•••',
      notes: '•••',
      lat: 42.35,
      lng: -71.1,
      masked: true,
    });
    expect(rows[1]).toMatchObject({ kind: 'OTHER', label: 'Other', line2: null, masked: true });
  });

  it('shows the real admin and demo addresses in full', async () => {
    expect((await listAddressesForStaff(realAdmin, realCustomer.id))[0]).toMatchObject({
      line1: '12 Peterborough Street',
      lat: 42.346712,
      masked: false,
    });
    expect((await listAddressesForStaff(demoAdmin, demoCustomer.userId))[0]).toMatchObject({
      line1: '5 Demo Street',
      masked: false,
    });
  });
});

describe('the base tables for demo logins', () => {
  it('hide real people from the demo admin, so a repository cannot leak them by mistake', async () => {
    const seen = await runAs(demoAdmin, async (ctx) => ({
      user: await db(ctx).user.findUnique({
        where: { id: realCustomer.id },
        select: { email: true },
      }),
      addresses: await db(ctx).address.count({ where: { userId: realCustomer.id } }),
      demoAddresses: await db(ctx).address.count({ where: { userId: demoCustomer.userId } }),
      demoUser: await db(ctx).user.findUnique({
        where: { id: demoCustomer.userId },
        select: { name: true },
      }),
    }));
    expect(seen).toEqual({
      user: null,
      addresses: 0,
      demoAddresses: 1,
      demoUser: { name: 'Dana Customer' },
    });
  });

  it('let the demo customer see only itself and other demo accounts', async () => {
    const seen = await runAs(demoCustomer, (ctx) =>
      db(ctx).user.findMany({
        where: { id: { in: [realCustomer.id, demoCustomer.userId] } },
        select: { id: true },
      }),
    );
    expect(seen).toEqual([{ id: demoCustomer.userId }]);
  });

  it('refuse a demo login changing anyone else', async () => {
    const changed = await runAs(
      demoAdmin,
      async (ctx) =>
        (await db(ctx).user.updateMany({ where: { id: realCustomer.id }, data: { name: 'x' } }))
          .count,
    );
    expect(changed).toBe(0);
  });

  it('leave everyone else unaffected, including the sign-in library outside any actor', async () => {
    const asAdmin = await runAs(realAdmin, (ctx) =>
      db(ctx).user.findUnique({ where: { id: realCustomer.id }, select: { email: true } }),
    );
    expect(asAdmin?.email).toBe(realCustomer.email);
    const direct = await prisma.user.findUnique({
      where: { id: realCustomer.id },
      select: { email: true },
    });
    expect(direct?.email).toBe(realCustomer.email);
  });

  it('give the staff views nothing to roles that may not see people', async () => {
    const rows = await runAs(
      kitchen,
      (ctx) =>
        db(ctx).$queryRaw<
          { id: string }[]
        >`SELECT id::text AS id FROM user_directory WHERE id = ${realCustomer.id}::uuid`,
    );
    expect(rows).toEqual([]);
  });

  it('cannot be written through', async () => {
    await expect(
      runAs(
        realAdmin,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE address_directory SET line1 = 'x' WHERE user_id = ${realCustomer.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied|cannot update/i);
  });
});

describe('seeded sample people (isSample)', () => {
  it('are shown in full to the demo admin, while a real sign-up stays masked', async () => {
    expect(await getPersonForStaff(demoAdmin, sampleCustomer.id)).toMatchObject({
      name: 'Priya Shah',
      email: sampleCustomer.email,
      phone: '+16175550177',
      isSample: true,
      masked: false,
    });
    expect(await getPersonForStaff(demoAdmin, realCustomer.id)).toMatchObject({
      name: 'M•••',
      isSample: false,
      masked: true,
    });
    expect((await listAddressesForStaff(demoAdmin, sampleCustomer.id))[0]).toMatchObject({
      line1: '1 Faneuil Hall Square',
      lat: 42.36,
      masked: false,
    });
  });

  it('are visible to demo logins in the base tables', async () => {
    const seen = await runAs(demoAdmin, async (ctx) => ({
      user: await db(ctx).user.findUnique({
        where: { id: sampleCustomer.id },
        select: { name: true },
      }),
      addresses: await db(ctx).address.count({ where: { userId: sampleCustomer.id } }),
    }));
    expect(seen).toEqual({ user: { name: 'Priya Shah' }, addresses: 1 });
  });

  it('cannot be marked or unmarked by the app role, which still writes everything else', async () => {
    await expect(
      runAsSystem('mark sample', (ctx) =>
        db(ctx).user.update({ where: { id: realCustomer.id }, data: { isSample: true } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runAsSystem('unmark sample', (ctx) =>
        db(ctx).user.update({ where: { id: sampleCustomer.id }, data: { isSample: false } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runAsSystem('create sample', (ctx) =>
        db(ctx).user.create({
          data: { id: uuid(), name: 'Fake', email: `fake-${uuid()}@example.com`, isSample: true },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);

    await runAsSystem('rename', (ctx) =>
      db(ctx).user.update({ where: { id: sampleCustomer.id }, data: { name: 'Priya S.' } }),
    );
    const after = await migrator.user.findUniqueOrThrow({
      where: { id: sampleCustomer.id },
      select: { name: true, isSample: true },
    });
    expect(after).toEqual({ name: 'Priya S.', isSample: true });
    const real = await migrator.user.findUniqueOrThrow({
      where: { id: realCustomer.id },
      select: { isSample: true },
    });
    expect(real.isSample).toBe(false);
  });

  it('cannot be set by a sign-up or a profile update', async () => {
    const { auth } = await import('@/server/auth');
    const { signUpAction } = await import('@/server/modules/auth/actions');
    const { updateProfileAction } = await import('@/server/modules/account/actions');

    // Through the action: refused by the strict input schema.
    switchBrowser(newBrowser());
    const viaAction = await signUpAction({
      name: 'Mallory',
      email: `mallory-${uuid()}@example.com`,
      password: 'correct horse battery',
      captchaToken: 'ok',
      isSample: true,
    } as never);
    expect(viaAction?.validationErrors).toBeDefined();

    // Straight at the sign-in library: the field is not one it accepts.
    const browser = switchBrowser(newBrowser());
    const email = `mallory-${uuid()}@example.com`;
    await auth.api
      .signUpEmail({
        body: {
          name: 'Mallory',
          email,
          password: 'correct horse battery',
          isSample: true,
        } as never,
        headers: requestHeaders(browser),
      })
      .catch(() => null);
    const created = await migrator.user.findUnique({
      where: { email },
      select: { id: true, isSample: true },
    });
    expect(created?.isSample ?? false).toBe(false);

    // A profile update, through the service and the action, by a signed-in customer.
    const customerBrowser = switchBrowser(newBrowser());
    const customerEmail = `customer-${uuid()}@example.com`;
    await auth.api.signUpEmail({
      body: { name: 'Casey', email: customerEmail, password: 'correct horse battery' },
      headers: requestHeaders(customerBrowser),
    });
    const customer = await migrator.user.findUniqueOrThrow({
      where: { email: customerEmail },
      select: { id: true },
    });
    const self: UserActor = { kind: 'user', userId: customer.id, role: 'customer', isDemo: false };
    await expect(updateProfile(self, { name: 'Casey', isSample: true })).rejects.toThrow(
      /unrecognized key/i,
    );
    const viaProfile = await updateProfileAction({ name: 'Casey', isSample: true } as never);
    expect(viaProfile?.validationErrors).toBeDefined();
    const after = await migrator.user.findUniqueOrThrow({
      where: { id: customer.id },
      select: { isSample: true },
    });
    expect(after.isSample).toBe(false);
  });
});

describe('demo accounts (isDemo) are flagged by the seed only', () => {
  it('cannot be created by the app role', async () => {
    await expect(
      runAsSystem('create demo', (ctx) =>
        db(ctx).user.create({
          data: {
            id: uuid(),
            name: 'Fake demo',
            email: `fake-demo-${uuid()}@example.com`,
            isDemo: true,
          },
        }),
      ),
    ).rejects.toThrow(/42501/);
    await expect(
      runAsSystem('create demo in bulk', (ctx) =>
        db(ctx).user.createMany({
          data: [
            {
              id: uuid(),
              name: 'Fake demo',
              email: `fake-demo-${uuid()}@example.com`,
              isDemo: true,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/42501/);
  });

  it('cannot be turned on for a real person, or off for a demo account, by the app role', async () => {
    await expect(
      runAsSystem('make demo', (ctx) =>
        db(ctx).user.update({ where: { id: realCustomer.id }, data: { isDemo: true } }),
      ),
    ).rejects.toThrow(/42501/);
    await expect(
      runAsSystem('unmake demo', (ctx) =>
        db(ctx).user.update({ where: { id: demoCustomer.userId }, data: { isDemo: false } }),
      ),
    ).rejects.toThrow(/42501/);
    await expect(
      runAs(demoCustomer, (ctx) =>
        db(ctx).user.update({ where: { id: demoCustomer.userId }, data: { isDemo: false } }),
      ),
    ).rejects.toThrow(/42501/);

    const flags = await migrator.user.findMany({
      where: { id: { in: [realCustomer.id, demoCustomer.userId] } },
      select: { id: true, isDemo: true },
    });
    expect(Object.fromEntries(flags.map((row) => [row.id, row.isDemo]))).toEqual({
      [realCustomer.id]: false,
      [demoCustomer.userId]: true,
    });
  });

  it('still lets the app role write everything else about a demo account', async () => {
    await runAsSystem('demo sign-in bookkeeping', (ctx) =>
      db(ctx).user.update({
        where: { id: demoCustomer.userId },
        data: { emailVerified: true, isDemo: true, updatedAt: new Date() },
      }),
    );
    expect(
      (
        await migrator.user.findUniqueOrThrow({
          where: { id: demoCustomer.userId },
          select: { isDemo: true },
        })
      ).isDemo,
    ).toBe(true);
  });

  it('leave sign-up working: Better Auth writes is_demo = false', async () => {
    const { auth } = await import('@/server/auth');
    const browser = switchBrowser(newBrowser());
    const email = `new-${uuid()}@example.com`;
    const result = await auth.api.signUpEmail({
      body: { name: 'New Customer', email, password: 'correct horse battery' },
      headers: requestHeaders(browser),
    });
    expect(result.user.email).toBe(email);
    expect(
      await migrator.user.findUniqueOrThrow({
        where: { email },
        select: { isDemo: true, isSample: true },
      }),
    ).toEqual({ isDemo: false, isSample: false });
  });

  it('leave the table owner (migrations and the seed) free to set and clear them', async () => {
    const id = uuid();
    await migrator.user.create({
      data: { id, name: 'Seeded demo', email: `seeded-${id}@foodz.example`, isDemo: true },
    });
    await migrator.user.update({ where: { id }, data: { isDemo: false, isSample: true } });
    expect(
      await migrator.user.findUniqueOrThrow({
        where: { id },
        select: { isDemo: true, isSample: true },
      }),
    ).toEqual({ isDemo: false, isSample: true });
  });
});
