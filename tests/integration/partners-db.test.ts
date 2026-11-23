import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { db, prisma } from '@/server/db/client';
import { type Actor, runAs, runAsSystem } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';

/*
 * The F6 migration at the database level (contract §9): row-level security on partner rows and
 * their history, the guard trigger per role, the append-only history, the "no position while
 * offline" rule, the role-change functions and private uploads. Each refusal changes nothing.
 */

let migrator: PrismaClient;

const people = {
  ana: uuid(),
  priya: uuid(),
  diego: uuid(),
  victor: uuid(),
  kitchen: uuid(),
  editor: uuid(),
  support: uuid(),
  admin: uuid(),
  demoAdmin: uuid(),
  sample: uuid(),
};
const partner = { ana: uuid(), diego: uuid(), victor: uuid(), sample: uuid() };

const as = (userId: string, role: string, isDemo = false): Actor =>
  ({ kind: 'user', userId, role, isDemo }) as Actor;

const ana = () => as(people.ana, 'customer');
const priya = () => as(people.priya, 'customer');
const diego = () => as(people.diego, 'partner');
const victor = () => as(people.victor, 'partner');
const kitchen = () => as(people.kitchen, 'kitchen');
const editor = () => as(people.editor, 'content_editor');
const support = () => as(people.support, 'support');
const admin = () => as(people.admin, 'admin');
const demoAdmin = () => as(people.demoAdmin, 'admin', true);

const DENIED = /permission denied|row-level security|violates/i;

const visible = (actor: Actor) =>
  runAs(actor, (ctx) =>
    db(ctx).deliveryPartner.findMany({
      where: { id: { in: Object.values(partner) } },
      select: { id: true },
    }),
  );

const update = (actor: Actor, id: string, data: Record<string, unknown>) =>
  runAs(actor, (ctx) =>
    db(ctx).deliveryPartner.update({ where: { id }, data, select: { id: true } }),
  );

const event = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(),
  partnerId: partner.ana,
  type: 'approved',
  actorKind: 'staff',
  actorId: people.support,
  actorName: 'Morgan Diaz',
  actorRole: 'support',
  ...overrides,
});

const count = (actor: Actor) =>
  runAs(actor, (ctx) =>
    db(ctx).partnerApplicationEvent.count({ where: { partnerId: partner.ana } }),
  );

