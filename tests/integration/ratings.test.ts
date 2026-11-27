import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { db } from '@/server/db/client';
import { type Actor, runAs, runAsSystem } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import { seedCatalog } from '../../prisma/seeding';
import { resetEarningsFixtures } from '../../prisma/seeding/earnings';
import { asBrowser, nextHeaders } from './support/browser';
import {
  approvedPartner,
  customerAccount,
  quietDispatch,
  type TestPartner,
} from './support/dispatch';
import { type StaffMember, staffMember } from './support/staff';

/*
 * F9's ratings against the real database (contract §6, §7): who may rate what and when, saving
 * once, averages recalculated exactly over the seeded baselines (50 at once), exclusion with its
 * race, what staff, the kitchen and the partner may read, the day-behind summary and its tag
 * threshold, the one reminder, account deletion, the Orders list flag, the order detail's
 * feedback, and the earnings fixtures' figures.
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

const ratings = await import('@/server/modules/ratings/service');
const actions = await import('@/server/modules/ratings/actions');
const repo = await import('@/server/modules/ratings/repo');
const orders = await import('@/server/modules/orders/service');
const board = await import('@/server/modules/board/service');

let migrator: PrismaClient;
let priya: StaffMember;
let maya: StaffMember;
let dana: StaffMember;
let morgan: StaffMember;
let alex: StaffMember;
let demoAdmin: StaffMember;
let luis: TestPartner;
let jamie: TestPartner;
let dishes: { id: string; title: string; priceCents: number }[];

const menuFigures = (id: string) =>
  migrator.menuItem.findUniqueOrThrow({
    where: { id },
    select: { ratingAvg: true, ratingCount: true },
  });
const partnerFigures = (id: string) =>
  migrator.deliveryPartner.findUniqueOrThrow({
    where: { id },
    select: { ratingAvg: true, ratingCount: true },
  });

let counter = 0;
/** A delivered order for `userId` with the given dishes; with a courier unless `courier: null`. */
async function deliveredOrder(
  userId: string,
  options: {
    dishIds?: string[];
    courier?: TestPartner | null;
    deliveredAgoMinutes?: number;
    demo?: boolean;
  } = {},
) {
  counter += 1;
  const deliveredAt = new Date(Date.now() - (options.deliveredAgoMinutes ?? 5) * 60_000);
  const picked = (options.dishIds ?? [dishes[0]!.id, dishes[1]!.id]).map((id) =>
    dishes.find((dish) => dish.id === id)!,
  );
  const order = await migrator.order.create({
    data: {
      number: String(8_000_000 + Math.floor(Math.random() * 900_000) + counter),
      userId,
      status: 'DELIVERED',
      paymentMethod: 'CARD',
      paymentStatus: 'PAID',
      contactName: 'Priya Shah',
      contactPhone: '+16175550101',
      addressText: '1 Faneuil Hall Square, Boston, MA 02109',
      addressCity: 'Boston, MA 02109',
      addressLat: 42.3601,
      addressLng: -71.0549,
      distanceKm: 1.3,
      subtotalCents: 4_800,
      deliveryFeeCents: 264,
      taxCents: 0,
      tipCents: 500,
      totalCents: 5_564,
      deliveredAt,
      items: {
        create: picked.map((dish) => ({
          menuItemId: dish.id,
          title: dish.title,
          unitPriceCents: dish.priceCents,
          quantity: 1,
          flavors: [],
        })),
      },
    },
    select: { id: true, number: true },
  });
  const courier = options.courier === undefined ? luis : options.courier;
  if (courier) {
    await migrator.delivery.create({
      data: {
        orderId: order.id,
        status: 'DELIVERED',
        partnerId: courier.partnerId,
        partnerFeeCents: 764,
        tipCents: 500,
        pool: options.demo ? 'DEMO' : 'REAL',
        deliveredAt,
      },
    });
  }
  return order;
}

