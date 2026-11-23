import { z } from 'zod';
import { DEFAULT_PHONE_COUNTRY, parsePhone } from '@/lib/phone';
import type { VehicleType } from '@/server/db/enums';
import { PHONE_ERROR } from '@/server/modules/account/schema';
import type { Freshness, PointResult } from './location';
import { MAX_BATCH_POINTS } from './location';
import {
  allowedDocuments,
  ID_DOCUMENT_TYPES,
  type IdDocumentType,
  type IsoDate,
  needsPlate,
  normalizeIdNumber,
  normalizePlate,
  VEHICLE_TYPES,
} from './rules';
import { DOCUMENT_NOUN, type NoticedOfflineReason, type OfflineReason } from './text';

/*
 * The partner's own side (F6 P1 to P17): applying, waiting, hearing the decision, going online
 * and sharing a location while online. Server Actions carry the application; same-origin REST
 * routes under /api/v1/partner carry availability and locations (B3). Inputs are strict; the
 * session decides who the partner is, never a field in the body (P15.3). The full ID number
 * goes in once and never comes back (P4.7, U26).
 */

// ------------------------------------------------------------------ field errors (US spelling)

export const PARTNER_FIELD_ERRORS = {
  photo: 'Add a photo of your face.',
  phoneEmpty: 'Enter a mobile number we can call.',
  phone: PHONE_ERROR,
  vehicle: "Choose what you'll deliver with.",
  plateEmpty: 'Enter your plate number.',
  plate: 'Use the letters and numbers on your plate, like 7KT 342.',
  idType: "Choose which ID you'll use.",
  idExpiry: 'Enter the expiry date.',
  adult: "Confirm you're 18 or older.",
  terms: 'Agree to the Partner Terms to continue.',
  uploadUnavailable: "That photo isn't available. Upload it again.",
} as const;

/** "Enter the number exactly as it's printed on your license." (… ID card, … passport). */
export const idNumberError = (type: IdDocumentType) =>
  `Enter the number exactly as it's printed on your ${DOCUMENT_NOUN[type]}.`;

/** "This license has expired. You need a valid one to deliver." */
export const idExpiredError = (type: IdDocumentType) =>
  `This ${DOCUMENT_NOUN[type]} has expired. You need a valid one to deliver.`;

/** "Add a photo of the front of your license." */
export const idPhotoError = (type: IdDocumentType) =>
  `Add a photo of the front of your ${DOCUMENT_NOUN[type]}.`;

/** P4.4: accepted, with a note. */
export const expiresSoonNote = (expiresOnWords: string) =>
  `It expires on ${expiresOnWords}. You'll need to send us a new one before then.`;

// ------------------------------------------------------------------ the application

const isoDate = z.iso.date({ error: PARTNER_FIELD_ERRORS.idExpiry });

const applicationFields = {
  photoUploadId: z.uuid({ error: PARTNER_FIELD_ERRORS.photo }),
  phone: z.string().trim().max(40, PARTNER_FIELD_ERRORS.phone),
  phoneCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default(DEFAULT_PHONE_COUNTRY),
  vehicleType: z.enum(VEHICLE_TYPES, { error: PARTNER_FIELD_ERRORS.vehicle }),
  /** Scooter, motorbike and car only; dropped for a bicycle (P3.2). */
  plate: z.string().max(12, PARTNER_FIELD_ERRORS.plate).optional(),
  /** Bicycles choose; motor vehicles are always a driver's license (P4.2). */
  idDocumentType: z.enum(ID_DOCUMENT_TYPES, { error: PARTNER_FIELD_ERRORS.idType }).optional(),
  idExpiresOn: isoDate,
  idDocumentUploadId: z.uuid(),
};

interface RawApplication {
  phone: string;
  phoneCountry: string;
  vehicleType: VehicleType;
  plate?: string | undefined;
  idDocumentType?: IdDocumentType | undefined;
  idNumber?: string | undefined;
}

/** The checks both the first send and an edit share (P2.4, P3.2, P4.2, P4.3). */
function checkApplication(value: RawApplication, ctx: z.RefinementCtx, numberRequired: boolean) {
  if (!value.phone) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: PARTNER_FIELD_ERRORS.phoneEmpty });
  } else if (!parsePhone(value.phone, value.phoneCountry)) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: PARTNER_FIELD_ERRORS.phone });
  }
  if (needsPlate(value.vehicleType)) {
    if (!value.plate?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['plate'], message: PARTNER_FIELD_ERRORS.plateEmpty });
    } else if (!normalizePlate(value.plate)) {
      ctx.addIssue({ code: 'custom', path: ['plate'], message: PARTNER_FIELD_ERRORS.plate });
    }
  }
  const documents = allowedDocuments(value.vehicleType);
  const document = documents.length === 1 ? documents[0] : value.idDocumentType;
  if (!document || !documents.includes(document)) {
    ctx.addIssue({
      code: 'custom',
      path: ['idDocumentType'],
      message: PARTNER_FIELD_ERRORS.idType,
    });
    return;
  }
  const number = value.idNumber?.trim() ?? '';
  if ((numberRequired || number) && !normalizeIdNumber(number)) {
    ctx.addIssue({ code: 'custom', path: ['idNumber'], message: idNumberError(document) });
  }
}

