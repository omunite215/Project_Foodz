import type { HistoryEntry, PartnerReview } from '@/server/modules/partners/review-schema';

/*
 * The story's people for the staff review's stories (F6 admin fixtures): Sam Rivera with three
 * flags, as Morgan (SUPPORT) sees the application. No real person, no real ID.
 */

export const TZ = 'America/New_York';

const MORGAN = { kind: 'staff', name: 'Morgan Diaz', role: 'support' } as const;

export const HISTORY: HistoryEntry[] = [
  {
    id: 'h1',
    type: 'applied',
    at: '2026-11-17T14:15:00Z',
    actor: { kind: 'applicant' },
    applicantText: null,
    staffNote: null,
    changedParts: [],
    masked: false,
  },
  {
    id: 'h2',
    type: 'sent-back',
    at: '2026-11-18T15:30:00Z',
    actor: MORGAN,
    applicantText:
      'The photo of your ID is blurry. Please take a new one in good light, with all four corners showing.',
    staffNote: 'Glare over the date.',
    changedParts: [],
    masked: false,
  },
  {
    id: 'h3',
    type: 'fixed',
    at: '2026-11-20T23:05:00Z',
    actor: { kind: 'applicant' },
    applicantText: null,
    staffNote: null,
    changedParts: ['idPhoto'],
    masked: false,
  },
];

export const SAM: PartnerReview = {
  partnerId: '01937c4a-0000-7000-8000-00000000d001',
  version: 3,
  asOf: '2026-11-20T23:00:00Z',
  status: 'APPLIED',
  tab: 'review',
  statusWords: 'To review',
  name: 'Sam Rivera',
  firstName: 'Sam',
  email: 'flagged.partner@foodz.example',
  phone: { e164: '+16175550188', display: '(617) 555-0188' },
  customer: { since: '2026-11-16T15:00:00Z', orderCount: 0 },
  submittedAt: '2026-11-17T14:15:00Z',
  updatedAt: '2026-11-20T23:05:00Z',
  waiting: { tone: 'red', words: 'Over 2 working days', detail: 'waiting 3 days' },
  vehicle: { type: 'CAR', words: 'Car', plate: '6VH 450' },
  document: {
    type: 'DRIVER_LICENSE',
    typeWords: "Driver's license",
    last4: '5521',
    expiresOn: '2026-12-10',
    expiresInDays: 20,
  },
  agreed: {
    termsVersion: 1,
    acceptedAt: '2026-11-17T14:15:00Z',
    adultConfirmedAt: '2026-11-17T14:15:00Z',
  },
  images: { photo: { state: 'checking' }, idFront: { state: 'missing' } },
  flags: [
    {
      kind: 'samePlate',
      plate: '6VH 450',
      others: [
        {
          partnerId: '01937c4a-0000-7000-8000-00000000d002',
          name: 'Victor Hale',
          status: 'SUSPENDED',
          banned: false,
          decidedAt: '2026-11-19T21:00:00Z',
        },
      ],
    },
    {
      kind: 'sameIdNumber',
      others: [
        {
          partnerId: '01937c4a-0000-7000-8000-00000000d003',
          name: 'Nora Quinn',
          status: 'APPROVED',
          banned: true,
          decidedAt: '2026-11-06T15:00:00Z',
        },
      ],
    },
    { kind: 'expiresSoon', documentType: 'DRIVER_LICENSE', expiresOn: '2026-12-10', inDays: 20 },
  ],
  decision: {
    sentBack: null,
    fixedAt: null,
    decided: null,
    applicantText: null,
    reapplyFrom: null,
    filesDeleteOn: null,
    filesDeletedAt: null,
  },
  online: null,
  partnerSince: null,
  banned: null,
  isDemoPartner: false,
  actions: [
    { action: 'approve', display: 'button', enabled: true, reason: null, stepUp: true },
    { action: 'sendBack', display: 'button', enabled: true, reason: null, stepUp: false },
    { action: 'reject', display: 'button', enabled: true, reason: null, stepUp: false },
  ],
  stepUpRequired: true,
  changedParts: [],
  history: HISTORY,
  masked: { applicant: false, vehicle: false, document: false, texts: false },
};

export const DIEGO: PartnerReview = {
  ...SAM,
  partnerId: '01937c4a-0000-7000-8000-00000000d004',
  status: 'APPROVED',
  tab: 'approved',
  statusWords: 'Approved',
  name: 'Diego Alvarez',
  firstName: 'Diego',
  flags: [],
  waiting: null,
  online: {
    state: { kind: 'online', since: '2026-11-20T23:00:00Z', lastPointAt: '2026-11-20T23:04:40Z' },
    words: 'Online since 6:00 pm · location shared 20 s ago',
  },
  partnerSince: '2026-11-06T15:00:00Z',
  actions: [{ action: 'suspend', display: 'button', enabled: true, reason: null, stepUp: true }],
};

/** A drawn sample card for the viewer: never a real document. */
export const SAMPLE_ID_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540"><rect width="856" height="540" rx="32" fill="#f4f5f6" stroke="#777e90" stroke-width="6"/><rect x="60" y="120" width="200" height="250" rx="16" fill="#e6e8ec"/><text x="300" y="170" font-family="sans-serif" font-size="40" fill="#23262f">SAMPLE ID</text><text x="300" y="230" font-family="sans-serif" font-size="28" fill="#353945">NOT A REAL DOCUMENT</text></svg>',
)}`;