const rate = (member: StaffMember, input: Parameters<typeof actions.rateOrderAction>[0]) =>
  asBrowser(member.browser, () => actions.rateOrderAction(input));

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  dishes = await migrator.menuItem.findMany({
    take: 3,
    orderBy: { slug: 'asc' },
    select: { id: true, title: true, priceCents: true },
  });
  // The story's baselines: 4.9 · 215 and 4.5 · 83 (U17).
  await migrator.menuItem.update({
    where: { id: dishes[0]!.id },
    data: { ratingBaseAvg: 4.9, ratingBaseCount: 215 },
  });
  await migrator.menuItem.update({
    where: { id: dishes[1]!.id },
    data: { ratingBaseAvg: 4.5, ratingBaseCount: 83 },
  });
  await migrator.$executeRaw`SELECT app_recalc_dish_rating(${dishes[0]!.id}::uuid), app_recalc_dish_rating(${dishes[1]!.id}::uuid)`;
  priya = await staffMember(migrator, 'customer', { name: 'Priya Shah' });
  maya = await staffMember(migrator, 'customer', { name: 'Maya Chen' });
  dana = await staffMember(migrator, 'customer', { name: 'Dana Demo', demo: true });
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  alex = await staffMember(migrator, 'kitchen', { name: 'Alex Kim', sample: true });
  demoAdmin = await staffMember(migrator, 'admin', { name: 'Demo Admin', demo: true });
  luis = await approvedPartner(migrator, 'Luis Moreno');
  jamie = await approvedPartner(migrator, 'Jamie Courier', { demo: true });
}, 240_000);

beforeEach(async () => {
  await quietDispatch(migrator);
  mocks.send.mockClear();
});

afterAll(async () => {
  await migrator.$disconnect();
});

const as = (userId: string, role: string, isDemo = false): Actor =>
  ({ kind: 'user', userId, role, isDemo }) as Actor;

const count = (who: Actor) =>
  runAs(who, async (ctx) => ({
    dish: await db(ctx).review.count(),
    courier: await db(ctx).partnerRating.count(),
  }));

