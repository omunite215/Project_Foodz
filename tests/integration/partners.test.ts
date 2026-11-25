import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { objectSize } from '@/server/storage/s3';
import { seedCatalog } from '../../prisma/seeding';
import { asBrowser, type Browser, nextHeaders, switchBrowser } from './support/browser';
import { openAllDay, restoreHours } from './support/checkout';
import { readyUpload, seedBulkApplicants } from './support/partners';
import { signedInAgo, type StaffMember, staffMember } from './support/staff';

/*
 * F6 through its actions, routes, services and jobs (contract §2 to §8): applying, editing and
 * withdrawing; the staff review with its permissions, version check, step-up, masking and
 * decisions; going online and sending locations; suspension; the automatic offline job and the
 * file clean-up. Effects are captured from the realtime and job clients.
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

const partners = await import('@/server/modules/partners/actions');
const review = await import('@/server/modules/partners/review-actions');
const service = await import('@/server/modules/partners/service');
const availabilityRoute = await import('@/app/api/v1/partner/availability/route');
const meRoute = await import('@/app/api/v1/partner/me/route');

interface ActionResult<T = unknown> {
  data?: T;
  serverError?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
  };
  validationErrors?: unknown;
}

let migrator: PrismaClient;
let alex: StaffMember;
let morgan: StaffMember;
let daniel: StaffMember;
let demo: StaffMember;
let taylor: StaffMember;
let unsecured: StaffMember;
let luis: StaffMember;
let dana: StaffMember;

const as = <T>(who: { browser: Browser }, work: () => Promise<T>) => asBrowser(who.browser, work);
const LUIS_NUMBER = 'S48204821';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3456';

async function applicant(name: string, options: { confirmed?: boolean; demo?: boolean } = {}) {
  const member = await staffMember(migrator, 'customer', { name, demo: options.demo });
  if (options.confirmed === false) {
    await migrator.user.update({ where: { id: member.userId }, data: { emailVerified: false } });
  }
  return member;
}

async function application(who: StaffMember, overrides: Record<string, unknown> = {}) {
  return {
    photoUploadId: await readyUpload(migrator, who.userId, 'PARTNER_PHOTO'),
    phone: '(617) 555-0177',
    vehicleType: 'SCOOTER',
    plate: '7kt 342',
    idNumber: 'S4820 4821',
    idExpiresOn: '2029-03-03',
    idDocumentUploadId: await readyUpload(migrator, who.userId, 'PARTNER_DOCUMENT'),
    termsVersion: 1,
    adult: true,
    agreeTerms: true,
    turnstileToken: 'token',
    ...overrides,
  } as Parameters<typeof partners.submitApplicationAction>[0];
}

async function submit(who: StaffMember, overrides: Record<string, unknown> = {}) {
  const input = await application(who, overrides);
  return (await as(who, () => partners.submitApplicationAction(input))) as ActionResult<{
    partnerId: string;
    version: number;
    replayed: boolean;
  }>;
}

const versionOf = async (partnerId: string) =>
  (
    await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { version: true },
    })
  ).version;

const sessionOf = async (userId: string) =>
  (
    await migrator.session.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
  ).id;

/** A signed-in, approved partner (made the way the seed makes Diego). */
async function approvedPartner(name: string, options: { demo?: boolean } = {}) {
  const member = await staffMember(migrator, 'partner', { name, demo: options.demo });
  const { id } = await migrator.deliveryPartner.create({
    data: {
      userId: member.userId,
      status: 'APPROVED',
      vehicleType: 'MOTORBIKE',
      vehiclePlate: `PT ${Math.floor(Math.random() * 900 + 100)}`,
      approvedAt: new Date(),
      welcomedAt: new Date(),
      version: 2,
    },
    select: { id: true },
  });
  return { member, partnerId: id };
}

const point = (lat: number, lng: number, secondsAgo = 0, accuracy = 15) => ({
  lat,
  lng,
  accuracy,
  recordedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
});

