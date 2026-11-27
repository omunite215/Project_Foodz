import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { seedDatabase } from '../../prisma/seeding';
import { boardFixtureId, resetBoardFixtures } from '../../prisma/seeding/board';
import { asBrowser, nextHeaders } from './support/browser';
import { approvedPartner, readyOrder } from './support/dispatch';
import { type StaffMember, staffMember } from './support/staff';

/*
 * F9: the seeds reset a database that has real money on it. Browser runs and acceptance reseed
 * between sessions, after a courier has delivered a board fixture and staff have taken his cash
 * and paid him. Removing that order's entries and recomputing what is left would count the
 * hand-in against cash that no longer exists (holding below zero, partner_ledgers_counts).
 */

vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: async () => ({ ids: ['evt'] }) },
}));
vi.mock('@/server/realtime/pusher', () => ({
  publish: async () => undefined,
  signSubscription: () => undefined,
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const actions = await import('@/server/modules/earnings/actions');

// Its own admin, so the seed suite's first run still creates (and checks) its owner. No partner
// keys: the board reset runs before the partner fixtures, and the fixtures would stay behind
// for the suites after this one.
const config = {
  authSecret: 'integration-test-secret-integration-test-secret',
  adminEmail: 'reseed.owner@foodz.example',
  adminPassword: 'correct horse battery staple',
  demoPassword: 'demo-password-1',
  samplePassword: 'sample-password-1',
};

let migrator: PrismaClient;
let morgan: StaffMember;
let daniel: StaffMember;

const userIdOf = async (email: string) =>
  (await migrator.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;

const boardPeople = async () => ({
  priya: await userIdOf('second.customer@foodz.example'),
  dana: await userIdOf('demo.customer@foodz.example'),
  alex: await userIdOf('kitchen@foodz.example'),
  morgan: await userIdOf('support@foodz.example'),
});

/** Hands the order to the courier and delivers it; the delivery trigger writes his entries. */
async function deliver(orderId: string, partnerId: string) {
  await migrator.order.update({ where: { id: orderId }, data: { status: 'PICKED_UP' } });
  const delivery = await migrator.delivery.create({
    data: {
      orderId,
      status: 'PICKED_UP',
      partnerId,
      partnerFeeCents: 764,
      tipCents: 0,
      pool: 'REAL',
      assignedAt: new Date(),
      pickedUpAt: new Date(),
    },
    select: { id: true },
  });
  await migrator.$executeRaw`
    UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now(), handover_how = 'code'
    WHERE id = ${delivery.id}::uuid`;
}

async function dialog(member: StaffMember, partnerId: string, kind: 'cash' | 'payout') {
  const opened = await asBrowser(member.browser, () =>
    actions.openMoneyDialogAction({ partnerId, kind }),
  );
  if (!opened?.data?.applies) {
    throw new Error(`dialog refused: ${JSON.stringify(opened?.serverError ?? opened?.data)}`);
  }
  return opened.data;
}

function dollars(cents: number | null) {
  if (cents === null) throw new Error('the dialog offers no amount');
  return (cents / 100).toFixed(2);
}

/** The ledger row against the entries it summarises: what the reconcile compares. */
async function ledgerAgrees(partnerId: string) {
  const [row] = await migrator.$queryRaw<{ agrees: boolean; holding: bigint | null }[]>`
    SELECT l.holding_cents AS holding,
           coalesce(l.version, 0) = coalesce(s.n, 0)
             AND coalesce(l.balance_cents, 0) = coalesce(s.bal, 0)
             AND coalesce(l.holding_cents, 0) = coalesce(s.hold, 0) AS agrees
    FROM (SELECT ${partnerId}::uuid AS partner_id) p
    LEFT JOIN partner_ledgers l ON l.partner_id = p.partner_id
    LEFT JOIN (
      SELECT partner_id, count(*)::int AS n, sum(amount_cents) AS bal,
             -sum(CASE WHEN type IN ('CASH_COLLECTED', 'CASH_HANDED_IN') THEN amount_cents ELSE 0 END) AS hold
      FROM partner_earnings GROUP BY partner_id
    ) s ON s.partner_id = p.partner_id`;
  return row;
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await seedDatabase(migrator, config);
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  daniel = await staffMember(migrator, 'admin', { name: 'Daniel Park', sample: true });
}, 180_000);

afterAll(async () => {
  await migrator.$disconnect();
});

describe('reseeding after real payouts and cash hand-ins', () => {
  it('resets the board and the seed when a courier delivered a fixture and was then settled', async () => {
    const luis = (await approvedPartner(migrator, 'Luis Reseed')).partnerId;
    const diego = (await approvedPartner(migrator, 'Diego Reseed')).partnerId;
    const s1106 = boardFixtureId('S1106');

    // Luis delivers the board's cash order S1106; Diego delivers an order outside the fixtures.
    await deliver(s1106, luis);
    const other = await readyOrder(migrator, await userIdOf('second.customer@foodz.example'));
    await deliver(other.id, diego);

    const cash = await dialog(morgan, luis, 'cash');
    const handIn = await asBrowser(morgan.browser, () =>
      actions.recordCashHandInAction({
        partnerId: luis,
        amount: dollars(cash.maxAmountCents),
        note: 'At the counter',
        expectedVersion: cash.version,
        idempotencyKey: cash.idempotencyKey,
      }),
    );
    expect(handIn?.data).toMatchObject({ kind: 'CASH_HANDED_IN', holdingCents: 0 });
    const payout = await dialog(daniel, luis, 'payout');
    const paid = await asBrowser(daniel.browser, () =>
      actions.recordPayoutAction({
        partnerId: luis,
        amount: dollars(payout.defaultAmountCents),
        method: 'bank-transfer',
        reference: 'Transfer 88213',
        paidOn: new Date().toISOString().slice(0, 10),
        expectedVersion: payout.version,
        idempotencyKey: payout.idempotencyKey,
      }),
    );
    expect(paid?.data).toMatchObject({ kind: 'PAYOUT', balanceCents: 0 });
    const diegoBefore = await migrator.partnerEarning.count({ where: { partnerId: diego } });
    expect(diegoBefore).toBeGreaterThan(0);

    // seed:board: S1106 comes back, and with it goes the history the hand-in and payout
    // were counted against, so Luis's ledger starts again rather than going below zero.
    const people = await boardPeople();
    await migrator.$transaction((tx) => resetBoardFixtures(tx, people, new Date()), {
      timeout: 30_000,
    });
    expect(
      await migrator.order.findUniqueOrThrow({
        where: { id: s1106 },
        select: { status: true, delivery: { select: { id: true } } },
      }),
    ).toEqual({ status: 'READY', delivery: null });
    expect(await migrator.partnerEarning.count({ where: { partnerId: luis } })).toBe(0);
    expect(await ledgerAgrees(luis)).toEqual({ agrees: true, holding: null });
    // A courier who never touched a fixture keeps his ledger.
    expect(await migrator.partnerEarning.count({ where: { partnerId: diego } })).toBe(diegoBefore);
    expect((await ledgerAgrees(diego))?.agrees).toBe(true);

    // The same again through the whole seed, which resets the board on every run.
    await deliver(s1106, luis);
    const again = await dialog(morgan, luis, 'cash');
    expect(
      (
        await asBrowser(morgan.browser, () =>
          actions.recordCashHandInAction({
            partnerId: luis,
            amount: dollars(again.maxAmountCents),
            note: 'At the counter',
            expectedVersion: again.version,
            idempotencyKey: again.idempotencyKey,
          }),
        )
      )?.data,
    ).toMatchObject({ kind: 'CASH_HANDED_IN', holdingCents: 0 });
    await seedDatabase(migrator, config);
    expect(await ledgerAgrees(luis)).toEqual({ agrees: true, holding: null });
    expect(
      (await migrator.order.findUniqueOrThrow({ where: { id: s1106 }, select: { status: true } }))
        .status,
    ).toBe('READY');
  }, 180_000);
});
