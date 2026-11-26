import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { seedCatalog } from '../../prisma/seeding';
import { asBrowser, nextHeaders, switchBrowser } from './support/browser';
import {
  approvedPartner,
  customerAccount,
  quietDispatch,
  readyOrder,
  type TestPartner,
} from './support/dispatch';
import { signedInAgo, type StaffMember, staffMember } from './support/staff';

/*
 * F9's earnings services against the real database (contract §2–§5): the partner's figures and
 * his own goal, the three staff money actions with their roles, step-up, replays and conflict
 * words, the partner page, the report and both CSVs, the demo admin's masking, every figure
 * agreeing to the cent over 10,000 random entries (E4.2), and the report's speed at 500
 * partners with a year of days (A63.6).
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
  publish: vi.fn<(channel: string, event: string, data: unknown) => Promise<void>>(
    async () => undefined,
  ),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/realtime/pusher', () => ({
  publish: mocks.publish,
  signSubscription: vi.fn<() => void>(),
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const earnings = await import('@/server/modules/earnings/service');
const actions = await import('@/server/modules/earnings/actions');
const reportRoute = await import('@/app/admin/partners/earnings/export/route');
const entriesRoute = await import('@/app/admin/partners/[id]/earnings/export/route');

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3456';

let migrator: PrismaClient;
let morgan: StaffMember;
let daniel: StaffMember;
let alex: StaffMember;
let demoAdmin: StaffMember;
let luis: TestPartner;
let grace: TestPartner;
let victor: TestPartner;
let riley: TestPartner;
let jamie: TestPartner;
let priya: Awaited<ReturnType<typeof customerAccount>>;
let cashDelivery: string;

const published = (event: string) =>
  mocks.publish.mock.calls.filter(([, name]) => name === event).map(([channel]) => channel);

async function delivered(
  partner: TestPartner,
  options: { cash?: boolean; pool?: 'REAL' | 'DEMO' } = {},
) {
  const order = await readyOrder(migrator, priya.userId, { cash: options.cash ?? false });
  await migrator.order.update({ where: { id: order.id }, data: { status: 'PICKED_UP' } });
  const delivery = await migrator.delivery.create({
    data: {
      orderId: order.id,
      status: 'PICKED_UP',
      partnerId: partner.partnerId,
      partnerFeeCents: 764,
      tipCents: 500,
      pool: options.pool ?? 'REAL',
      assignedAt: new Date(),
      pickedUpAt: new Date(),
    },
    select: { id: true },
  });
  await migrator.$executeRaw`
    UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now(), handover_how = 'code'
    WHERE id = ${delivery.id}::uuid`;
  return { orderId: order.id, number: order.number, deliveryId: delivery.id };
}

async function dialog(member: StaffMember, partnerId: string, kind: 'cash' | 'adjust' | 'payout') {
  const opened = await asBrowser(member.browser, () =>
    actions.openMoneyDialogAction({ partnerId, kind }),
  );
  if (!opened?.data) throw new Error(`dialog refused: ${JSON.stringify(opened?.serverError)}`);
  return opened.data;
}

const csvRequest = (path: string, body: unknown, origin: string | null = SITE, method = 'POST') =>
  new Request(`${SITE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  daniel = await staffMember(migrator, 'admin', { name: 'Daniel Park', sample: true });
  alex = await staffMember(migrator, 'kitchen', { name: 'Alex Kim', sample: true });
  demoAdmin = await staffMember(migrator, 'admin', { name: 'Demo Admin', demo: true });
  luis = await approvedPartner(migrator, 'Luis Moreno');
  grace = await approvedPartner(migrator, 'Grace Okafor', { vehicle: 'BICYCLE', plate: null });
  victor = await approvedPartner(migrator, 'Victor Hale');
  riley = await approvedPartner(migrator, 'Riley Courier', { demo: true });
  jamie = await approvedPartner(migrator, 'Jamie Courier', { demo: true });
  priya = await customerAccount(migrator, 'Priya Shah');
  cashDelivery = (await delivered(luis, { cash: true })).deliveryId;
  await delivered(luis);
  await delivered(victor);
  await migrator.deliveryPartner.update({
    where: { id: victor.partnerId },
    data: { status: 'SUSPENDED' },
  });
  await delivered(jamie, { pool: 'DEMO' });
}, 180_000);

beforeEach(async () => {
  await quietDispatch(migrator);
  mocks.send.mockClear();
  mocks.publish.mockClear();
});

afterAll(async () => {
  await migrator.$disconnect();
});

describe("the partner's earnings (P52–P61)", () => {
  it('shows today, the week and the cash card from the same entries', async () => {
    const summary = await earnings.getEarningsSummary(luis.actor);
    expect(summary).toMatchObject({
      practice: false,
      readOnly: false,
      today: { earnedCents: 1_528, deliveries: 2, tipsCents: 1_000, goalCents: null },
      week: {
        earnedCents: 1_528,
        deliveries: 2,
        tipsCents: 1_000,
        isCurrent: true,
        isFirstWeek: true,
      },
      cash: {
        state: 'handIn',
        balanceCents: 1_528 - 5_897,
        holdingCents: 5_897,
        breakdown: {
          from: 'firstDelivery',
          earnedCents: 1_528,
          cashCollectedCents: 5_897,
          resultCents: -4_369,
        },
      },
    });
    expect(summary.week.days.filter((day) => day.state === 'today')).toHaveLength(1);

    const week = await earnings.getEarningsWeek(luis.actor, { weekStart: summary.week.start });
    expect(week.groups).toHaveLength(1);
    expect(week.groups[0]!.rows.map((row) => [row.kind, row.amountCents, row.cashCents])).toEqual(
      expect.arrayContaining([
        ['delivery', 764, 5_897],
        ['delivery', 764, null],
      ]),
    );
    await expect(
      earnings.getEarningsWeek(luis.actor, { weekStart: '2026-11-17' }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    const detail = await earnings.getEarningsDelivery(luis.actor, { deliveryId: cashDelivery });
    expect(detail).toMatchObject({
      feeCents: 264,
      tipCents: 500,
      tipPaid: true,
      totalCents: 764,
      cashCents: 5_897,
      how: 'code',
      areaWords: 'Boston 02109',
    });
    expect(detail.steps.map((step) => step.kind)).toEqual(['accepted', 'pickedUp', 'delivered']);
    expect(JSON.stringify(detail)).not.toMatch(/Faneuil|Priya|5550101/);
    await expect(
      earnings.getEarningsDelivery(grace.actor, { deliveryId: cashDelivery }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(earnings.getEarningsSummary(priya.actor)).rejects.toMatchObject({
      code: 'NOT_APPROVED',
    });
  });

  it("keeps his own goal, dates reaching it, and refuses a suspended partner's or the demo's", async () => {
    expect(await earnings.setEarningsGoal(luis.actor, { cents: 1_000 })).toEqual({
      goalCents: 1_000,
    });
    expect(published('earnings.changed')).toEqual([`private-partner-${luis.partnerId}`]);
    const summary = await earnings.getEarningsSummary(luis.actor);
    expect(summary.today.goalCents).toBe(1_000);
    expect(summary.today.goalReachedAt).not.toBeNull();
    await expect(earnings.setEarningsGoal(luis.actor, { cents: 1_050 })).rejects.toThrow(
      'Enter whole dollars from $10 to $1,000.',
    );
    await expect(earnings.setEarningsGoal(victor.actor, { cents: 4_000 })).rejects.toMatchObject({
      code: 'PARTNER_SUSPENDED',
    });
    await expect(earnings.setEarningsGoal(riley.actor, { cents: 4_000 })).rejects.toMatchObject({
      code: 'DEMO_READ_ONLY',
    });
    await earnings.setEarningsGoal(luis.actor, { cents: null });
  });

  it('shows a suspended partner his earnings read-only, and the demo partner a practice week', async () => {
    const suspended = await earnings.getEarningsSummary(victor.actor);
    expect(suspended).toMatchObject({ readOnly: true, today: { goalCents: null, deliveries: 1 } });
    const practice = await earnings.getEarningsSummary(riley.actor);
    expect(practice).toMatchObject({
      practice: true,
      today: { deliveries: 4, earnedCents: 2_780 },
      cash: { state: 'owesYou' },
    });
    const week = await earnings.getEarningsWeek(riley.actor, { weekStart: practice.week.start });
    expect(week.groups[0]!.rows[0]).toMatchObject({ areaWords: 'Boston 02116' });
    expect(
      week.groups.flatMap((group) => group.rows).every((row) => row.orderNumber?.startsWith('D-')),
    ).toBe(true);
  });
});

describe('recording cash handed in (A60, A67)', () => {
  it('records once with a key, tells the partner without a name, audits, and words a stale version', async () => {
    const opened = await dialog(morgan, luis.partnerId, 'cash');
    expect(opened).toMatchObject({
      applies: true,
      defaultAmountCents: 4_369,
      maxAmountCents: 5_897,
      stepUpRequired: false,
    });
    const send = (key: string, version: number, amount = '43.69') =>
      asBrowser(morgan.browser, () =>
        actions.recordCashHandInAction({
          partnerId: luis.partnerId,
          amount,
          note: 'At the counter',
          expectedVersion: version,
          idempotencyKey: key,
        }),
      );
    const first = await send(opened.idempotencyKey, opened.version);
    expect(first?.data).toMatchObject({
      kind: 'CASH_HANDED_IN',
      amountCents: 4_369,
      balanceCents: 0,
      holdingCents: 1_528,
      replayed: false,
      boardNotice: 'Recorded $43.69 in cash from Luis M.',
    });
    expect((await send(opened.idempotencyKey, opened.version))?.data).toMatchObject({
      replayed: true,
    });
    expect(
      await migrator.partnerEarning.count({
        where: { partnerId: luis.partnerId, type: 'CASH_HANDED_IN' },
      }),
    ).toBe(1);
    const stale = await send(uuid(), opened.version, '1.00');
    expect(stale?.serverError).toMatchObject({
      code: 'LEDGER_CHANGED',
      details: { closeOnly: false },
    });
    expect(stale?.serverError?.message).toMatch(
      /^The figures changed after you opened this: Morgan Diaz recorded \$43\.69 in cash from Luis at /,
    );
    expect((await send(uuid(), opened.version + 1, '15.29'))?.serverError).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { amount: ['Luis is holding $15.28, so enter $15.28 or less.'] },
    });

    const audit = await migrator.auditLog.findFirstOrThrow({
      where: { action: 'earnings.cash-recorded', targetId: luis.partnerId },
      select: { actorId: true, data: true },
    });
    expect(audit).toMatchObject({
      actorId: morgan.userId,
      data: expect.objectContaining({ amountCents: 4_369, hasNote: true }),
    });
    const notice = await migrator.notification.findFirstOrThrow({
      where: { userId: luis.userId, type: 'earnings.cash-recorded' },
    });
    expect(notice).toMatchObject({
      title: 'Foodz recorded $43.69 in cash from you.',
      body: 'Your balance is updated in Earnings.',
    });
    expect(JSON.stringify(notice)).not.toContain('Morgan');
    expect(published('earnings.changed')).toContain(`private-partner-${luis.partnerId}`);
  });

  it('refuses KITCHEN, the demo admin, and SUPPORT adjusting or paying out', async () => {
    const body = {
      partnerId: luis.partnerId,
      amount: '1.00',
      expectedVersion: 0,
      idempotencyKey: uuid(),
    };
    expect(
      (await asBrowser(alex.browser, () => actions.recordCashHandInAction(body)))?.serverError
        ?.code,
    ).toBe('FORBIDDEN');
    expect(
      (await asBrowser(demoAdmin.browser, () => actions.recordCashHandInAction(body)))?.serverError,
    ).toMatchObject({
      code: 'DEMO_READ_ONLY',
      message: 'Read-only in the demo',
    });
    const adjust = await asBrowser(morgan.browser, () =>
      actions.adjustEarningsAction({
        ...body,
        direction: 'add',
        reason: 'bonus',
        message: 'Thanks',
      }),
    );
    expect(adjust?.serverError?.code).toBe('FORBIDDEN');
    const report = await asBrowser(morgan.browser, () =>
      actions.earningsReportAction({
        from: '2026-11-16',
        to: '2026-11-22',
        filter: 'all',
        q: '',
        sort: 'partner',
        dir: 'asc',
        page: 1,
      }),
    );
    expect(report?.serverError?.code).toBe('FORBIDDEN');
  });
});

describe('adjustments and payouts (A61, A62)', () => {
  it('asks ADMIN for step-up, then adds with the message, ties only his own order, and pays out at most the balance', async () => {
    await signedInAgo(migrator, daniel.userId, 11);
    const opened = await dialog(daniel, luis.partnerId, 'adjust');
    expect(opened.stepUpRequired).toBe(true);
    const adjust = (extra: Record<string, unknown>) =>
      asBrowser(daniel.browser, () =>
        actions.adjustEarningsAction({
          partnerId: luis.partnerId,
          direction: 'add',
          amount: '3.00',
          reason: 'bonus',
          message: 'Waited 20 min at the kitchen for order 1050.',
          expectedVersion: opened.version,
          idempotencyKey: opened.idempotencyKey,
          ...extra,
        }),
      );
    expect((await adjust({}))?.serverError).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      details: { action: 'earnings' },
    });
    const other = await migrator.order.update({
      where: { id: (await readyOrder(migrator, priya.userId)).id },
      data: { number: String(9_000_000 + Math.floor(Math.random() * 999_999)) },
      select: { number: true },
    });
    expect(
      (
        await adjust({
          stepUp: { method: 'totp', code: await daniel.code() },
          orderNumber: other.number,
        })
      )?.serverError,
    ).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { orderNumber: [`Luis didn't have order ${other.number}.`] },
    });
    const added = await adjust({ idempotencyKey: uuid() });
    expect(added?.data).toMatchObject({ kind: 'BONUS', amountCents: 300, balanceCents: 300 });
    const notice = await migrator.notification.findFirstOrThrow({
      where: { userId: luis.userId, type: 'earnings.adjusted' },
    });
    expect(notice.title).toBe('Foodz added $3.00: Waited 20 min at the kitchen for order 1050.');

    const payout = await dialog(daniel, luis.partnerId, 'payout');
    expect(payout).toMatchObject({ applies: true, defaultAmountCents: 300, stepUpRequired: false });
    const today = new Date().toISOString().slice(0, 10);
    const pay = (amount: string, key = payout.idempotencyKey) =>
      asBrowser(daniel.browser, () =>
        actions.recordPayoutAction({
          partnerId: luis.partnerId,
          amount,
          method: 'bank-transfer',
          reference: 'Transfer 88213',
          paidOn: today,
          expectedVersion: payout.version,
          idempotencyKey: key,
        }),
      );
    expect((await pay('4.00'))?.serverError).toMatchObject({
      fieldErrors: { amount: ['Foodz owes Luis $3.00, so enter $3.00 or less.'] },
    });
    expect((await pay('3.00'))?.data).toMatchObject({
      kind: 'PAYOUT',
      amountCents: -300,
      balanceCents: 0,
    });
    const race = await pay('3.00', uuid());
    expect(race?.serverError).toMatchObject({
      code: 'LEDGER_CHANGED',
      details: { closeOnly: true },
    });
    expect(race?.serverError?.message).toMatch(
      /Daniel Park recorded a payout of \$3\.00 for Luis at .*\. Luis's balance is now \$0\.00\./,
    );
    expect(await dialog(daniel, luis.partnerId, 'payout')).toMatchObject({
      applies: false,
      whyNot: "Foodz doesn't owe Luis anything right now.",
    });
  });
});

describe('the partner page and the report (A59, A63, A66)', () => {
  it("shows staff the ledger with who recorded each entry, and hides a real partner's money from the demo admin", async () => {
    const page = await asBrowser(morgan.browser, () =>
      earnings.getPartnerEarnings(morgan.actor, { partnerId: luis.partnerId }),
    );
    expect(page).toMatchObject({
      hiddenForDemo: false,
      balance: { state: 'square', balanceCents: 0 },
    });
    const cash = page!.entries.rows.find((row) => row.kind === 'CASH_HANDED_IN');
    expect(cash).toMatchObject({
      staffNote: 'At the counter',
      recordedBy: { kind: 'staff', name: 'Morgan Diaz', role: 'support' },
    });
    expect(page!.entries.rows.find((row) => row.kind === 'TIP')?.recordedBy).toEqual({
      kind: 'system',
    });
    expect(page!.lastPayout).toMatchObject({
      amountCents: 300,
      method: 'bank-transfer',
      reference: 'Transfer 88213',
    });
    expect(page!.actions).toMatchObject({
      recordCash: true,
      adjust: false,
      payout: false,
      csv: false,
    });

    const masked = await asBrowser(demoAdmin.browser, () =>
      earnings.getPartnerEarnings(demoAdmin.actor, { partnerId: luis.partnerId }),
    );
    expect(masked).toMatchObject({ hiddenForDemo: true, name: 'L•••', entries: { rows: [] } });
    const demo = await asBrowser(demoAdmin.browser, () =>
      earnings.getPartnerEarnings(demoAdmin.actor, { partnerId: jamie.partnerId }),
    );
    expect(demo).toMatchObject({ hiddenForDemo: false, balance: { balanceCents: 764 } });
  });

  it('adds up every row, splits balance totals, and keeps the pools apart', async () => {
    const monday = (await earnings.getEarningsSummary(luis.actor)).week.start;
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const report = await asBrowser(daniel.browser, () =>
      earnings.getEarningsReport(daniel.actor, {
        from: monday,
        to: sunday,
        sort: 'closing',
        dir: 'asc',
      }),
    );
    const row = report.rows.find((candidate) => candidate.partnerId === luis.partnerId);
    expect(row?.figures).toMatchObject({
      deliveries: 2,
      earnedCents: 1_828,
      cashCollectedCents: 5_897,
      cashHandedInCents: 4_369,
      paidOutCents: 300,
      closingCents: 0,
    });
    for (const each of report.rows) {
      const f = each.figures!;
      expect(
        f.openingCents +
          f.earnedCents -
          f.cashCollectedCents +
          f.cashHandedInCents -
          f.paidOutCents,
      ).toBe(f.closingCents);
    }
    expect(report.rows.some((candidate) => candidate.partnerId === jamie.partnerId)).toBe(false);
    expect(report.totalsCoverDemoOnly).toBe(false);

    const demo = await asBrowser(demoAdmin.browser, () =>
      earnings.getEarningsReport(demoAdmin.actor, { from: monday, to: sunday }),
    );
    expect(demo.totalsCoverDemoOnly).toBe(true);
    expect(
      demo.rows.find((candidate) => candidate.partnerId === jamie.partnerId)?.figures?.earnedCents,
    ).toBe(764);
    const hidden = demo.rows.find((candidate) => candidate.partnerId === luis.partnerId);
    expect(hidden).toMatchObject({ hidden: true, figures: null, name: 'L•••' });
    expect(demo.totals.earnedCents).toBe(764);
    await expect(
      asBrowser(daniel.browser, () =>
        earnings.getEarningsReport(daniel.actor, { from: '2099-01-01', to: '2099-01-02' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('the CSV downloads (A64)', () => {
  it('streams a guarded, audited file to ADMIN only, by POST from this site', async () => {
    const formula = await approvedPartner(migrator, '=HYPERLINK("http://x")');
    await delivered(formula);
    const monday = (await earnings.getEarningsSummary(luis.actor)).week.start;
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const path = '/admin/partners/earnings/export';
    switchBrowser(daniel.browser);
    const response = await reportRoute.POST(csvRequest(path, { from: monday, to: sunday }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="foodz-partner-earnings-${monday}-to-${sunday}.csv"`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('Partner ID,Partner,Vehicle,From,To,Deliveries')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain(',7.64,');
    expect(text.split('\r\n').length).toBeGreaterThan(2);
    expect(
      await migrator.auditLog.count({
        where: { action: 'report.exported', actorId: daniel.userId },
      }),
    ).toBe(1);

    expect(
      (
        await reportRoute.POST(
          csvRequest(path, { from: monday, to: sunday }, 'https://evil.example'),
        )
      ).status,
    ).toBe(403);
    expect((await reportRoute.POST(csvRequest(path, {}, SITE, 'GET'))).status).toBe(405);
    switchBrowser(morgan.browser);
    expect((await reportRoute.POST(csvRequest(path, { from: monday, to: sunday }))).status).toBe(
      403,
    );

    switchBrowser(daniel.browser);
    const entries = await entriesRoute.POST(
      csvRequest(`/admin/partners/${luis.partnerId}/earnings/export`, { from: monday, to: sunday }),
      { params: Promise.resolve({ id: luis.partnerId }) },
    );
    const lines = (await entries.text()).split('\r\n');
    expect(lines[0]).toBe('Time,Kind,Order,Amount,Message to partner,Recorded by');
    expect(lines.some((line) => line.includes('Cash handed in,,43.69,,Support'))).toBe(true);
    expect(lines.join('\n')).not.toContain('Morgan');
  });
});

describe('every figure agrees to the cent (E4.2)', () => {
  it('matches balances, the report, the partner page, the app and the CSV over 10,000 random entries', async () => {
    const people = await Promise.all(
      Array.from({ length: 20 }, (_, index) => approvedPartner(migrator, `Bulk Partner ${index}`)),
    );
    const ids = people.map((person) => person.partnerId);
    // Kinds that need no delivery, appended in the database with random signs, amounts and days.
    await migrator.$queryRaw`
      SELECT count(app_append_entry(
        x.partner, x.k::"EarningType",
        CASE WHEN x.k = 'PAYOUT' OR (x.k = 'ADJUSTMENT' AND x.negative) THEN -x.amount ELSE x.amount END,
        NULL,
        CASE x.k WHEN 'BONUS' THEN 'bonus' WHEN 'ADJUSTMENT' THEN 'correction' END,
        CASE WHEN x.k IN ('BONUS', 'ADJUSTMENT') THEN 'Bulk' END,
        CASE WHEN x.k = 'PAYOUT' THEN 'other' END, NULL,
        CASE WHEN x.k = 'PAYOUT' THEN app_store_date(app_now()) END,
        'REAL', 'bulk-' || x.g::text,
        app_now() - make_interval(days => x.days, mins => x.mins), 'staff'))::int AS written
      FROM (
        SELECT g,
               (ARRAY['BONUS', 'ADJUSTMENT', 'ADJUSTMENT', 'PAYOUT'])[1 + floor(random() * 4)::int] AS k,
               1 + floor(random() * 5000)::int AS amount,
               (${ids}::uuid[])[1 + floor(random() * ${ids.length})::int] AS partner,
               random() < 0.5 AS negative,
               floor(random() * 60)::int AS days,
               floor(random() * 1440)::int AS mins
        FROM generate_series(1, 10000) g
      ) x`;
    const today = (await earnings.getEarningsSummary(luis.actor)).today.date;
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 70 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const report = await asBrowser(daniel.browser, () =>
      earnings.getEarningsReport(daniel.actor, { from, to: today, q: 'Bulk Partner' }),
    );
    const ledgers = await migrator.partnerLedger.findMany({ where: { partnerId: { in: ids } } });
    const sums = await migrator.partnerEarning.groupBy({
      by: ['partnerId'],
      where: { partnerId: { in: ids } },
      _sum: { amountCents: true },
    });
    expect(report.total).toBe(20);
    for (const ledger of ledgers) {
      const sum = sums.find((entry) => entry.partnerId === ledger.partnerId)?._sum.amountCents ?? 0;
      const row = report.rows.find((candidate) => candidate.partnerId === ledger.partnerId);
      expect(Number(ledger.balanceCents)).toBe(sum);
      expect(row?.figures?.closingCents).toBe(sum);
    }
    const sample = people[0]!;
    const page = await asBrowser(daniel.browser, () =>
      earnings.getPartnerEarnings(daniel.actor, { partnerId: sample.partnerId }),
    );
    const app = await earnings.getEarningsSummary(sample.actor);
    const ledger = ledgers.find((entry) => entry.partnerId === sample.partnerId)!;
    expect(page!.balance.balanceCents).toBe(Number(ledger.balanceCents));
    expect(app.cash.balanceCents).toBe(Number(ledger.balanceCents));
    switchBrowser(daniel.browser);
    const csv = await (
      await reportRoute.POST(
        csvRequest('/admin/partners/earnings/export', { from, to: today, q: 'Bulk Partner' }),
      )
    ).text();
    for (const line of csv.split('\r\n').slice(1).filter(Boolean)) {
      const cells = line.split(',');
      const balance = Number(ledgers.find((entry) => entry.partnerId === cells[0])?.balanceCents);
      expect(Math.round(Number(cells.at(-1)) * 100)).toBe(balance);
    }
  }, 120_000);
});

describe('the report at scale (A63.6)', () => {
  it('renders a year of days for 500 partners within 2 seconds', async () => {
    await migrator.$executeRaw`
      WITH people AS (
        INSERT INTO users (id, name, email, role, created_at, updated_at)
        SELECT gen_random_uuid(), 'Scale Partner ' || g, 'scale-' || g || '-' || gen_random_uuid() || '@test.dev', 'partner', now(), now()
        FROM generate_series(1, 500) g
        RETURNING id
      ), partners AS (
        INSERT INTO delivery_partners (id, user_id, status, vehicle_type, approved_at, updated_at)
        SELECT gen_random_uuid(), id, 'APPROVED', 'SCOOTER', now(), now() FROM people
        RETURNING id
      )
      INSERT INTO partner_ledger_days (partner_id, day, pool, deliveries, delivery_pay_cents, tips_cents, net_cents)
      SELECT p.id, app_store_date(app_now()) - d, 'REAL', 5, 1500, 400, 1900
      FROM partners p CROSS JOIN generate_series(0, 364) d`;
    const today = (await earnings.getEarningsSummary(luis.actor)).today.date;
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const started = performance.now();
    const report = await asBrowser(daniel.browser, () =>
      earnings.getEarningsReport(daniel.actor, { from, to: today }),
    );
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(report.total).toBeGreaterThanOrEqual(500);
    expect(report.rows).toHaveLength(50);
    // Day totals written straight in have no entries behind them: remove them for later suites.
    await migrator.$executeRaw`
      DELETE FROM partner_ledger_days d USING delivery_partners p, users u
      WHERE d.partner_id = p.id AND u.id = p.user_id AND u.name LIKE 'Scale Partner %'`;
  }, 120_000);
});