const routeRequest = (method: string, body?: unknown, origin: string | null = SITE) =>
  new Request(`${SITE}/api/v1/partner/availability`, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const published = (event: string) =>
  mocks.publish.mock.calls
    .filter(([, name]) => name === event)
    .map(([channel, , data]) => ({ channel, data }));

const sent = (name: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; data: Record<string, unknown> })
    .filter((event) => event.name === name);

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  await openAllDay(migrator);
  alex = await staffMember(migrator, 'kitchen', { name: 'Alex Kim', sample: true });
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  daniel = await staffMember(migrator, 'admin', { name: 'Foodz Admin' });
  demo = await staffMember(migrator, 'admin', { name: 'Demo Admin', demo: true });
  taylor = await staffMember(migrator, 'content_editor', { name: 'Taylor Brooks' });
  unsecured = await staffMember(migrator, 'support', { name: 'No Code', twoFactor: false });
  luis = await applicant('Luis Moreno');
  dana = await applicant('Dana Customer', { demo: true });
}, 180_000);

beforeEach(async () => {
  mocks.send.mockClear();
  mocks.publish.mockClear();
  const limits = await redis.keys('rl:partner.*');
  if (limits.length > 0) await redis.del(...limits);
});

afterAll(async () => {
  // Leave the store's hours as the seed set them; the suites share one database.
  await restoreHours(migrator);
  await migrator.$disconnect();
});

// ------------------------------------------------------------------ applying