/** What the server stores: plate shown form, the document the vehicle allows, the bare number. */
function tidyApplication<V extends RawApplication>(value: V) {
  const documents = allowedDocuments(value.vehicleType);
  const phone = parsePhone(value.phone, value.phoneCountry);
  const number = value.idNumber?.trim() ? normalizeIdNumber(value.idNumber) : null;
  return {
    ...value,
    phone: phone?.e164 ?? '',
    plate: needsPlate(value.vehicleType) ? (normalizePlate(value.plate ?? '') ?? '') : null,
    idDocumentType:
      (documents.length === 1 ? documents[0] : value.idDocumentType) ?? 'DRIVER_LICENSE',
    idNumber: number,
  };
}

/**
 * "Send application" (P5.4). The expiry date is checked against the store's today in the
 * service (`expiryVerdict`), which answers with `fieldErrors.idExpiresOn`. Both uploads must be
 * the caller's, of the right purpose and READY. One application per account (P1.7).
 */
export const submitApplicationInput = z
  .object({
    ...applicationFields,
    idNumber: z.string().max(40),
    termsVersion: z.int().min(1).max(10_000),
    // Checked with the other fields below, so every problem shows at once (P5.5).
    adult: z.boolean(),
    agreeTerms: z.boolean(),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    checkApplication(value, ctx, true);
    if (!value.adult) {
      ctx.addIssue({ code: 'custom', path: ['adult'], message: PARTNER_FIELD_ERRORS.adult });
    }
    if (!value.agreeTerms) {
      ctx.addIssue({ code: 'custom', path: ['agreeTerms'], message: PARTNER_FIELD_ERRORS.terms });
    }
  })
  .transform((value) => {
    const tidy = tidyApplication(value);
    return { ...tidy, idNumber: tidy.idNumber ?? '' };
  });
export type SubmitApplicationInput = z.input<typeof submitApplicationInput>;

/**
 * "Save changes" while pending or sent back (P6.3, P6.5): no Turnstile and no agreements; an
 * empty number keeps the stored one. `expectedVersion` is what the screen showed; a decision
 * in between is refused with `APPLICATION_DECIDED`.
 */
export const updateApplicationInput = z
  .object({
    ...applicationFields,
    idNumber: z.string().max(40).optional(),
    expectedVersion: z.int().min(0).max(2_147_483_647),
  })
  .strict()
  .superRefine((value, ctx) => checkApplication(value, ctx, false))
  .transform(tidyApplication);
export type UpdateApplicationInput = z.input<typeof updateApplicationInput>;

export const withdrawApplicationInput = z.object({}).strict();
export const markWelcomedInput = z.object({}).strict();

// ------------------------------------------------------------------ location (P16.5)

/** One position. Finite numbers only; no other field (P15.3, P16.5). */
export const locationPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(10_000),
    heading: z.number().min(0).max(360).nullable().default(null),
    speed: z.number().min(0).max(100).nullable().default(null),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

/**
 * `PUT /api/v1/partner/availability` (P9.9, P12.1). Going online carries the first point,
 * accurate to 500 m (the demo partner sends none and gets the demo point). Going offline
 * carries nothing; on closing the app it is sent with `fetch(..., { keepalive: true })`.
 */
export const availabilityInput = z.discriminatedUnion('online', [
  z.object({ online: z.literal(true), point: locationPointSchema.optional() }).strict(),
  z.object({ online: z.literal(false) }).strict(),
]);
export type AvailabilityInput = z.input<typeof availabilityInput>;

/** `POST /api/v1/partner/locations` (P10.3, P11.2): up to 50 points, oldest first. */
export const locationsInput = z
  .object({ points: z.array(locationPointSchema).min(1).max(MAX_BATCH_POINTS) })
  .strict();
export type LocationsInput = z.input<typeof locationsInput>;

/** The partner's online state, as every screen and answer carries it. */
export interface Availability {
  online: boolean;
  onlineSince: string | null;
  /** The server's acceptance time of the last point: "Location shared · 20 s ago". */
  lastPointAt: string | null;
  freshness: Freshness;
  /** This browser session is the one sharing (P9.11, P12.4). */
  onThisDevice: boolean;
}

/** The answer to `PUT /availability`. `changeId` lets the app ignore its own realtime echo. */
export interface AvailabilityResult {
  availability: Availability;
  changeId: string;
  at: string;
}

/** The answer to `POST /locations` (P11.5): one result per point, in the order sent. */
export interface LocationsResult {
  results: PointResult[];
  lastPointAt: string | null;
  serverTime: string;
}

// ------------------------------------------------------------------ what /partner shows

