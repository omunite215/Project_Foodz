import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import type { PrismaClient } from '../../server/db/generated/client';

/*
 * The partner fixtures (F6 story "Seed data" and "Admin fixtures"): applicants and partners in
 * every state, with the history each state implies, placed relative to the moment they are
 * seeded. Local and CI databases only, beside the sample accounts. Their ID numbers are
 * encrypted and hashed with the local keys; their photos and documents are drawn placeholders
 * ("SAMPLE ID — NOT A REAL DOCUMENT"), never real IDs. `npm run seed:partners` puts them back.
 */

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const NAMESPACE = '8c1d7a52-5b1e-4f0e-9a37-2f4b9d0c6e11';
const seedId = (name: string) => uuidv5(name, NAMESPACE);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FIXTURE_KEYS = [
  'ana',
  'kwame',
  'jonas',
  'mei',
  'diego',
  'grace',
  'victor',
  'nora',
  'sam',
  'luis',
  'omar',
  'lena',
] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];

/** The fixtures' account ids from a map by key, refusing a missing one. */
export function fixtureAccounts(
  ids: Record<string, string | undefined>,
): Record<FixtureKey, string> {
  const get = (key: FixtureKey) => {
    const id = ids[key];
    if (!id) throw new Error(`The partner fixture account "${key}" is missing.`);
    return id;
  };
  return {
    ana: get('ana'),
    kwame: get('kwame'),
    jonas: get('jonas'),
    mei: get('mei'),
    diego: get('diego'),
    grace: get('grace'),
    victor: get('victor'),
    nora: get('nora'),
    sam: get('sam'),
    luis: get('luis'),
    omar: get('omar'),
    lena: get('lena'),
  };
}

export interface PartnerAccount {
  key: FixtureKey | 'marco';
  email: string;
  name: string;
  role: 'customer' | 'partner';
  phone: string;
  banned: boolean;
  banReason: string | null;
}

/** Sample accounts for F6 (local and CI only), with the per-run sample password. */
export const PARTNER_ACCOUNTS: readonly PartnerAccount[] = [
  {
    key: 'marco',
    email: 'applying.customer@foodz.example',
    name: 'Marco Bianchi',
    role: 'customer',
    phone: '+16175550134',
    banned: false,
    banReason: null,
  },
  {
    key: 'ana',
    email: 'pending.partner@foodz.example',
    name: 'Ana Souza',
    role: 'customer',
    phone: '+16175550161',
    banned: false,
    banReason: null,
  },
  {
    key: 'kwame',
    email: 'changes.partner@foodz.example',
    name: 'Kwame Mensah',
    role: 'customer',
    phone: '+16175550162',
    banned: false,
    banReason: null,
  },
  {
    key: 'jonas',
    email: 'rejected.partner@foodz.example',
    name: 'Jonas Weber',
    role: 'customer',
    phone: '+16175550163',
    banned: false,
    banReason: null,
  },
  {
    key: 'mei',
    email: 'reapply.partner@foodz.example',
    name: 'Mei Lin',
    role: 'customer',
    phone: '+16175550164',
    banned: false,
    banReason: null,
  },
  {
    key: 'diego',
    email: 'approved.partner@foodz.example',
    name: 'Diego Alvarez',
    role: 'partner',
    phone: '+16175550165',
    banned: false,
    banReason: null,
  },
  {
    key: 'grace',
    email: 'stale.partner@foodz.example',
    name: 'Grace Okafor',
    role: 'partner',
    phone: '+16175550166',
    banned: false,
    banReason: null,
  },
  {
    key: 'victor',
    email: 'suspended.partner@foodz.example',
    name: 'Victor Hale',
    role: 'partner',
    phone: '+16175550167',
    banned: false,
    banReason: null,
  },
  {
    key: 'nora',
    email: 'banned.partner@foodz.example',
    name: 'Nora Quinn',
    role: 'partner',
    phone: '+16175550168',
    banned: true,
    banReason: 'Fraudulent cash collection (test account)',
  },
  {
    key: 'sam',
    email: 'flagged.partner@foodz.example',
    name: 'Sam Rivera',
    role: 'customer',
    phone: '+16175550188',
    banned: false,
    banReason: null,
  },
  // F7: approved couriers for the dispatch stories (offline until someone goes online).
  {
    key: 'luis',
    email: 'luis.partner@foodz.example',
    name: 'Luis Moreno',
    role: 'partner',
    phone: '+16175550171',
    banned: false,
    banReason: null,
  },
  {
    key: 'omar',
    email: 'omar.partner@foodz.example',
    name: 'Omar Haddad',
    role: 'partner',
    phone: '+16175550172',
    banned: false,
    banReason: null,
  },
  {
    key: 'lena',
    email: 'lena.partner@foodz.example',
    name: 'Lena Fischer',
    role: 'partner',
    phone: '+16175550173',
    banned: false,
    banReason: null,
  },
];