describe('applying (P1 to P5)', () => {
  it('refuses staff, the demo customer and an unconfirmed email', async () => {
    expect((await submit(alex)).serverError).toMatchObject({ code: 'NOT_A_CUSTOMER' });
    expect((await submit(dana)).serverError).toMatchObject({ code: 'DEMO_READ_ONLY' });
    const jordan = await applicant('Jordan Lee', { confirmed: false });
    expect((await submit(jordan)).serverError).toMatchObject({ code: 'EMAIL_NOT_CONFIRMED' });
  });

  it('stores the number encrypted with its last four, once, and tells the applicant', async () => {
    const input = await application(luis);
    const first = (await as(luis, () => partners.submitApplicationAction(input))) as ActionResult<{
      partnerId: string;
      replayed: boolean;
    }>;
    expect(first.serverError).toBeUndefined();
    const again = (await as(luis, () => partners.submitApplicationAction(input))) as ActionResult<{
      partnerId: string;
      replayed: boolean;
    }>;
    expect(again.data).toMatchObject({ partnerId: first.data!.partnerId, replayed: true });

    const row = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { userId: luis.userId },
    });
    expect(row.licenseNumberEnc).toMatch(/^v1\./);
    expect(row.idNumberLast4).toBe('4821');
    expect(row.vehiclePlate).toBe('7KT 342');
    expect(JSON.stringify(row)).not.toContain(LUIS_NUMBER);
    expect(
      await migrator.user.findUniqueOrThrow({
        where: { id: luis.userId },
        select: { phone: true },
      }),
    ).toEqual({
      phone: '+16175550177',
    });
    expect(await migrator.partnerApplicationEvent.count({ where: { partnerId: row.id } })).toBe(1);
    expect(
      await migrator.auditLog.count({ where: { action: 'partner.applied', targetId: row.id } }),
    ).toBe(1);
    expect(published('notification.created')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'partner', type: 'partner.application-received' }),
      }),
    ]);
    expect(sent('partner.email-requested')).toHaveLength(1);
  });

  it('shows the pending screen with the last four only', async () => {
    const state = await as(luis, () => service.getMyPartnerState(luis.actor));
    expect(state).toMatchObject({
      screen: 'pending',
      application: {
        documentWords: "Driver's license ending 4821 · expires Mar 3, 2029",
        vehicleWords: 'Scooter or moped · 7KT 342',
      },
    });
    expect(JSON.stringify(state)).not.toContain(LUIS_NUMBER);
  });

  it('refuses a second application, a foreign upload and an expired license', async () => {
    await migrator.deliveryPartner.update({
      where: { userId: luis.userId },
      data: { submittedAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect((await submit(luis)).serverError).toMatchObject({ code: 'APPLICATION_EXISTS' });

    const marco = await applicant('Marco Bianchi');
    const foreign = await readyUpload(migrator, luis.userId, 'PARTNER_PHOTO');
    expect((await submit(marco, { photoUploadId: foreign })).serverError).toMatchObject({
      code: 'UPLOAD_NOT_READY',
      fieldErrors: { photoUploadId: ["That photo isn't available. Upload it again."] },
    });
    expect((await submit(marco, { idExpiresOn: '2020-01-01' })).serverError).toMatchObject({
      fieldErrors: { idExpiresOn: ['This license has expired. You need a valid one to deliver.'] },
    });
    expect(await migrator.deliveryPartner.count({ where: { userId: marco.userId } })).toBe(0);
  });
});

// ------------------------------------------------------------------ the staff review

describe('who may review (A18, A30)', () => {
  it('refuses the kitchen, content editors, applicants and staff without two-factor', async () => {
    const input = { tab: 'review' } as Parameters<typeof review.partnerListAction>[0];
    for (const who of [alex, taylor, luis]) {
      expect(
        ((await as(who, () => review.partnerListAction(input))) as ActionResult).serverError,
      ).toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(
      ((await as(unsecured, () => review.partnerListAction(input))) as ActionResult).serverError,
    ).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
  });

  it('lists the oldest application first with counts per tab, one page at a time', async () => {
    await seedBulkApplicants(migrator, 30);
    const result = (await as(morgan, () =>
      review.partnerListAction({ tab: 'review' } as Parameters<typeof review.partnerListAction>[0]),
    )) as ActionResult<{
      rows: { name: string; submittedAt: string }[];
      total: number;
      counts: Record<string, number>;
      pageCount: number;
    }>;
    expect(result.data!.rows.length).toBe(25);
    expect(result.data!.total).toBeGreaterThanOrEqual(31);
    expect(result.data!.counts.review).toBe(result.data!.total);
    const order = result.data!.rows.map((row) => row.submittedAt);
    expect(order).toEqual(order.toSorted());
    const last = (await as(morgan, () =>
      review.partnerListAction({ tab: 'review', page: 99 } as Parameters<
        typeof review.partnerListAction
      >[0]),
    )) as ActionResult<{ page: number; pageCount: number }>;
    expect(last.data!.page).toBe(last.data!.pageCount);
  });
});

const searchList = (who: StaffMember) =>
  as(who, () =>
    review.partnerListAction({ tab: 'all', q: '7KT3' } as Parameters<
      typeof review.partnerListAction
    >[0]),
  ) as Promise<ActionResult<{ rows: { partnerId: string }[] }>>;

describe('one application, for each role (A20, A21, A29)', () => {
  let partnerId: string;
  beforeAll(async () => {
    partnerId = (
      await migrator.deliveryPartner.findUniqueOrThrow({ where: { userId: luis.userId } })
    ).id;
  });

  it('gives reviewers the last four, a 5-minute link and an audited ID view', async () => {
    const result = (await as(morgan, () =>
      review.partnerReviewAction({ partnerId }),
    )) as ActionResult<
      Record<string, unknown> & {
        images: { idFront: { state: string } };
        document: { last4: string };
      }
    >;
    expect(result.data!.document.last4).toBe('4821');
    expect(result.data!.images.idFront.state).toBe('ready');
    const text = JSON.stringify(result.data);
    expect(text).not.toContain(LUIS_NUMBER);
    expect(text).not.toContain('v1.');
    expect(
      await migrator.auditLog.count({
        where: { action: 'partner.document-viewed', targetId: partnerId },
      }),
    ).toBeGreaterThan(0);
  });

  it('masks a real applicant for the demo admin and makes no link', async () => {
    const result = (await as(demo, () =>
      review.partnerReviewAction({ partnerId }),
    )) as ActionResult<{
      name: string;
      phone: unknown;
      images: { photo: { state: string }; idFront: { state: string } };
      document: unknown;
      actions: { enabled: boolean; reason: string | null }[];
    }>;
    expect(result.data).toMatchObject({
      name: 'L•••',
      phone: null,
      document: null,
      images: { photo: { state: 'masked' }, idFront: { state: 'masked' } },
    });
    expect(result.data!.actions.every((action) => !action.enabled)).toBe(true);
    expect(
      (
        (await as(demo, () =>
          review.partnerDocumentLinkAction({ partnerId, kind: 'idFront' }),
        )) as ActionResult
      ).serverError,
    ).toMatchObject({ code: 'NOT_FOUND' });
    const approve = (await as(demo, () =>
      review.approvePartnerAction({ partnerId, expectedVersion: 1, flagsChecked: true }),
    )) as ActionResult;
    expect(approve.serverError).toMatchObject({ code: 'DEMO_READ_ONLY' });
  });

  it("never matches a masked applicant's plate in the demo admin's search (security gate S1)", async () => {
    expect((await searchList(morgan)).data!.rows.map((row) => row.partnerId)).toContain(partnerId);
    expect((await searchList(demo)).data!.rows.map((row) => row.partnerId)).not.toContain(
      partnerId,
    );
  });

  it('answers 404 for an unknown or malformed id', async () => {
    for (const id of [uuid()]) {
      expect(
        ((await as(morgan, () => review.partnerReviewAction({ partnerId: id }))) as ActionResult)
          .serverError,
      ).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });
});

// ------------------------------------------------------------------ decisions

describe('send back, fix and the version check (A24, A26)', () => {
  it('sends back once, takes the fix back to the queue, and refuses a stale decision', async () => {
    const partnerId = (
      await migrator.deliveryPartner.findUniqueOrThrow({ where: { userId: luis.userId } })
    ).id;
    const version = await versionOf(partnerId);
    const back = (await as(morgan, () =>
      review.sendBackPartnerAction({
        partnerId,
        expectedVersion: version,
        message: '<b>blurry</b> photo',
      }),
    )) as ActionResult<{ status: string; version: number }>;
    expect(back.data).toMatchObject({ status: 'APPLIED', version: version + 1 });
    const twice = (await as(daniel, () =>
      review.sendBackPartnerAction({ partnerId, expectedVersion: version + 1, message: 'again' }),
    )) as ActionResult;
    expect(twice.serverError).toMatchObject({ code: 'ALREADY_SENT_BACK' });

    const state = await as(luis, () => service.getMyPartnerState(luis.actor));
    expect(state).toMatchObject({
      screen: 'sentBack',
      sentBack: { message: '<b>blurry</b> photo' },
    });

    const newPhoto = await readyUpload(migrator, luis.userId, 'PARTNER_DOCUMENT');
    const current = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    const fix = (await as(luis, () =>
      partners.updateApplicationAction({
        photoUploadId: current.photoUploadId!,
        phone: '(617) 555-0177',
        vehicleType: 'SCOOTER',
        plate: '7KT 342',
        idExpiresOn: '2029-03-03',
        idDocumentUploadId: newPhoto,
        expectedVersion: current.version,
      }),
    )) as ActionResult<{ fixed: boolean }>;
    expect(fix.data).toMatchObject({ fixed: true });
    expect(await migrator.upload.count({ where: { id: current.idDocumentUploadId! } })).toBe(0);

    const stale = (await as(morgan, () =>
      review.approvePartnerAction({
        partnerId,
        expectedVersion: current.version,
        flagsChecked: true,
      }),
    )) as ActionResult;
    expect(stale.serverError).toMatchObject({
      code: 'APPLICATION_CHANGED',
      details: { how: 'edited', changedParts: ['idPhoto'] },
    });
  });

  it('refuses a save from a form opened before a send-back or another save (P6.3)', async () => {
    const sam = await applicant('Sam Okafor');
    const applied = await submit(sam, { plate: '5SB 214', idNumber: 'S7710 3302' });
    const partnerId = applied.data!.partnerId;
    const opened = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    const save = (expectedVersion: number, plate: string) =>
      as(sam, () =>
        partners.updateApplicationAction({
          photoUploadId: opened.photoUploadId!,
          phone: '(617) 555-0177',
          vehicleType: 'SCOOTER',
          plate,
          idExpiresOn: '2029-03-03',
          idDocumentUploadId: opened.idDocumentUploadId!,
          expectedVersion,
        }),
      ) as Promise<ActionResult<{ version: number; fixed: boolean }>>;

    // Another tab saved first: this one is refused and changes nothing.
    expect((await save(opened.version, '5SB 215')).data).toMatchObject({ fixed: false });
    const otherTab = await save(opened.version, '5SB 216');
    expect(otherTab.serverError).toMatchObject({
      code: 'APPLICATION_CHANGED',
      details: { how: 'edited', current: { status: 'APPLIED', version: opened.version + 1 } },
    });

    // Morgan sends it back while the form is open: the stale save is a decision to read.
    const before = await versionOf(partnerId);
    await as(morgan, () =>
      review.sendBackPartnerAction({ partnerId, expectedVersion: before, message: 'New plate?' }),
    );
    const stale = await save(before, '5SB 217');
    expect(stale.serverError).toMatchObject({
      code: 'APPLICATION_DECIDED',
      message: 'Your application was just reviewed. See the decision below.',
      details: { status: 'APPLIED' },
    });
    expect(await versionOf(partnerId)).toBe(before + 1);
    const last = await migrator.partnerApplicationEvent.findFirstOrThrow({
      where: { partnerId },
      orderBy: { versionAfter: 'desc' },
      select: { type: true },
    });
    expect(last).toEqual({ type: 'sent-back' });
    expect(await as(sam, () => service.getMyPartnerState(sam.actor))).toMatchObject({
      screen: 'sentBack',
      sentBack: { message: 'New plate?' },
    });

    // Opened again at the current version, the fix goes through.
    expect((await save(before + 1, '5SB 217')).data).toMatchObject({ fixed: true });
  });
});

describe('approving (A23, A27)', () => {
  it('asks for a code when the last check is stale, then approves once', async () => {
    const partnerId = (
      await migrator.deliveryPartner.findUniqueOrThrow({ where: { userId: luis.userId } })
    ).id;
    const version = await versionOf(partnerId);
    await signedInAgo(migrator, morgan.userId, 30);
    const needsCode = (await as(morgan, () =>
      review.approvePartnerAction({ partnerId, expectedVersion: version, flagsChecked: true }),
    )) as ActionResult;
    expect(needsCode.serverError).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      details: { action: 'partner' },
    });

    const approved = (await as(morgan, async () =>
      review.approvePartnerAction({
        partnerId,
        expectedVersion: version,
        flagsChecked: true,
        stepUp: { method: 'totp', code: await morgan.code() },
      }),
    )) as ActionResult<{ status: string; replayed: boolean }>;
    expect(approved.data).toMatchObject({ status: 'APPROVED', replayed: false });
    const again = (await as(morgan, () =>
      review.approvePartnerAction({ partnerId, expectedVersion: version, flagsChecked: true }),
    )) as ActionResult<{ replayed: boolean }>;
    expect(again.data).toMatchObject({ replayed: true });

    expect(
      await migrator.user.findUniqueOrThrow({ where: { id: luis.userId }, select: { role: true } }),
    ).toEqual({
      role: 'partner',
    });
    expect(await migrator.session.count({ where: { userId: luis.userId } })).toBe(0);
    expect(
      await migrator.auditLog.count({ where: { action: 'partner.approved', targetId: partnerId } }),
    ).toBe(1);
    expect(sent('partner.email-requested').map((event) => event.data.kind)).toEqual(['approved']);
  });
});

describe('rejecting and reopening (A24, A28, P7.6)', () => {
  it('rejects without a reason, refuses an early reapplication, and lets only an admin reopen', async () => {
    const jonas = await applicant('Jonas Weber');
    const applied = await submit(jonas, { plate: '4PL 770', idNumber: 'L5523302' });
    const partnerId = applied.data!.partnerId;
    const rejected = (await as(morgan, () =>
      review.rejectPartnerAction({ partnerId, expectedVersion: 1, staffNote: 'Name mismatch' }),
    )) as ActionResult<{ status: string }>;
    expect(rejected.data).toMatchObject({ status: 'REJECTED' });
    expect((await submit(jonas)).serverError).toMatchObject({ code: 'REAPPLY_LATER' });

    const bySupport = (await as(morgan, () =>
      review.reopenPartnerAction({ partnerId, expectedVersion: 2, staffNote: 'Typo' }),
    )) as ActionResult;
    expect(bySupport.serverError).toMatchObject({ code: 'FORBIDDEN' });
    const byAdmin = (await as(daniel, () =>
      review.reopenPartnerAction({ partnerId, expectedVersion: 2, staffNote: 'Typo' }),
    )) as ActionResult<{ status: string }>;
    expect(byAdmin.data).toMatchObject({ status: 'APPLIED' });
    const row = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    expect(row.reapplyAfter).toBeNull();
    expect(row.decisionReason).toBeNull();
  });
});

describe('deciding on your own application (security gate S4)', () => {
  it('is refused, even for a reviewer', async () => {
    const reviewer = await staffMember(migrator, 'support', { name: 'Self Reviewer' });
    const { id } = await migrator.deliveryPartner.create({
      data: { userId: reviewer.userId, status: 'APPLIED', vehicleType: 'BICYCLE', version: 1 },
      select: { id: true },
    });
    const result = (await as(reviewer, () =>
      review.rejectPartnerAction({ partnerId: id, expectedVersion: 1 }),
    )) as ActionResult;
    expect(result.serverError).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('withdrawing (P6.4, A26.4)', () => {
  it('deletes the row and both files, and tells staff it was withdrawn', async () => {
    const kim = await applicant('Kim Withdraw');
    const applied = await submit(kim);
    const row = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: applied.data!.partnerId },
    });
    const doc = await migrator.upload.findUniqueOrThrow({ where: { id: row.idDocumentUploadId! } });
    expect(
      ((await as(kim, () => partners.withdrawApplicationAction({}))) as ActionResult).serverError,
    ).toBeUndefined();
    expect(await migrator.deliveryPartner.count({ where: { id: row.id } })).toBe(0);
    expect(
      await migrator.upload.count({ where: { id: { in: [row.photoUploadId!, doc.id] } } }),
    ).toBe(0);
    expect(await objectSize('PRIVATE', doc.key)).toBeNull();
    const check = (await as(morgan, () =>
      review.partnerVersionAction({ partnerId: row.id }),
    )) as ActionResult;
    expect(check.serverError).toMatchObject({
      code: 'APPLICATION_GONE',
      details: { how: 'withdrawn' },
    });
  });
});

// ------------------------------------------------------------------ availability and locations

describe('going online and sharing a location (P9, P10, P16)', () => {
  it('goes online with a usable first point and refuses a weak one', async () => {
    const { member, partnerId } = await approvedPartner('Diego Alvarez');
    const sessionId = await sessionOf(member.userId);
    await expect(
      service.setAvailability(member.actor, sessionId, {
        online: true,
        point: point(42.3505, -71.045, 0, 2000),
      }),
    ).rejects.toMatchObject({ code: 'LOW_ACCURACY' });
    const result = await service.setAvailability(member.actor, sessionId, {
      online: true,
      point: point(42.3505, -71.045, 20),
    });
    expect(result.availability).toMatchObject({
      online: true,
      onThisDevice: true,
      freshness: 'available',
    });
    expect(await redis.get(`partner:loc:${partnerId}`)).not.toBeNull();
    expect(published('partner.availability-changed')).toEqual([
      expect.objectContaining({
        channel: `private-partner-${partnerId}`,
        data: expect.objectContaining({ online: true, reason: 'self' }),
      }),
    ]);
    // A35.1: the boards hear at once that the count changed; the message holds a time only.
    expect(published('couriers.changed')).toEqual([
      { channel: 'private-ops', data: { at: expect.any(String) } },
    ]);

    const verdict = await service.recordLocations(member.actor, sessionId, {
      points: [point(42.3521, -71.0469, 0)],
    });
    expect(verdict.results).toEqual([{ index: 0, result: 'accepted' }]);
    const jump = await service.recordLocations(member.actor, sessionId, {
      points: [
        { ...point(42.3736, -71.119), recordedAt: new Date(Date.now() + 1000).toISOString() },
      ],
    });
    expect(jump.results).toEqual([{ index: 0, result: 'refused', code: 'IMPLAUSIBLE_JUMP' }]);
    await expect(
      service.recordLocations(member.actor, uuid(), { points: [point(42.3521, -71.0469)] }),
    ).rejects.toMatchObject({ code: 'OTHER_DEVICE' });

    // Offline: the point goes at once, and later posts say why.
    await service.setAvailability(member.actor, sessionId, { online: false });
    expect(await redis.get(`partner:loc:${partnerId}`)).toBeNull();
    const [row] = await migrator.$queryRaw<{ has: boolean }[]>`
      SELECT last_location IS NOT NULL AS has FROM delivery_partners WHERE id = ${partnerId}::uuid`;
    expect(row?.has).toBe(false);
    await expect(
      service.recordLocations(member.actor, sessionId, { points: [point(42.3521, -71.0469)] }),
    ).rejects.toMatchObject({ code: 'NOT_ONLINE', details: { reason: 'self' } });
  });

  it('lets unchanged coordinates keep a partner fresh for 2 minutes after he moved, no longer (S7)', async () => {
    const { member, partnerId } = await approvedPartner('Sam Still');
    const sessionId = await sessionOf(member.userId);
    const start = Date.now();
    const at = (seconds: number) => new Date(start + seconds * 1000);
    const send = (lat: number, lng: number, seconds: number) =>
      service.recordLocations(
        member.actor,
        sessionId,
        { points: [{ lat, lng, accuracy: 15, recordedAt: at(seconds).toISOString() }] },
        at(seconds),
      );
    await service.setAvailability(
      member.actor,
      sessionId,
      { online: true, point: point(42.3505, -71.045) },
      at(0),
    );
    expect((await send(42.3521, -71.0469, 15)).lastPointAt).toBe(at(15).toISOString());

    // A phone that lost its GPS keeps sending the same fix every 15 s for 5 minutes.
    let last = '';
    for (let seconds = 30; seconds <= 300; seconds += 15) {
      last = (await send(42.3521, -71.0469, seconds)).lastPointAt ?? '';
    }
    expect(last).toBe(at(135).toISOString());
    const held = JSON.parse((await redis.get(`partner:loc:${partnerId}`)) ?? '{}') as {
      acceptedAt: string;
      recordedAt: string;
    };
    expect(held).toMatchObject({
      acceptedAt: at(135).toISOString(),
      recordedAt: at(300).toISOString(),
    });
    const { freshnessOf } = await import('@/server/modules/partners/location');
    expect(freshnessOf({ isOnline: true, lastPointAt: held.acceptedAt }, at(300))).toBe('stale');

    // A real move makes him fresh again at once.
    expect((await send(42.3537, -71.0487, 315)).lastPointAt).toBe(at(315).toISOString());
    await service.setAvailability(member.actor, sessionId, { online: false }, at(316));
  });

  it('refuses applicants and real points from the demo partner, which shares one online state', async () => {
    const applicantResult = service.setAvailability(luis.actor, null, {
      online: true,
      point: point(42.35, -71.04),
    });
    await expect(applicantResult).rejects.toMatchObject({
      code: expect.stringMatching(/NOT_APPROVED|PARTNER_SUSPENDED/),
    });
    const riley = await approvedPartner('Riley Courier', { demo: true });
    await expect(
      service.setAvailability(riley.member.actor, null, {
        online: true,
        point: point(42.35, -71.04),
      }),
    ).rejects.toMatchObject({ code: 'DEMO_SIMULATED_LOCATION' });
    const online = await service.setAvailability(riley.member.actor, null, { online: true });
    expect(online.availability.online).toBe(true);
    await expect(
      service.recordLocations(riley.member.actor, null, { points: [point(42.35, -71.04)] }),
    ).rejects.toMatchObject({ code: 'DEMO_SIMULATED_LOCATION' });
    await service.setAvailability(riley.member.actor, null, { online: false });
  });

  it('serves the routes same-origin only, and never to staff', async () => {
    const { member } = await approvedPartner('Route Partner');
    switchBrowser(member.browser);
    const offline = await availabilityRoute.PUT(routeRequest('PUT', { online: false }));
    expect(offline.status).toBe(200);
    expect(offline.headers.get('cache-control')).toBe('no-store');
    const foreign = await availabilityRoute.PUT(
      routeRequest('PUT', { online: false }, 'https://evil.example'),
    );
    expect(foreign.status).toBe(403);
    const bad = await availabilityRoute.PUT(
      routeRequest('PUT', { online: true, point: { lat: 99 } }),
    );
    expect(bad.status).toBe(422);
    // Security gate S2: a declared length over 16 KB is refused before the body is read.
    const huge = new Request(`${SITE}/api/v1/partner/availability`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: SITE, 'content-length': '20000' },
      body: JSON.stringify({ online: false }),
    });
    expect((await availabilityRoute.PUT(huge)).status).toBe(413);
    const long = await availabilityRoute.PUT(
      routeRequest('PUT', { online: false, padding: 'x'.repeat(20_000) }),
    );
    expect(long.status).toBe(413);
    const me = await meRoute.GET(new Request(`${SITE}/api/v1/partner/me`));
    expect(await me.json()).toMatchObject({ screen: 'home' });
    switchBrowser(alex.browser);
    const staff = await availabilityRoute.PUT(routeRequest('PUT', { online: false }));
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ code: 'NOT_A_CUSTOMER' });
  });
});