const promote = (actor: Actor) =>
  runAs(
    actor,
    (ctx) =>
      db(ctx).$queryRaw<{ ok: boolean }[]>`SELECT app_set_partner_role(${partner.ana}::uuid) AS ok`,
  );

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.user.createMany({
    data: [
      { id: people.ana, name: 'Ana Souza', email: `ana-${people.ana}@test.dev` },
      { id: people.priya, name: 'Priya Shah', email: `priya-${people.priya}@test.dev` },
      {
        id: people.diego,
        name: 'Diego Alvarez',
        email: `d-${people.diego}@test.dev`,
        role: 'partner',
      },
      {
        id: people.victor,
        name: 'Victor Hale',
        email: `v-${people.victor}@test.dev`,
        role: 'partner',
      },
      {
        id: people.kitchen,
        name: 'Alex Kim',
        email: `k-${people.kitchen}@test.dev`,
        role: 'kitchen',
      },
      {
        id: people.editor,
        name: 'Taylor',
        email: `e-${people.editor}@test.dev`,
        role: 'content_editor',
      },
      {
        id: people.support,
        name: 'Morgan Diaz',
        email: `s-${people.support}@test.dev`,
        role: 'support',
      },
      { id: people.admin, name: 'Foodz Admin', email: `a-${people.admin}@test.dev`, role: 'admin' },
      {
        id: people.demoAdmin,
        name: 'Demo',
        email: `da-${people.demoAdmin}@test.dev`,
        role: 'admin',
        isDemo: true,
      },
      {
        id: people.sample,
        name: 'Sam Sample',
        email: `sm-${people.sample}@test.dev`,
        isSample: true,
      },
    ],
  });
  await migrator.deliveryPartner.createMany({
    data: [
      {
        id: partner.ana,
        userId: people.ana,
        status: 'APPLIED',
        vehicleType: 'SCOOTER',
        vehiclePlate: '7KT 219',
        idNumberLast4: '4407',
        decisionReason: null,
        version: 1,
      },
      {
        id: partner.diego,
        userId: people.diego,
        status: 'APPROVED',
        vehicleType: 'MOTORBIKE',
        vehiclePlate: '2FD 881',
        version: 2,
      },
      {
        id: partner.victor,
        userId: people.victor,
        status: 'SUSPENDED',
        vehicleType: 'CAR',
        vehiclePlate: '6VH-450',
        version: 3,
      },
      {
        id: partner.sample,
        userId: people.sample,
        status: 'APPLIED',
        vehicleType: 'BICYCLE',
        version: 1,
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await migrator.$disconnect();
  await prisma.$disconnect();
});

describe('who reads a partner row (B2, A30.4)', () => {
  it('shows the applicant only their own row', async () => {
    expect(await visible(ana())).toEqual([{ id: partner.ana }]);
    expect(await visible(priya())).toEqual([]);
    expect(await visible(diego())).toEqual([{ id: partner.diego }]);
  });

  it('shows reviewers every row, and the kitchen, content editors and the demo admin none', async () => {
    expect((await visible(support())).length).toBe(4);
    expect((await visible(admin())).length).toBe(4);
    expect(await visible(kitchen())).toEqual([]);
    expect(await visible(editor())).toEqual([]);
    expect(await visible(demoAdmin())).toEqual([]);
  });

  it('gives the demo admin real people masked through the directory, samples in full', async () => {
    const rows = await runAs(
      demoAdmin(),
      (ctx) =>
        db(ctx).$queryRaw<
          {
            id: string;
            name: string;
            vehicle_plate: string | null;
            id_number_last4: string | null;
            masked: boolean;
          }[]
        >`
        SELECT id::text, name, vehicle_plate, id_number_last4, masked FROM partner_directory
        WHERE id IN (${partner.ana}::uuid, ${partner.sample}::uuid) ORDER BY name`,
    );
    expect(rows).toEqual([
      { id: partner.ana, name: 'A•••', vehicle_plate: '•••', id_number_last4: null, masked: true },
      {
        id: partner.sample,
        name: 'Sam Sample',
        vehicle_plate: null,
        id_number_last4: null,
        masked: false,
      },
    ]);
    const kitchenRows = await runAs(
      kitchen(),
      (ctx) => db(ctx).$queryRaw<unknown[]>`SELECT id FROM partner_directory`,
    );
    expect(kitchenRows).toEqual([]);
  });

  it('compares plates without spaces or hyphens', async () => {
    const row = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: partner.victor },
      select: { plateKey: true },
    });
    expect(row.plateKey).toBe('6VH450');
  });
});

describe('what may change in a partner row (guard trigger)', () => {
  it('refuses an applicant approving themselves or writing a decision', async () => {
    await expect(update(ana(), partner.ana, { status: 'APPROVED', version: 2 })).rejects.toThrow(
      DENIED,
    );
    await expect(update(ana(), partner.ana, { decisionReason: 'ok', version: 2 })).rejects.toThrow(
      DENIED,
    );
    await expect(update(ana(), partner.ana, { ratingAvg: 5 })).rejects.toThrow(DENIED);
  });

  it('lets an applicant edit the application while it waits', async () => {
    await update(ana(), partner.ana, { vehiclePlate: '7KT 220', editedAt: new Date(), version: 2 });
    await expect(
      update(ana(), partner.ana, { vehiclePlate: '7KT 219', version: 1 }),
    ).rejects.toThrow(DENIED);
  });

  it('lets an approved partner change only the online state, and a suspended one never go online', async () => {
    await runAs(
      diego(),
      (ctx) =>
        db(ctx).$executeRaw`UPDATE delivery_partners SET is_online = true, online_since = now(),
        last_location = ST_SetSRID(ST_MakePoint(-71.045, 42.3505), 4326)::geography
        WHERE id = ${partner.diego}::uuid`,
    );
    await expect(update(diego(), partner.diego, { vehiclePlate: 'X 1' })).rejects.toThrow(DENIED);
    await expect(update(diego(), partner.diego, { status: 'SUSPENDED' })).rejects.toThrow(DENIED);
    await expect(
      update(victor(), partner.victor, { isOnline: true, onlineSince: new Date() }),
    ).rejects.toThrow(DENIED);
  });

  it('keeps no position for an offline partner', async () => {
    await expect(
      migrator.$executeRaw`UPDATE delivery_partners SET is_online = false WHERE id = ${partner.diego}::uuid`,
    ).rejects.toThrow(/delivery_partners_no_position_offline/);
    await runAsSystem(
      'offline',
      (ctx) =>
        db(ctx).$executeRaw`UPDATE delivery_partners SET is_online = false, last_location = NULL,
        online_since = NULL WHERE id = ${partner.diego}::uuid`,
    );
  });

  it('lets SUPPORT suspend but only ADMIN reinstate, and reviewers never touch the application', async () => {
    await expect(
      update(support(), partner.victor, { status: 'APPROVED', version: 4 }),
    ).rejects.toThrow(DENIED);
    await expect(
      update(support(), partner.ana, { vehiclePlate: 'ZZ 1', version: 3 }),
    ).rejects.toThrow(DENIED);
    await expect(update(admin(), partner.ana, { status: 'APPROVED', version: 2 })).rejects.toThrow(
      DENIED,
    );
    await update(admin(), partner.victor, { status: 'APPROVED', suspendedAt: null, version: 4 });
    await update(support(), partner.victor, {
      status: 'SUSPENDED',
      suspendedAt: new Date(),
      version: 5,
    });
  });

  it('refuses the kitchen, content editors, other customers and the demo admin any change', async () => {
    for (const actor of [kitchen(), editor(), priya(), demoAdmin()]) {
      await expect(update(actor, partner.ana, { version: 9 })).rejects.toThrow(
        /not found|permission denied|row-level security/i,
      );
    }
    const row = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: partner.ana },
      select: { version: true },
    });
    expect(row.version).toBe(2);
  });

  it('lets an applicant withdraw only a waiting application', async () => {
    await expect(
      runAs(diego(), (ctx) => db(ctx).deliveryPartner.delete({ where: { id: partner.diego } })),
    ).rejects.toThrow(DENIED);
  });
});