describe('rating an order (S1–S5, S8, V2, V3)', () => {
  it('saves stars, tags and a comment once, and moves the averages exactly over the baselines', async () => {
    const order = await deliveredOrder(priya.userId);
    const view = await asBrowser(priya.browser, () =>
      ratings.getOrderRatingView(priya.actor, order.id),
    );
    expect(view).toMatchObject({
      state: 'open',
      editable: true,
      courier: { firstName: 'Luis', stars: null },
    });
    expect(view!.dishes).toHaveLength(2);

    const input = {
      orderId: order.id,
      dishes: [
        {
          menuItemId: dishes[0]!.id,
          stars: 3,
          tags: ['cold'],
          comment: '<img src=x onerror=alert(1)>',
        },
        { menuItemId: dishes[1]!.id, stars: 5, tags: ['tasty'] },
      ],
      courier: { stars: 5, tags: ['friendly', 'on-time'] },
    };
    const first = await rate(priya, input);
    expect(first?.data).toMatchObject({ state: 'rated', courier: { stars: 5 } });
    expect(first?.data?.dishes.find((dish) => dish.menuItemId === dishes[0]!.id)?.comment).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect((await rate(priya, input))?.data?.state).toBe('rated');
    const gimbap = await menuFigures(dishes[0]!.id);
    const padThai = await menuFigures(dishes[1]!.id);
    expect(gimbap.ratingCount).toBe(216);
    expect(gimbap.ratingAvg).toBeCloseTo((4.9 * 215 + 3) / 216, 9);
    expect(padThai.ratingCount).toBe(84);
    expect(padThai.ratingAvg).toBeCloseTo((4.5 * 83 + 5) / 84, 9);
    expect(await partnerFigures(luis.partnerId)).toEqual({ ratingAvg: 5, ratingCount: 1 });
    expect(mocks.send.mock.calls.map(([event]) => (event as { name: string }).name)).toContain(
      'rating.settled',
    );

    const edited = await rate(priya, {
      orderId: order.id,
      dishes: [{ menuItemId: dishes[0]!.id, stars: 1, tags: [] }],
    });
    expect(edited?.data?.dishes.find((dish) => dish.menuItemId === dishes[0]!.id)).toMatchObject({
      stars: 1,
      comment: null,
    });
    const after = await menuFigures(dishes[0]!.id);
    expect(after.ratingCount).toBe(216);
    expect(after.ratingAvg).toBeCloseTo((4.9 * 215 + 1) / 216, 9);
    const row = await migrator.review.findFirstOrThrow({
      where: { orderId: order.id, menuItemId: dishes[0]!.id },
    });
    expect(row.editedAt).not.toBeNull();
  });

  it("refuses closed, cancelled, other people's and staff calls, and dishes or couriers that were not there", async () => {
    const closed = await deliveredOrder(priya.userId, { deliveredAgoMinutes: 8 * 24 * 60 });
    const late = await rate(priya, { orderId: closed.id, courier: { stars: 4, tags: [] } });
    expect(late?.serverError).toMatchObject({
      code: 'RATING_NOT_OPEN',
      details: { why: 'closed' },
    });
    expect(late?.serverError?.message).toMatch(
      /^Ratings for this order closed on [A-Z][a-z]{2} \d{1,2}\.$/,
    );
    const cancelled = await deliveredOrder(priya.userId);
    await migrator.order.update({
      where: { id: cancelled.id },
      data: { status: 'CANCELLED', deliveredAt: null },
    });
    expect(
      (await rate(priya, { orderId: cancelled.id, courier: { stars: 4, tags: [] } }))?.serverError,
    ).toMatchObject({
      code: 'RATING_NOT_OPEN',
      details: { why: 'cancelled' },
    });
    const hers = await deliveredOrder(priya.userId);
    expect(
      (await rate(maya, { orderId: hers.id, courier: { stars: 1, tags: [] } }))?.serverError?.code,
    ).toBe('NOT_FOUND');
    expect(
      (await rate(morgan, { orderId: hers.id, courier: { stars: 1, tags: [] } }))?.serverError
        ?.code,
    ).toBe('NOT_A_CUSTOMER');
    expect(
      (
        await rate(priya, {
          orderId: hers.id,
          dishes: [{ menuItemId: dishes[2]!.id, stars: 4, tags: [] }],
        })
      )?.serverError,
    ).toMatchObject({ code: 'INVALID_INPUT' });
    const noCourier = await deliveredOrder(priya.userId, { courier: null });
    expect(
      (await rate(priya, { orderId: noCourier.id, courier: { stars: 4, tags: [] } }))?.serverError,
    ).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { courier: ['This order had no courier to rate.'] },
    });
    expect(
      (await asBrowser(priya.browser, () => ratings.getOrderRatingView(priya.actor, noCourier.id)))
        ?.courier,
    ).toBeNull();
  });

  it('refuses an account whose email is no longer confirmed (gate S6)', async () => {
    const order = await deliveredOrder(maya.userId);
    await migrator.user.update({ where: { id: maya.userId }, data: { emailVerified: false } });
    try {
      expect(
        (await rate(maya, { orderId: order.id, courier: { stars: 4, tags: [] } }))?.serverError,
      ).toMatchObject({
        code: 'EMAIL_NOT_CONFIRMED',
      });
      expect(
        (await asBrowser(maya.browser, () => actions.skipRatingAction({ orderId: order.id })))
          ?.serverError?.code,
      ).toBe('EMAIL_NOT_CONFIRMED');
      expect(await migrator.partnerRating.count({ where: { orderId: order.id } })).toBe(0);
    } finally {
      await migrator.user.update({ where: { id: maya.userId }, data: { emailVerified: true } });
    }
  });

  it('keeps the demo pool apart: no comments, no real average moves, Jamie counts', async () => {
    const before = await menuFigures(dishes[0]!.id);
    const order = await deliveredOrder(dana.userId, { courier: jamie, demo: true });
    expect(
      (await rate(dana, { orderId: order.id, courier: { stars: 5, tags: [], comment: 'Great' } }))
        ?.serverError,
    ).toMatchObject({ code: 'INVALID_INPUT', message: 'Comments are turned off in the demo.' });
    const saved = await rate(dana, {
      orderId: order.id,
      dishes: [{ menuItemId: dishes[0]!.id, stars: 1, tags: [] }],
      courier: { stars: 4, tags: ['on-time'] },
    });
    expect(saved?.data).toMatchObject({ state: 'rated', demo: true });
    expect(await menuFigures(dishes[0]!.id)).toEqual(before);
    expect(await partnerFigures(jamie.partnerId)).toEqual({ ratingAvg: 4, ratingCount: 1 });
    expect(await migrator.review.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({
      pool: 'DEMO',
    });
  });

  it('ends exact after 50 ratings sent at once', async () => {
    const people = await Promise.all(
      Array.from({ length: 50 }, (_, index) => customerAccount(migrator, `Rater ${index}`)),
    );
    const placed = await Promise.all(
      people.map((person) =>
        deliveredOrder(person.userId, { dishIds: [dishes[2]!.id], courier: null }),
      ),
    );
    const base = await migrator.menuItem.findUniqueOrThrow({
      where: { id: dishes[2]!.id },
      select: { ratingBaseAvg: true, ratingBaseCount: true },
    });
    await Promise.all(
      people.map((person, index) =>
        runAs(person.actor, async (ctx) => {
          await repo.upsertDishRating(ctx, {
            orderId: placed[index]!.id,
            userId: person.userId,
            menuItemId: dishes[2]!.id,
            stars: (index % 5) + 1,
            tags: [],
            comment: null,
            pool: 'REAL',
          });
          await repo.recalcDish(ctx, dishes[2]!.id);
        }),
      ),
    );
    const figures = await menuFigures(dishes[2]!.id);
    const baseCount = base.ratingBaseCount;
    expect(figures.ratingCount).toBe(baseCount + 50);
    expect(figures.ratingAvg).toBeCloseTo(
      (Number(base.ratingBaseAvg) * baseCount + 150) / (baseCount + 50),
      9,
    );
  }, 120_000);
});