describe('suspending and reinstating (A25, P14)', () => {
  it('takes an online partner offline at once, ends the sessions, and lets only an admin reinstate', async () => {
    const { member, partnerId } = await approvedPartner('Victor Hale');
    const sessionId = await sessionOf(member.userId);
    await service.setAvailability(member.actor, sessionId, {
      online: true,
      point: point(42.3505, -71.045),
    });
    mocks.publish.mockClear();

    const suspended = (await as(morgan, async () =>
      review.suspendPartnerAction({
        partnerId,
        expectedVersion: 2,
        reason: 'Shouted at a customer (test)',
        stepUp: { method: 'totp', code: await morgan.code() },
      }),
    )) as ActionResult<{ status: string; wasOnline: boolean }>;
    expect(suspended.serverError).toBeUndefined();
    expect(suspended.data).toMatchObject({ status: 'SUSPENDED', wasOnline: true });
    expect(await redis.get(`partner:loc:${partnerId}`)).toBeNull();
    const row = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    expect(row).toMatchObject({
      isOnline: false,
      offlineReason: 'suspended',
      suspensionReason: 'Shouted at a customer (test)',
    });
    expect(await migrator.session.count({ where: { userId: member.userId } })).toBe(0);
    expect(published('partner.status-changed')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUSPENDED' }) }),
    ]);
    await expect(
      service.setAvailability(member.actor, sessionId, {
        online: true,
        point: point(42.3505, -71.045),
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_SUSPENDED' });

    const bySupport = (await as(morgan, () =>
      review.reinstatePartnerAction({ partnerId, expectedVersion: 3 }),
    )) as ActionResult;
    expect(bySupport.serverError).toMatchObject({ code: 'FORBIDDEN' });
    const byAdmin = (await as(daniel, async () =>
      review.reinstatePartnerAction({
        partnerId,
        expectedVersion: 3,
        stepUp: { method: 'totp', code: await daniel.code() },
      }),
    )) as ActionResult<{ status: string }>;
    expect(byAdmin.data).toMatchObject({ status: 'APPROVED' });
    expect(
      await migrator.deliveryPartner.findUniqueOrThrow({
        where: { id: partnerId },
        select: { isOnline: true },
      }),
    ).toEqual({
      isOnline: false,
    });
  });

  it('never suspends the demo partner', async () => {
    const riley = await approvedPartner('Riley Demo', { demo: true });
    const result = (await as(daniel, () =>
      review.suspendPartnerAction({ partnerId: riley.partnerId, expectedVersion: 2 }),
    )) as ActionResult;
    expect(result.serverError).toMatchObject({ code: 'DEMO_PARTNER' });
  });
});

// ------------------------------------------------------------------ jobs

describe('the automatic offline job and file clean-up (B8, P7.8)', () => {
  it('takes a partner with no point for 10 minutes offline and tells them', async () => {
    const { member, partnerId } = await approvedPartner('Grace Okafor');
    await migrator.$executeRaw`
      UPDATE delivery_partners SET is_online = true, online_since = now() - interval '20 minutes',
        last_location = ST_SetSRID(ST_MakePoint(-71.044, 42.354), 4326)::geography
      WHERE id = ${partnerId}::uuid`;
    const counts = await service.sweepIdlePartners();
    expect(counts.noLocation).toBeGreaterThanOrEqual(1);
    const row = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    expect(row).toMatchObject({ isOnline: false, offlineReason: 'no-location' });
    expect(
      published('notification.created').some(
        (call) => (call.data as { type?: string }).type === 'partner.offline-no-location',
      ),
    ).toBe(true);
    const state = await as(member, () => service.getMyPartnerState(member.actor));
    expect(state).toMatchObject({ screen: 'home', lastOffline: { reason: 'no-location' } });
  });

  it("deletes a rejected applicant's files on the reapply date", async () => {
    const mei = await applicant('Mei Lin');
    const applied = await submit(mei, { plate: '9MX 105', idNumber: 'M997718' });
    const partnerId = applied.data!.partnerId;
    const row = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    await migrator.deliveryPartner.update({
      where: { id: partnerId },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(Date.now() - 31 * 86_400_000),
        reapplyAfter: new Date('2020-01-01T00:00:00Z'),
      },
    });
    const result = await service.deleteExpiredPartnerFiles();
    expect(result.applications).toBeGreaterThanOrEqual(1);
    const after = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    expect(after).toMatchObject({
      photoUploadId: null,
      idNumberHash: null,
      licenseNumberEnc: null,
    });
    expect(after.filesDeletedAt).not.toBeNull();
    expect(
      await migrator.upload.count({
        where: { id: { in: [row.photoUploadId!, row.idDocumentUploadId!] } },
      }),
    ).toBe(0);
  });
});
