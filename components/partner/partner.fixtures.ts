import type { ApplicationSummary, PartnerState } from '@/server/modules/partners/schema';

/*
 * The story's people for the partner app's stories (F6 story fixtures): Ana pending, Kwame sent
 * back, Jonas and Mei rejected, Victor suspended, Diego approved. No real person, no real ID.
 */

export const TZ = 'America/New_York';
export const USER_ID = '01937c4a-0000-7000-8000-00000000a001';

export const ANA: ApplicationSummary = {
  version: 2,
  submittedAt: '2026-11-19T22:40:00Z',
  updatedAt: '2026-11-20T23:05:00Z',
  vehicleType: 'SCOOTER',
  plate: '7KT 219',
  vehicleWords: 'Scooter or moped · 7KT 219',
  idDocumentType: 'DRIVER_LICENSE',
  idLast4: '4407',
  idExpiresOn: '2028-08-14',
  documentWords: "Driver's license ending 4407 · expires Aug 14, 2028",
  photo: { uploadId: '01937c4a-0000-7000-8000-00000000b001', url: null, expiresAt: null },
  idPhoto: { uploadId: '01937c4a-0000-7000-8000-00000000b002', url: null, expiresAt: null },
  phone: { e164: '+16175550161', display: '(617) 555-0161', masked: '(617) 555-…' },
  terms: {
    version: 1,
    acceptedAt: '2026-11-19T22:40:00Z',
    adultConfirmedAt: '2026-11-19T22:40:00Z',
  },
};

export const ANA_EMAIL = { masked: 'pen…@…', full: 'pending.partner@foodz.example' };

export const KWAME_SENT_BACK = {
  at: '2026-11-19T15:30:00Z',
  message:
    'The photo of your ID is blurry. Please take a new one in good light, with all four corners showing.\n<b>blurry</b> stays plain text.',
};

export const JONAS: Extract<PartnerState, { screen: 'rejected' }> = {
  screen: 'rejected',
  decidedAt: '2026-11-17T16:00:00Z',
  reason: "We couldn't match the name on your ID to your account name.",
  reapplyFrom: '2026-12-17',
  canReapply: false,
  filesDeleteOn: '2026-12-17',
  filesDeletedAt: null,
};

export const MEI: Extract<PartnerState, { screen: 'rejected' }> = {
  screen: 'rejected',
  decidedAt: '2026-10-20T16:00:00Z',
  reason: null,
  reapplyFrom: '2026-11-19',
  canReapply: true,
  filesDeleteOn: null,
  filesDeletedAt: '2026-11-19T08:30:00Z',
};

export const DIEGO_HOME: Extract<PartnerState, { screen: 'home' }> = {
  screen: 'home',
  partner: {
    id: '01937c4a-0000-7000-8000-00000000c001',
    name: 'Diego Alvarez',
    firstName: 'Diego',
    vehicleWords: 'Motorbike · 2FD 881',
    photo: null,
    rating: null,
    partnerSince: '2026-11-06T15:00:00Z',
    isDemo: false,
  },
  availability: {
    online: false,
    onlineSince: null,
    lastPointAt: null,
    freshness: 'offline',
    onThisDevice: false,
  },
  lastOffline: null,
  kitchen: {
    isOpen: true,
    offlineLine: 'Foodz Kitchen is open · closes 11 pm',
    onlineLine: 'Foodz Kitchen is open · closes 11 pm',
    point: { lat: 42.3505, lng: -71.045 },
    radiusKm: 8,
    timeZone: TZ,
  },
  demoPoint: null,
  dispatch: {
    missedInRow: 0,
    offersPausedSince: null,
    howOffersWork: { reachesKm: [2, 4, 8], offerSeconds: 30, missLimit: 3 },
    delivery: null,
    notice: null,
  },
};