describe('the application history (A31.1)', () => {
  it('takes staff decisions from staff and applicant entries from the applicant only', async () => {
    await runAs(support(), (ctx) => db(ctx).partnerApplicationEvent.createMany({ data: event() }));
    await runAs(ana(), (ctx) =>
      db(ctx).partnerApplicationEvent.createMany({
        data: event({
          type: 'updated',
          actorKind: 'applicant',
          actorId: people.ana,
          actorName: null,
          actorRole: null,
        }),
      }),
    );
    await expect(
      runAs(ana(), (ctx) =>
        db(ctx).partnerApplicationEvent.createMany({ data: event({ actorId: people.ana }) }),
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(priya(), (ctx) =>
        db(ctx).partnerApplicationEvent.createMany({
          data: event({ type: 'updated', actorKind: 'applicant', actorId: people.priya }),
        }),
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(demoAdmin(), (ctx) =>
        db(ctx).partnerApplicationEvent.createMany({ data: event({ actorId: people.demoAdmin }) }),
      ),
    ).rejects.toThrow(DENIED);
  });

  it('refuses every update and delete from the app', async () => {
    await expect(
      runAs(admin(), (ctx) =>
        db(ctx).partnerApplicationEvent.updateMany({ data: { staffNote: 'x' } }),
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAsSystem('try', (ctx) => db(ctx).partnerApplicationEvent.deleteMany({})),
    ).rejects.toThrow(DENIED);
  });

  it('shows the history to reviewers and to nobody else', async () => {
    expect(await count(support())).toBe(2);
    expect(await count(ana())).toBe(0);
    expect(await count(kitchen())).toBe(0);
  });
});

describe('role changes (B6, T12)', () => {
  it('lets only reviewers make an approved applicant a partner', async () => {
    for (const actor of [ana(), kitchen(), demoAdmin()]) {
      await expect(promote(actor)).rejects.toThrow(DENIED);
    }
    // Still APPLIED: nothing to promote.
    expect(await promote(support())).toEqual([{ ok: false }]);
  });

  it('refuses a role change from any request context', async () => {
    await expect(
      runAs(support(), (ctx) =>
        db(ctx).user.update({
          where: { id: people.priya },
          data: { role: 'admin' },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(priya(), (ctx) =>
        db(ctx).user.update({
          where: { id: people.priya },
          data: { role: 'partner' },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(DENIED);
    // Security gate S3: a signed-out request context is refused too.
    await expect(
      runAs({ kind: 'anonymous' }, (ctx) =>
        db(ctx).user.update({
          where: { id: people.priya },
          data: { role: 'admin' },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(DENIED);
  });
});

const gateUpload = async (ownerId: string, purpose: 'PARTNER_PHOTO' | 'PARTNER_DOCUMENT') => {
  const id = uuid();
  await migrator.upload.create({
    data: {
      id,
      key: `gate/${id}.webp`,
      bucket: 'PRIVATE',
      purpose,
      status: 'READY',
      ownerId,
      contentType: 'image/webp',
      sizeBytes: 10,
    },
  });
  return id;
};

describe('write-bug gaps closed at the database (security gate S1, S7)', () => {
  it("refuses an applicant linking someone else's upload, or one of the wrong purpose", async () => {
    const anas = await gateUpload(people.ana, 'PARTNER_PHOTO');
    await expect(
      runAs(priya(), (ctx) =>
        db(ctx).deliveryPartner.create({
          data: { userId: people.priya, vehicleType: 'BICYCLE', photoUploadId: anas, version: 1 },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(DENIED);
    const document = await gateUpload(people.ana, 'PARTNER_DOCUMENT');
    await expect(
      runAs(ana(), (ctx) =>
        db(ctx).deliveryPartner.update({
          where: { id: partner.ana },
          data: { photoUploadId: document, version: 3 },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(DENIED);
    const own = await gateUpload(people.ana, 'PARTNER_PHOTO');
    await runAs(ana(), (ctx) =>
      db(ctx).deliveryPartner.update({
        where: { id: partner.ana },
        data: { photoUploadId: own, version: 3 },
        select: { id: true },
      }),
    );
  });

  it('refuses an applicant history row carrying a staff name or note', async () => {
    await expect(
      runAs(ana(), (ctx) =>
        db(ctx).partnerApplicationEvent.createMany({
          data: event({
            type: 'updated',
            actorKind: 'applicant',
            actorId: people.ana,
            actorName: 'Morgan Diaz',
            actorRole: 'support',
            staffNote: 'Looks fine',
          }),
        }),
      ),
    ).rejects.toThrow(DENIED);
  });

  it('keeps the comparison keys of masked rows from demo staff, yet still reports the flag', async () => {
    const [row] = await runAs(
      demoAdmin(),
      (ctx) =>
        db(ctx).$queryRaw<{ plate_key: string | null; id_number_hash: string | null }[]>`
        SELECT plate_key, id_number_hash FROM partner_directory WHERE id = ${partner.ana}::uuid`,
    );
    expect(row).toEqual({ plate_key: null, id_number_hash: null });
    await migrator.deliveryPartner.update({
      where: { id: partner.sample },
      data: { vehiclePlate: '7kt-220' },
    });
    const matches = await runAs(
      demoAdmin(),
      (ctx) =>
        db(ctx).$queryRaw<{ id: string; same_plate: boolean }[]>`
        SELECT id::text, same_plate FROM app_partner_flag_matches(${partner.ana}::uuid)`,
    );
    expect(matches).toEqual([{ id: partner.sample, same_plate: true }]);
    const kitchenMatches = await runAs(
      kitchen(),
      (ctx) =>
        db(ctx).$queryRaw<unknown[]>`SELECT * FROM app_partner_flag_matches(${partner.ana}::uuid)`,
    );
    expect(kitchenMatches).toEqual([]);
  });
});

describe('private uploads (T4)', () => {
  it('are readable by their owner and the platform only', async () => {
    const id = uuid();
    await migrator.upload.create({
      data: {
        id,
        key: `partner-document/${id}.webp`,
        bucket: 'PRIVATE',
        purpose: 'PARTNER_DOCUMENT',
        status: 'READY',
        ownerId: people.ana,
        contentType: 'image/webp',
        sizeBytes: 10,
      },
    });
    const find = (actor: Actor) =>
      runAs(actor, (ctx) => db(ctx).upload.findUnique({ where: { id }, select: { id: true } }));
    expect(await find(ana())).toEqual({ id });
    for (const actor of [support(), admin(), demoAdmin(), priya()]) {
      expect(await find(actor)).toBeNull();
    }
  });
});

describe('the store date (reapply)', () => {
  it('is today in New York', async () => {
    const [row] = await runAs(
      ana(),
      (ctx) => db(ctx).$queryRaw<{ today: Date }[]>`SELECT app_store_today() AS today`,
    );
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      new Date(),
    );
    expect(row?.today.toISOString().slice(0, 10)).toBe(expected);
  });
});