/** The kitchen, for the chip, the idle line, the map pin and the range notice. */
export interface PartnerKitchen {
  isOpen: boolean;
  /** "Foodz Kitchen is open · closes 11 pm" / "Foodz Kitchen is closed · opens 11 am tomorrow". */
  offlineLine: string;
  /** Open: the same; closed: "Foodz Kitchen is closed. Orders start when it opens at 11 am." */
  onlineLine: string;
  point: { lat: number; lng: number };
  radiusKm: number;
  timeZone: string;
}

/** A 5-minute link to the owner's own image (P2.2, P6.1). */
export interface OwnImage {
  uploadId: string;
  url: string | null;
  expiresAt: string | null;
}

/** What the applicant sent (P6.1, edit and fix modes). Never the number beyond its last four. */
export interface ApplicationSummary {
  version: number;
  submittedAt: string;
  updatedAt: string | null;
  vehicleType: VehicleType;
  plate: string | null;
  /** "Scooter or moped · 7KT 219". */
  vehicleWords: string;
  idDocumentType: IdDocumentType;
  idLast4: string;
  idExpiresOn: IsoDate;
  /** "Driver's license ending 4407 · expires Aug 14, 2028". */
  documentWords: string;
  photo: OwnImage;
  idPhoto: OwnImage;
  /** The account's phone: E.164 for the edit form, and "(617) 555-…" for the summary row. */
  phone: { e164: string; display: string; masked: string } | null;
  terms: { version: number; acceptedAt: string; adultConfirmedAt: string };
}

/** The applicant's own address, masked for the screen and in full for the sign-in hand-off. */
export interface OwnEmail {
  masked: string;
  full: string;
}

/**
 * One DTO per `/partner` state (B3, design "[BE] needs"), decided in the server render so the
 * page never renders and then switches (P17.6). Words are ready to show.
 */
export type PartnerState =
  /** P1.4, P1.6: in place of the form. */
  | {
      screen: 'gate';
      gate: 'emailNotConfirmed' | 'staff' | 'demoCustomer';
      email: OwnEmail | null;
    }
  /** P1.5, P7.6: the empty form; only the phone comes back from the account. */
  | {
      screen: 'apply';
      mode: 'new' | 'reapply';
      name: string;
      firstName: string;
      phone: { e164: string; display: string; country: string | null } | null;
      termsVersion: number;
    }
  /** P6.1. */
  | { screen: 'pending'; application: ApplicationSummary; email: OwnEmail }
  /** P6.5: the reviewer's message exactly as typed. */
  | {
      screen: 'sentBack';
      application: ApplicationSummary;
      email: OwnEmail;
      sentBack: { at: string; message: string };
    }
  /** P7.4 to P7.6. */
  | {
      screen: 'rejected';
      decidedAt: string;
      reason: string | null;
      reapplyFrom: IsoDate;
      canReapply: boolean;
      filesDeleteOn: IsoDate | null;
      filesDeletedAt: string | null;
    }
  /** P7.2: once per account; "Go to the app" sets `welcomed_at`. */
  | { screen: 'welcome'; firstName: string; isDemo: boolean }
  /** P8, P9, P10. */
  | {
      screen: 'home';
      partner: {
        name: string;
        firstName: string;
        vehicleWords: string;
        photo: OwnImage | null;
        rating: { average: number; count: number } | null;
        partnerSince: string;
        isDemo: boolean;
      };
      availability: Availability;
      /** The last automatic offline, until he goes online again (design 6.6). */
      lastOffline: {
        reason: NoticedOfflineReason;
        at: string;
        words: string;
        ifDisconnected: string | null;
      } | null;
      kitchen: PartnerKitchen;
      /** The demo partner's pretend position (B12); null for everyone else. */
      demoPoint: { lat: number; lng: number } | null;
    }
  /** P14.3: no data beyond the date and the reason. */
  | { screen: 'suspended'; since: string; reason: string | null };

export type PartnerScreen = PartnerState['screen'];

/** What `GET /api/v1/partner/me` answers: the same state, for refetches (design 5.4). */
export type PartnerMe = PartnerState;

export interface SubmitResult {
  partnerId: string;
  version: number;
  submittedAt: string;
  replayed: boolean;
}

export interface UpdateResult {
  version: number;
  updatedAt: string;
  /** True when the save also fixed what was sent back (P6.5). */
  fixed: boolean;
}

/** `details` per refusal code on the partner side (server/errors.ts). */
export interface PartnerRefusalDetails {
  REAPPLY_LATER: { reapplyFrom: IsoDate };
  APPLICATION_EXISTS: { status: 'APPLIED' | 'APPROVED' | 'SUSPENDED' | 'REJECTED' };
  APPLICATION_DECIDED: { status: 'APPROVED' | 'REJECTED' | 'SUSPENDED' };
  UPLOAD_NOT_READY: { field: 'photoUploadId' | 'idDocumentUploadId' };
  NOT_ONLINE: { reason: OfflineReason | null; at: string | null };
  OTHER_DEVICE: { since: string };
  PARTNER_SUSPENDED: { since: string };
}
