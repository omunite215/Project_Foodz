import type { VehicleType } from '@/server/db/enums';
import {
  expiresSoonNote,
  idExpiredError,
  idNumberError,
  PARTNER_FIELD_ERRORS,
} from '@/server/modules/partners/schema';
import {
  allowedDocuments,
  expiryVerdict,
  type IdDocumentType,
  needsPlate,
  normalizeIdNumber,
  normalizePlate,
} from '@/server/modules/partners/rules';
import { longDate } from '@/server/modules/partners/text';
import { parsePhone } from '@/lib/phone';
import { type ApplyMode, type ApplyStep, missingPhotoError } from './text';

/*
 * Which fields each step of the application holds, and the browser's check of a step (F6 design
 * 4.1): the same rules and words as the module's schema (server/modules/partners/schema.ts), so
 * "Continue" says exactly what "Send" would. Every problem of a step is reported at once.
 */

export interface ApplyValues {
  phone: string;
  phoneCountry: string;
  vehicleType: VehicleType | '';
  plate: string;
  idDocumentType: IdDocumentType | '';
  idNumber: string;
  idExpiresOn: string;
  adult: boolean;
  agreeTerms: boolean;
}

export interface ApplyUploads {
  photo: { uploadId: string; status: 'checking' | 'ready' } | null;
  idPhoto: { uploadId: string; status: 'checking' | 'ready' } | null;
}

export type ApplyField =
  | 'photoUploadId'
  | 'phone'
  | 'vehicleType'
  | 'plate'
  | 'idDocumentType'
  | 'idNumber'
  | 'idExpiresOn'
  | 'idDocumentUploadId'
  | 'adult'
  | 'agreeTerms';

export const STEP_FIELDS: Record<ApplyStep, readonly ApplyField[]> = {
  1: ['photoUploadId', 'phone'],
  2: ['vehicleType', 'plate'],
  3: ['idDocumentType', 'idNumber', 'idExpiresOn', 'idDocumentUploadId'],
  4: ['adult', 'agreeTerms'],
};

/** The step a server field error belongs to. */
export function stepOfField(field: string): ApplyStep {
  for (const step of [1, 2, 3, 4] as const) {
    if ((STEP_FIELDS[step] as readonly string[]).includes(field)) return step;
  }
  return field === 'phoneCountry' ? 1 : 4;
}

/** The document the vehicle allows, or the bicycle's choice (P4.2). */
export function documentOf(values: Pick<ApplyValues, 'vehicleType' | 'idDocumentType'>) {
  if (!values.vehicleType) return values.idDocumentType || null;
  const allowed = allowedDocuments(values.vehicleType);
  if (allowed.length === 1) return allowed[0] ?? null;
  return values.idDocumentType || null;
}

/** For words that need a document before one is chosen: the license. */
export const documentWordsOf = (values: Pick<ApplyValues, 'vehicleType' | 'idDocumentType'>) =>
  documentOf(values) ?? 'DRIVER_LICENSE';

export type StepErrors = Partial<Record<ApplyField, string>>;

/**
 * The problems of one step. `today` is the store's calendar date (the expiry check, P4.4). In
 * edit and fix modes an empty number keeps the stored one and there are no agreements.
 */
export function stepErrors(
  step: ApplyStep,
  values: ApplyValues,
  uploads: ApplyUploads,
  mode: ApplyMode,
  today: string,
): StepErrors {
  const errors: StepErrors = {};
  const document = documentWordsOf(values);
  if (step === 1) {
    if (!uploads.photo) errors.photoUploadId = missingPhotoError('photo', document);
    if (!values.phone.trim()) errors.phone = PARTNER_FIELD_ERRORS.phoneEmpty;
    else if (!parsePhone(values.phone, values.phoneCountry))
      errors.phone = PARTNER_FIELD_ERRORS.phone;
  }
  if (step === 2) {
    if (!values.vehicleType) errors.vehicleType = PARTNER_FIELD_ERRORS.vehicle;
    else if (needsPlate(values.vehicleType)) {
      if (!values.plate.trim()) errors.plate = PARTNER_FIELD_ERRORS.plateEmpty;
      else if (!normalizePlate(values.plate)) errors.plate = PARTNER_FIELD_ERRORS.plate;
    }
  }
  if (step === 3) {
    if (values.vehicleType === 'BICYCLE' && !values.idDocumentType) {
      errors.idDocumentType = PARTNER_FIELD_ERRORS.idType;
    }
    const number = values.idNumber.trim();
    const numberRequired = mode === 'new' || mode === 'reapply';
    if ((numberRequired || number) && !normalizeIdNumber(number)) {
      errors.idNumber = idNumberError(document);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.idExpiresOn)) {
      errors.idExpiresOn = PARTNER_FIELD_ERRORS.idExpiry;
    } else if (expiryVerdict(values.idExpiresOn, today).kind === 'expired') {
      errors.idExpiresOn = idExpiredError(document);
    }
    if (!uploads.idPhoto) errors.idDocumentUploadId = missingPhotoError('id', document);
  }
  if (step === 4 && (mode === 'new' || mode === 'reapply')) {
    if (!values.adult) errors.adult = PARTNER_FIELD_ERRORS.adult;
    if (!values.agreeTerms) errors.agreeTerms = PARTNER_FIELD_ERRORS.terms;
  }
  return errors;
}

/** The first step with a problem before `upTo`, or `upTo` (a typed `?step=4`, design 4.1). */
export function firstIncompleteStep(
  upTo: ApplyStep,
  values: ApplyValues,
  uploads: ApplyUploads,
  mode: ApplyMode,
  today: string,
): ApplyStep {
  for (const step of [1, 2, 3] as const) {
    if (step >= upTo) break;
    if (Object.keys(stepErrors(step, values, uploads, mode, today)).length) return step;
  }
  return upTo;
}

/** P4.4: accepted within 30 days, with a note. */
export function expiryNote(expiresOn: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return null;
  return expiryVerdict(expiresOn, today).kind === 'soon'
    ? expiresSoonNote(longDate(expiresOn))
    : null;
}

/** The last four of what was typed, for the summary only ("ending 4821"). */
export function typedLast4(idNumber: string): string | null {
  const normalized = normalizeIdNumber(idNumber);
  return normalized ? normalized.slice(-4) : null;
}

export const clampStep = (value: number): ApplyStep =>
  value >= 4 ? 4 : value <= 1 || Number.isNaN(value) ? 1 : value === 2 ? 2 : 3;