export const partnerFixtureId = (key: FixtureKey) => seedId(`partner:${key}`);
const uploadId = (key: FixtureKey, kind: 'photo' | 'id') => seedId(`partner-upload:${key}:${kind}`);
const photoKey = (key: FixtureKey) => `partner-photo/${uploadId(key, 'photo')}.webp`;
const documentKey = (key: FixtureKey) => `partner-document/${uploadId(key, 'id')}.webp`;

export interface PartnerSeedKeys {
  /** FIELD_ENCRYPTION_KEY and ID_NUMBER_HASH_KEY (base64, 32 bytes each). */
  field: string;
  hash: string;
}

export interface PartnerSeedPeople {
  accounts: Record<FixtureKey, string>;
  morgan: { id: string; name: string };
  admin: { id: string; name: string };
}

/** The image files a run needs in the private bucket, written outside the transaction. */
export interface FixtureImage {
  key: string;
  kind: 'photo' | 'id';
  name: string;
  documentLine: string;
}

// Same format and context as server/security/field-encryption.ts.
function encrypt(plaintext: string, context: string, keyBase64: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

// Same as server/security/keyed-hash.ts.
const hashNumber = (number: string, keyBase64: string) =>
  createHmac('sha256', Buffer.from(keyBase64, 'base64'))
    .update(`id-number:${number}`)
    .digest('base64url');

const day = (at: number) => new Date(new Date(at).toISOString().slice(0, 10) + 'T00:00:00Z');
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

interface Fixture {
  key: FixtureKey;
  status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  vehicle: 'BICYCLE' | 'SCOOTER' | 'MOTORBIKE' | 'CAR';
  plate: string | null;
  document: 'DRIVER_LICENSE' | 'STATE_ID' | 'PASSPORT';
  number: string;
  expires: (now: number) => Date;
  submitted: number;
  files: boolean;
}

const FIXTURES: Fixture[] = [
  {
    key: 'ana',
    status: 'APPLIED',
    vehicle: 'SCOOTER',
    plate: '7KT 219',
    document: 'DRIVER_LICENSE',
    number: 'D7734407',
    expires: () => new Date('2028-08-14T00:00:00Z'),
    submitted: DAY + 20 * MINUTE,
    files: true,
  },
  {
    key: 'kwame',
    status: 'APPLIED',
    vehicle: 'BICYCLE',
    plate: null,
    document: 'STATE_ID',
    number: 'SID229133',
    expires: () => new Date('2030-06-30T00:00:00Z'),
    submitted: DAY + 21 * HOUR + 50 * MINUTE,
    files: true,
  },
  {
    key: 'sam',
    status: 'APPLIED',
    vehicle: 'CAR',
    plate: '6VH 450',
    document: 'DRIVER_LICENSE',
    number: 'N4445521',
    expires: (now) => plusDays(day(now), 20),
    submitted: 3 * DAY + 8 * HOUR + 45 * MINUTE,
    files: true,
  },
  {
    key: 'jonas',
    status: 'REJECTED',
    vehicle: 'CAR',
    plate: '4PL 770',
    document: 'DRIVER_LICENSE',
    number: 'L5523302',
    expires: () => new Date('2029-01-15T00:00:00Z'),
    submitted: 4 * DAY + 4 * HOUR,
    files: true,
  },
  {
    key: 'mei',
    status: 'REJECTED',
    vehicle: 'MOTORBIKE',
    plate: null,
    document: 'DRIVER_LICENSE',
    number: 'M997718',
    expires: () => new Date('2028-11-30T00:00:00Z'),
    submitted: 32 * DAY,
    files: false,
  },
  {
    key: 'diego',
    status: 'APPROVED',
    vehicle: 'MOTORBIKE',
    plate: '2FD 881',
    document: 'DRIVER_LICENSE',
    number: 'D4426650',
    expires: () => new Date('2029-05-01T00:00:00Z'),
    submitted: 16 * DAY,
    files: true,
  },
  {
    key: 'grace',
    status: 'APPROVED',
    vehicle: 'BICYCLE',
    plate: null,
    document: 'PASSPORT',
    number: 'P5550921',
    expires: () => new Date('2031-02-02T00:00:00Z'),
    submitted: 21 * DAY,
    files: true,
  },
  {
    key: 'victor',
    status: 'SUSPENDED',
    vehicle: 'CAR',
    plate: '6VH 450',
    document: 'DRIVER_LICENSE',
    number: 'V8811184',
    expires: () => new Date('2028-03-03T00:00:00Z'),
    submitted: 51 * DAY,
    files: true,
  },
  {
    key: 'nora',
    status: 'APPROVED',
    vehicle: 'SCOOTER',
    plate: '1NQ 772',
    document: 'DRIVER_LICENSE',
    number: 'N4445521',
    expires: () => new Date('2028-09-09T00:00:00Z'),
    submitted: 68 * DAY,
    files: true,
  },
  {
    key: 'luis',
    status: 'APPROVED',
    vehicle: 'SCOOTER',
    plate: '7KT 342',
    document: 'DRIVER_LICENSE',
    number: 'L3342190',
    expires: () => new Date('2029-07-12T00:00:00Z'),
    submitted: 40 * DAY,
    files: true,
  },
  {
    key: 'omar',
    status: 'APPROVED',
    vehicle: 'CAR',
    plate: '5OH 318',
    document: 'DRIVER_LICENSE',
    number: 'H5318822',
    expires: () => new Date('2030-03-21T00:00:00Z'),
    submitted: 90 * DAY,
    files: true,
  },
  {
    key: 'lena',
    status: 'APPROVED',
    vehicle: 'BICYCLE',
    plate: null,
    document: 'PASSPORT',
    number: 'C7781934',
    expires: () => new Date('2032-10-05T00:00:00Z'),
    submitted: 25 * DAY,
    files: true,
  },
];

const nameOf = (key: FixtureKey) =>
  PARTNER_ACCOUNTS.find((account) => account.key === key)?.name ?? key;

const DOCUMENT_WORDS = {
  DRIVER_LICENSE: "Driver's license",
  STATE_ID: 'State ID card',
  PASSPORT: 'Passport',
};

/** The images every fixture with files needs (A29.2): an illustrated avatar and a drawn ID. */
export function partnerFixtureImages(): FixtureImage[] {
  return FIXTURES.flatMap((fixture) =>
    !fixture.files
      ? []
      : [
          {
            key: photoKey(fixture.key),
            kind: 'photo' as const,
            name: nameOf(fixture.key),
            documentLine: '',
          },
          {
            key: documentKey(fixture.key),
            kind: 'id' as const,
            name: nameOf(fixture.key),
            documentLine: `${DOCUMENT_WORDS[fixture.document]} ending ${fixture.number.slice(-4)}`,
          },
        ],
  );
}

/**
 * Puts every fixture back to its state and relative dates: the rows, the uploads that point at
 * the drawn images, the encrypted numbers and the history. Touches no other partner. Returns
 * how many fixtures it wrote.
 */
export async function resetPartnerFixtures(
  tx: Tx,
  people: PartnerSeedPeople,
  keys: PartnerSeedKeys,
  now: Date,
): Promise<number> {
  const t = now.getTime();
  const ids = FIXTURES.map((fixture) => partnerFixtureId(fixture.key));
  // F7: no fixture keeps an order or an offer across a reset (offers go with the rows).
  await tx.$executeRaw`
    UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, assigned_at = NULL
    WHERE partner_id = ANY (${ids}::uuid[])`;
  await tx.deliveryPartner.deleteMany({ where: { id: { in: ids } } });
  await tx.upload.deleteMany({
    where: {
      id: {
        in: FIXTURES.flatMap((fixture) => [
          uploadId(fixture.key, 'photo'),
          uploadId(fixture.key, 'id'),
        ]),
      },
    },
  });

  const morgan = {
    kind: 'staff',
    id: people.morgan.id,
    name: people.morgan.name,
    role: 'support',
  } as const;
  const admin = {
    kind: 'staff',
    id: people.admin.id,
    name: people.admin.name,
    role: 'admin',
  } as const;

  for (const fixture of FIXTURES) {
    const id = partnerFixtureId(fixture.key);
    const userId = people.accounts[fixture.key];
    const submittedAt = new Date(t - fixture.submitted);
    if (fixture.files) {
      for (const kind of ['photo', 'id'] as const) {
        await tx.upload.create({
          data: {
            id: uploadId(fixture.key, kind),
            key: kind === 'photo' ? photoKey(fixture.key) : documentKey(fixture.key),
            bucket: 'PRIVATE',
            purpose: kind === 'photo' ? 'PARTNER_PHOTO' : 'PARTNER_DOCUMENT',
            status: 'READY',
            ownerId: userId,
            contentType: 'image/webp',
            sizeBytes: 1,
            processedAt: submittedAt,
            createdAt: submittedAt,
          },
        });
      }
    }

    const history: {
      type: string;
      at: number;
      actor: typeof morgan | typeof admin | { kind: 'applicant'; id: string } | { kind: 'system' };
      applicantText?: string | null;
      staffNote?: string | null;
      changedParts?: string[];
    }[] = [
      { type: 'applied', at: t - fixture.submitted, actor: { kind: 'applicant', id: userId } },
    ];
    const row: Record<string, unknown> = {};

    switch (fixture.key) {
      case 'kwame': {
        const sentBack = t - (DAY + 7 * HOUR + 30 * MINUTE);
        const message =
          'The photo of your ID is blurry. Please take a new one in good light, with all four corners showing.';
        Object.assign(row, {
          changesRequestedAt: new Date(sentBack),
          changesRequestedNote: message,
          changesRequestedBy: morgan.id,
        });
        history.push({ type: 'sent-back', at: sentBack, actor: morgan, applicantText: message });
        break;
      }
      case 'jonas': {
        const decided = t - (3 * DAY + 7 * HOUR);
        const reason = "We couldn't match the name on your ID to your account name.";
        Object.assign(row, {
          decidedAt: new Date(decided),
          decidedBy: admin.id,
          decisionReason: reason,
          reapplyAfter: plusDays(day(decided - 5 * HOUR), 30),
        });
        history.push({
          type: 'rejected',
          at: decided,
          actor: admin,
          applicantText: reason,
          staffNote: 'License reads Jonas Webber; account says Jonas Weber.',
        });
        break;
      }
      case 'mei': {
        const decided = t - 31 * DAY;
        const deleted = t - DAY;
        Object.assign(row, {
          decidedAt: new Date(decided),
          decidedBy: admin.id,
          reapplyAfter: plusDays(day(decided - 5 * HOUR), 30),
          filesDeletedAt: new Date(deleted),
        });
        history.push(
          {
            type: 'rejected',
            at: decided,
            actor: admin,
            staffNote: "Couldn't read the license number.",
          },
          { type: 'files-deleted', at: deleted, actor: { kind: 'system' } },
        );
        break;
      }
      case 'diego': {
        const approved = t - 14 * DAY;
        Object.assign(row, {
          approvedAt: new Date(approved),
          decidedAt: new Date(approved),
          decidedBy: morgan.id,
          welcomedAt: new Date(approved),
        });
        history.push({ type: 'approved', at: approved, actor: morgan });
        break;
      }
      case 'grace': {
        const approved = t - 18 * DAY;
        Object.assign(row, {
          approvedAt: new Date(approved),
          decidedAt: new Date(approved),
          decidedBy: admin.id,
          welcomedAt: new Date(approved),
          isOnline: true,
          onlineSince: new Date(t - HOUR),
          lastSeenAt: new Date(t - 11 * MINUTE),
        });
        history.push({ type: 'approved', at: approved, actor: admin });
        break;
      }
      case 'victor': {
        const approved = t - 50 * DAY;
        const suspended = t - (DAY + 2 * HOUR);
        const reason = 'Repeated late deliveries (test account)';
        Object.assign(row, {
          approvedAt: new Date(approved),
          decidedAt: new Date(suspended),
          decidedBy: admin.id,
          suspendedAt: new Date(suspended),
          suspensionReason: reason,
          welcomedAt: new Date(approved),
          offlineReason: 'suspended',
          offlineAt: new Date(suspended),
        });
        history.push(
          { type: 'approved', at: approved, actor: admin },
          {
            type: 'suspended',
            at: suspended,
            actor: admin,
            applicantText: reason,
            staffNote: 'Three late-delivery complaints this week (test).',
          },
        );
        break;
      }
      case 'nora': {
        const approved = t - 67 * DAY;
        Object.assign(row, {
          approvedAt: new Date(approved),
          decidedAt: new Date(approved),
          decidedBy: admin.id,
          welcomedAt: new Date(approved),
        });
        history.push({ type: 'approved', at: approved, actor: admin });
        break;
      }
      case 'luis':
      case 'omar':
      case 'lena': {
        const approved = t - fixture.submitted + 2 * DAY;
        Object.assign(row, {
          approvedAt: new Date(approved),
          decidedAt: new Date(approved),
          decidedBy: morgan.id,
          welcomedAt: new Date(approved),
          ...(fixture.key === 'omar' && {
            ratingAvg: 4.6,
            ratingCount: 31,
            ratingBaseAvg: 4.6,
            ratingBaseCount: 31,
          }),
        });
        history.push({ type: 'approved', at: approved, actor: morgan });
        break;
      }
      default:
        break;
    }

    await tx.deliveryPartner.create({
      data: {
        id,
        userId,
        status: fixture.status,
        vehicleType: fixture.vehicle,
        vehiclePlate: fixture.files ? fixture.plate : null,
        licenseNumberEnc: fixture.files
          ? encrypt(fixture.number, `delivery_partners.license_number:${id}`, keys.field)
          : null,
        idNumberHash: fixture.files ? hashNumber(fixture.number, keys.hash) : null,
        idNumberLast4: fixture.files ? fixture.number.slice(-4) : null,
        idDocumentType: fixture.document,
        idDocumentExpiresOn: fixture.expires(t),
        photoUploadId: fixture.files ? uploadId(fixture.key, 'photo') : null,
        idDocumentUploadId: fixture.files ? uploadId(fixture.key, 'id') : null,
        submittedAt,
        partnerTermsVersion: 1,
        partnerTermsAcceptedAt: submittedAt,
        adultConfirmedAt: submittedAt,
        version: history.length,
        ...row,
      },
    });
    if (fixture.key === 'grace') {
      // About 400 m from the kitchen; no live point, so the job takes her offline within a minute.
      await tx.$executeRaw`UPDATE delivery_partners SET last_location = ST_SetSRID(ST_MakePoint(-71.044, 42.354), 4326)::geography WHERE id = ${id}::uuid`;
    }
    for (const [index, entry] of history.entries()) {
      await tx.partnerApplicationEvent.create({
        data: {
          id: seedId(`partner-event:${fixture.key}:${index}`),
          partnerId: id,
          type: entry.type,
          actorKind: entry.actor.kind,
          actorId: entry.actor.kind === 'system' ? null : entry.actor.id,
          actorName: entry.actor.kind === 'staff' ? entry.actor.name : null,
          actorRole: entry.actor.kind === 'staff' ? entry.actor.role : null,
          at: new Date(entry.at),
          applicantText: entry.applicantText ?? null,
          staffNote: entry.staffNote ?? null,
          changedParts: entry.changedParts ?? [],
          versionAfter: index + 1,
        },
      });
    }
  }
  return FIXTURES.length;
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** An illustrated avatar (initials on a colored disc) or a drawn sample ID card, as SVG. */
export function fixtureImageSvg(image: FixtureImage): string {
  const initials = image.name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2);
  if (image.kind === 'photo') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#d3f9d5"/><circle cx="256" cy="200" r="96" fill="#04b90b"/><rect x="112" y="320" width="288" height="160" rx="80" fill="#04b90b"/><text x="256" y="230" font-family="Arial" font-size="80" fill="#ffffff" text-anchor="middle">${escape(initials)}</text></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="756"><rect width="1200" height="756" rx="40" fill="#f4f5f6" stroke="#777e90" stroke-width="6"/><rect x="60" y="160" width="300" height="380" rx="20" fill="#e6e8ec"/><text x="600" y="110" font-family="Arial" font-size="56" fill="#d12b4f" text-anchor="middle">SAMPLE ID — NOT A REAL DOCUMENT</text><text x="420" y="260" font-family="Arial" font-size="52" fill="#23262f">${escape(image.name)}</text><text x="420" y="350" font-family="Arial" font-size="40" fill="#353945">${escape(image.documentLine)}</text><text x="420" y="430" font-family="Arial" font-size="36" fill="#777e90">Drawn for testing. Not issued by anyone.</text></svg>`;
}

/**
 * F8 (U14, L13.2): Jamie, the demo courier the demo run drives. A demo account with no
 * credential (nobody signs in as him) and a bot partner row; any half-done demo run ends.
 */
export async function ensureDemoCourier(tx: Tx): Promise<string> {
  const user = await tx.user.upsert({
    where: { email: 'demo.courier@foodz.example' },
    create: {
      id: seedId('user:demo-courier'),
      email: 'demo.courier@foodz.example',
      name: 'Jamie Courier',
      role: 'partner',
      isDemo: true,
      emailVerified: true,
    },
    update: { name: 'Jamie Courier', role: 'partner', isDemo: true },
    select: { id: true },
  });
  await tx.account.deleteMany({ where: { userId: user.id } });
  await tx.$executeRaw`
    UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, assigned_at = NULL
    WHERE partner_id IN (SELECT id FROM delivery_partners WHERE user_id = ${user.id}::uuid)
      AND status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')`;
  await tx.demoRun.updateMany({ where: { status: 'running' }, data: { status: 'failed' } });
  const approvedAt = new Date('2026-11-01T15:00:00Z');
  const partner = await tx.deliveryPartner.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      status: 'APPROVED',
      vehicleType: 'SCOOTER',
      vehiclePlate: 'DEMO 01',
      isBot: true,
      approvedAt,
      decidedAt: approvedAt,
      welcomedAt: approvedAt,
      submittedAt: approvedAt,
      version: 2,
    },
    update: {
      status: 'APPROVED',
      isBot: true,
      isOnline: false,
      onlineSince: null,
      onlineSessionId: null,
    },
    select: { id: true },
  });
  await tx.$executeRaw`UPDATE delivery_partners SET last_location = NULL WHERE id = ${partner.id}::uuid`;
  return partner.id;
}
