import type { VehicleType } from '@/server/db/enums';

/*
 * Pure rules of a partner application (F6 P3, P4, P6, P7, B1, B4). Shared by the browser form
 * (through the schemas) and the service, so both refuse the same things with the same words.
 */

export const ID_DOCUMENT_TYPES = ['DRIVER_LICENSE', 'STATE_ID', 'PASSPORT'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export const VEHICLE_TYPES = [
  'BICYCLE',
  'SCOOTER',
  'MOTORBIKE',
  'CAR',
] as const satisfies readonly VehicleType[];

/** P4.4, A22.3: an ID expiring within this many days is accepted, with a note and a flag. */
export const EXPIRES_SOON_DAYS = 30;
/** P7.6, P7.8: a rejected applicant may apply again, and the files go, this many days later. */
export const REAPPLY_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ vehicle and document

/** P3.2: every vehicle but a bicycle has a plate. */
export const needsPlate = (vehicle: VehicleType): boolean => vehicle !== 'BICYCLE';

/**
 * P4.2: a motor vehicle needs a driver's license; a bicycle may use any of the three. The
 * first entry is what the form shows when there is no choice.
 */
export function allowedDocuments(vehicle: VehicleType): readonly IdDocumentType[] {
  return vehicle === 'BICYCLE' ? ID_DOCUMENT_TYPES : ['DRIVER_LICENSE'];
}

// ------------------------------------------------------------------ plate

const PLATE_CHARS = /^[A-Za-z0-9 -]+$/;

/**
 * "7kt 342" → "7KT 342", "6vh-450" → "6VH 450" (P3.2): capitals, any run of spaces or hyphens
 * becomes one space. Null when it isn't 2 to 8 letters and numbers.
 */
export function normalizePlate(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 12 || !PLATE_CHARS.test(text)) return null;
  const shown = text
    .toUpperCase()
    .replace(/[\s-]+/g, ' ')
    .trim();
  const bare = shown.replace(/ /g, '');
  return bare.length >= 2 && bare.length <= 8 ? shown : null;
}

/**
 * What two plates are compared by (A22.1): no case, spaces or hyphens. The database keeps the
 * same value as a generated column for the flag index.
 */
export const plateKey = (plate: string): string => plate.toUpperCase().replace(/[\s-]/g, '');

// ------------------------------------------------------------------ ID number

/**
 * "S4820 4821" → "S48204821" (P4.3): spaces and hyphens dropped, capitals. Null when it isn't
 * 4 to 20 letters and numbers.
 */
export function normalizeIdNumber(raw: string): string | null {
  const bare = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{4,20}$/.test(bare) ? bare : null;
}

/** The only part of the number that is ever shown (P4.6, U26). */
export const idLast4 = (normalized: string): string => normalized.slice(-4);

// ------------------------------------------------------------------ expiry

/** A calendar date, "2029-03-03". */
export type IsoDate = string;

/** Whole days from `from` to `to` (both calendar dates). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export type ExpiryVerdict =
  | { kind: 'expired' }
  | { kind: 'soon'; inDays: number }
  | { kind: 'fine'; inDays: number };

/**
 * P4.4, A22.3, U34: expired when the date is before today (an ID is valid through its expiry
 * date); "soon" within 30 days. `today` is the store's calendar date.
 */
export function expiryVerdict(expiresOn: IsoDate, today: IsoDate): ExpiryVerdict {
  const inDays = daysBetween(today, expiresOn);
  if (inDays < 0) return { kind: 'expired' };
  return inDays <= EXPIRES_SOON_DAYS ? { kind: 'soon', inDays } : { kind: 'fine', inDays };
}

/** P7.4: "You can apply again from Thu, Dec 17, 2026." — the decision's store date + 30. */
export const reapplyDate = (decidedOn: IsoDate): IsoDate => addDays(decidedOn, REAPPLY_AFTER_DAYS);

/** P7.6: from the reapply date on, the form opens again and `REAPPLY_LATER` stops. */
export const mayReapply = (reapplyAfter: IsoDate, today: IsoDate): boolean =>
  daysBetween(reapplyAfter, today) >= 0;

// ------------------------------------------------------------------ what an edit changed

/** A31.1: an edit names the parts changed, never their values. */
export const CHANGED_PARTS = [
  'photo',
  'idPhoto',
  'vehicle',
  'plate',
  'idType',
  'idNumber',
  'idExpiry',
  'phone',
] as const;
export type ChangedPart = (typeof CHANGED_PARTS)[number];

/** The comparable state of an application; the ID number only as its keyed hash. */
export interface ApplicationFacts {
  photoUploadId: string | null;
  phone: string | null;
  vehicleType: VehicleType;
  plate: string | null;
  idDocumentType: IdDocumentType;
  idNumberHash: string | null;
  idExpiresOn: IsoDate;
  idDocumentUploadId: string | null;
}

/** The parts that differ, images first ("new ID photo, plate"), in `CHANGED_PARTS` order. */
export function changedParts(before: ApplicationFacts, after: ApplicationFacts): ChangedPart[] {
  const differs: Record<ChangedPart, boolean> = {
    photo: before.photoUploadId !== after.photoUploadId,
    phone: before.phone !== after.phone,
    vehicle: before.vehicleType !== after.vehicleType,
    plate: (before.plate ?? '') !== (after.plate ?? ''),
    idType: before.idDocumentType !== after.idDocumentType,
    idNumber: before.idNumberHash !== after.idNumberHash,
    idExpiry: before.idExpiresOn !== after.idExpiresOn,
    idPhoto: before.idDocumentUploadId !== after.idDocumentUploadId,
  };
  return CHANGED_PARTS.filter((part) => differs[part]);
}

const PART_WORDS: Record<ChangedPart, string> = {
  photo: 'new photo',
  phone: 'phone',
  vehicle: 'vehicle',
  plate: 'plate',
  idType: 'ID type',
  idNumber: 'ID number',
  idExpiry: 'expiry date',
  idPhoto: 'new ID photo',
};

/** "new ID photo, plate" (A31.1, A20.10). */
export const changedPartsWords = (parts: readonly ChangedPart[]): string =>
  parts.map((part) => PART_WORDS[part]).join(', ');