describe('who reads ratings, with the service bypassed (V9, P58.3)', () => {
  it('lets the customer read her own, staff the real pool, the demo admin the demo pool, and never the courier or the kitchen', async () => {
    const real = {
      dish: await migrator.review.count({ where: { pool: 'REAL' } }),
      courier: await migrator.partnerRating.count({ where: { pool: 'REAL' } }),
    };
    expect(await count(as(morgan.userId, 'support'))).toEqual(real);
    expect((await count(luis.actor)).courier).toBe(0);
    expect(await count(as(alex.userId, 'kitchen'))).toEqual({ dish: 0, courier: 0 });
    expect((await count(as(demoAdmin.userId, 'admin', true))).courier).toBe(
      await migrator.partnerRating.count({ where: { pool: 'DEMO' } }),
    );
    expect((await count(priya.actor)).courier).toBeGreaterThan(0);
    // A customer can't change the status of her own rating, or anyone's stars.
    await expect(
      runAs(
        priya.actor,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE partner_ratings SET status = 'HIDDEN', excluded_reason = 'other', excluded_note = 'x' WHERE user_id = ${priya.userId}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAs(priya.actor, (ctx) => db(ctx).$executeRaw`DELETE FROM reviews`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('moderation (A58)', () => {
  it('excludes with a reason, answers a race with who did it, includes again, and audits both', async () => {
    const rated = await migrator.partnerRating.findFirstOrThrow({
      where: { partnerId: luis.partnerId },
      select: { id: true },
    });
    const exclude = () =>
      asBrowser(morgan.browser, () =>
        actions.excludeRatingAction({
          kind: 'courier',
          ratingId: rated.id,
          reason: 'wrong-subject',
          note: 'The customer meant the Pad Thai.',
        }),
      );
    expect((await exclude())?.data).toMatchObject({
      status: 'excluded',
      boardNotice: "Rating excluded from Luis M.'s average.",
    });
    expect(await partnerFigures(luis.partnerId)).toEqual({ ratingAvg: 0, ratingCount: 0 });
    expect((await exclude())?.serverError).toMatchObject({
      code: 'RATING_CHANGED',
      message: 'Morgan Diaz excluded this rating a moment ago.',
    });
    expect(
      (
        await asBrowser(alex.browser, () =>
          actions.excludeRatingAction({ kind: 'courier', ratingId: rated.id, reason: 'abusive' }),
        )
      )?.serverError?.code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await asBrowser(demoAdmin.browser, () =>
          actions.includeRatingAction({ kind: 'courier', ratingId: rated.id }),
        )
      )?.serverError?.code,
    ).toBe('DEMO_READ_ONLY');
    const page = await asBrowser(morgan.browser, () =>
      ratings.getPartnerRatings(morgan.actor, { partnerId: luis.partnerId, cursor: null }),
    );
    expect(page?.rows[0]).toMatchObject({
      customerShort: 'Priya S.',
      excluded: { reason: 'wrong-subject', byName: 'Morgan Diaz' },
    });
    expect(
      (
        await asBrowser(morgan.browser, () =>
          actions.includeRatingAction({ kind: 'courier', ratingId: rated.id }),
        )
      )?.data?.status,
    ).toBe('counted');
    expect(await partnerFigures(luis.partnerId)).toEqual({ ratingAvg: 5, ratingCount: 1 });
    expect(
      await migrator.auditLog.count({
        where: { action: { in: ['rating.excluded', 'rating.included'] }, targetId: rated.id },
      }),
    ).toBe(2);
    const masked = await asBrowser(demoAdmin.browser, () =>
      ratings.getPartnerRatings(demoAdmin.actor, { partnerId: luis.partnerId, cursor: null }),
    );
    expect(masked).toMatchObject({ hiddenForDemo: true, rows: [] });
  });
});

/** A counted rating of Luis by a new customer, created `daysAgo` (before the day-behind cut). */
async function ratingOfLuis(stars: number, tags: string[], daysAgo = 2) {
  const fan = await customerAccount(migrator, `Fan ${stars}-${Math.random()}`);
  const order = await deliveredOrder(fan.userId, { dishIds: [dishes[0]!.id] });
  await migrator.partnerRating.create({
    data: {
      userId: fan.userId,
      partnerId: luis.partnerId,
      orderId: order.id,
      rating: stars,
      tags,
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    },
  });
}

describe("the partner's own summary (P58, V8, U14, gate S1)", () => {
  it('answers approved partners only: an applicant and a suspended partner are refused (QA B1)', async () => {
    const applicant = await approvedPartner(migrator, 'Ana Applicant');
    await migrator.deliveryPartner.update({
      where: { id: applicant.partnerId },
      data: { status: 'APPLIED', approvedAt: null },
    });
    await expect(ratings.getMyRatingsSummary(applicant.actor)).rejects.toMatchObject({
      code: 'NOT_APPROVED',
    });
    const suspended = await approvedPartner(migrator, 'Victor Suspended');
    await migrator.deliveryPartner.update({
      where: { id: suspended.partnerId },
      data: { status: 'SUSPENDED' },
    });
    await expect(ratings.getMyRatingsSummary(suspended.actor)).rejects.toMatchObject({
      code: 'PARTNER_SUSPENDED',
    });
  });

  it('publishes a new figure only after 5 new counted ratings, tags included, and shows nothing before', async () => {
    expect(await ratings.getMyRatingsSummary(luis.actor)).toMatchObject({
      count: 0,
      average: null,
      tagsShown: false,
    });
    // One rating before the cut is still not published: it would be one customer's stars.
    await migrator.$executeRaw`UPDATE partner_ratings SET created_at = created_at - interval '5 days' WHERE partner_id = ${luis.partnerId}::uuid`;
    const one = await ratings.getMyRatingsSummary(luis.actor);
    expect(one).toMatchObject({ count: 0, average: null, tagsShown: false, liked: [] });
    expect(JSON.stringify(one)).not.toMatch(/Priya|order|comment/i);

    // Four more make five new counted ratings: the first publish, with tags.
    await ratingOfLuis(3, ['late'], 5);
    for (let index = 0; index < 3; index += 1) await ratingOfLuis(5, ['friendly'], 5);
    const five = await ratings.getMyRatingsSummary(luis.actor);
    expect(five).toMatchObject({ count: 5, shownToCustomers: true, tagsShown: true });
    expect(five.average).toBeCloseTo((5 + 3 + 15) / 5, 9);
    expect(five.liked).toEqual(expect.arrayContaining([{ tag: 'friendly', count: 4 }]));
    expect(five.mentioned).toEqual([{ tag: 'late', count: 1 }]);

    // As if that publish was four days ago: later ratings are new ones.
    await migrator.$executeRaw`UPDATE partner_rating_snapshots SET published_through = app_now() - interval '4 days' WHERE partner_id = ${luis.partnerId}::uuid`;
    const visible = (summary: Awaited<ReturnType<typeof ratings.getMyRatingsSummary>>) => ({
      count: summary.count,
      average: summary.average,
      tagsShown: summary.tagsShown,
      liked: summary.liked,
      mentioned: summary.mentioned,
    });
    // One more changes nothing he can see until five new ones have arrived.
    await ratingOfLuis(1, ['unfriendly']);
    const held = await ratings.getMyRatingsSummary(luis.actor);
    expect(visible(held)).toEqual(visible(five));
    const home = await runAs(luis.actor, (ctx) => ratings.partnerRatingLineIn(ctx, new Date()));
    expect(home).toEqual({ average: five.average, count: 5 });
    for (let index = 0; index < 3; index += 1) await ratingOfLuis(4, ['on-time']);
    expect((await ratings.getMyRatingsSummary(luis.actor)).count).toBe(5);
    await ratingOfLuis(4, ['on-time']);
    const ten = await ratings.getMyRatingsSummary(luis.actor);
    expect(ten.count).toBe(10);
    expect(ten.average).toBeCloseTo((23 + 1 + 16) / 10, 9);
    expect(ten.mentioned).toEqual(expect.arrayContaining([{ tag: 'unfriendly', count: 1 }]));
  });
});

describe('the reminder (S4, V6)', () => {
  it('sends once for an untouched order, never for a rated, skipped or demo one', async () => {
    const order = await deliveredOrder(maya.userId);
    expect(await ratings.sendRatingReminder(order.id)).toBe('sent');
    expect(await ratings.sendRatingReminder(order.id)).toBe('skipped');
    const notice = await migrator.notification.findFirstOrThrow({
      where: { userId: maya.userId, type: 'order.rate-reminder' },
    });
    expect(notice).toMatchObject({
      title: `How was order ${order.number}?`,
      link: `/orders/${order.id}#rate`,
    });
    expect(notice.body).toMatch(/and Luis's delivery\. It takes ten seconds\.$/);
    const skipped = await deliveredOrder(maya.userId);
    expect(
      (await asBrowser(maya.browser, () => actions.skipRatingAction({ orderId: skipped.id })))?.data
        ?.state,
    ).toBe('skipped');
    expect(await ratings.sendRatingReminder(skipped.id)).toBe('skipped');
    const demo = await deliveredOrder(dana.userId, { courier: jamie, demo: true });
    expect(await ratings.sendRatingReminder(demo.id)).toBe('skipped');
  });
});

describe('hooks on other screens (S6, A65, V9)', () => {
  it('flags Orders list rows, gives SUPPORT the feedback and the kitchen nothing', async () => {
    const page = await asBrowser(priya.browser, () => orders.listMyOrders(priya.actor, {}));
    expect(page.past.some((row) => row.rating === 'rated')).toBe(true);
    expect(page.past.some((row) => row.rating === 'rate')).toBe(true);
    const order = await migrator.review.findFirstOrThrow({
      where: { userId: priya.userId },
      select: { orderId: true },
    });
    const full = await asBrowser(morgan.browser, () =>
      board.getStaffOrderDetail(morgan.actor, order.orderId),
    );
    expect(full?.view === 'full' && full.feedback).toMatchObject({ state: 'rated' });
    const kitchen = await asBrowser(alex.browser, () =>
      board.getStaffOrderDetail(alex.actor, order.orderId),
    );
    expect(kitchen?.view).toBe('kitchen');
    expect(JSON.stringify(kitchen)).not.toContain('feedback');
  });

  it("keeps a deleted customer's stars without her name or comments, and exports her ratings", async () => {
    const exported = await runAs(priya.actor, (ctx) => ratings.ratingsExportIn(ctx, priya.userId));
    expect(exported.some((row) => row.tags.includes('Friendly'))).toBe(true);
    const before = await partnerFigures(luis.partnerId);
    await runAs(priya.actor, (ctx) => ratings.unlinkRatingsIn(ctx));
    expect(await migrator.review.count({ where: { userId: priya.userId } })).toBe(0);
    expect(await migrator.review.count({ where: { userId: null, comment: { not: null } } })).toBe(
      0,
    );
    expect(await partnerFigures(luis.partnerId)).toEqual(before);
  });
});

describe('the earnings fixtures (E11, story fixtures)', () => {
  it("write Luis's, Diego's and Grace's figures for T", async () => {
    const people = {
      luis: (await approvedPartner(migrator, 'Luis Fixture')).partnerId,
      diego: (await approvedPartner(migrator, 'Diego Fixture')).partnerId,
      grace: (await approvedPartner(migrator, 'Grace Fixture')).partnerId,
      morgan: morgan.userId,
      admin: demoAdmin.userId,
    };
    const at = new Date('2026-11-21T00:46:00Z');
    await migrator.$transaction((tx) => resetEarningsFixtures(tx, people, at), {
      timeout: 120_000,
    });
    await migrator.$transaction((tx) => resetEarningsFixtures(tx, people, at), {
      timeout: 120_000,
    });
    const ledger = (id: string) =>
      migrator.partnerLedger.findUniqueOrThrow({ where: { partnerId: id } });
    expect(Number((await ledger(people.luis)).balanceCents)).toBe(11_838);
    const diego = await ledger(people.diego);
    expect(Number(diego.balanceCents)).toBe(-14_270);
    expect(Number(diego.holdingCents)).toBe(16_480);
    expect(diego.owedSince?.toISOString()).toBe('2026-11-18T01:40:00.000Z');
    expect(await partnerFigures(people.grace)).toEqual({ ratingAvg: 4.5, ratingCount: 8 });
    const week = await runAsSystem(
      'fixture check',
      (ctx) =>
        db(ctx).$queryRaw<{ deliveries: number; pay: number; tips: number }[]>`
        SELECT sum(deliveries)::int AS deliveries, sum(delivery_pay_cents)::int AS pay, sum(tips_cents)::int AS tips
        FROM partner_ledger_days WHERE partner_id = ${people.luis}::uuid AND day BETWEEN '2026-11-16' AND '2026-11-22'`,
    );
    expect(week[0]).toEqual({ deliveries: 17, pay: 8_388, tips: 3_450 });
  }, 120_000);
});
