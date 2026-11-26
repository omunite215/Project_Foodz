import { describe, expect, it } from 'vitest';
import {
  availabilityInput,
  locationsInput,
  submitApplicationInput,
  updateApplicationInput,
} from './schema';

const photo = '019a0000-0000-7000-8000-000000000001';
const idPhoto = '019a0000-0000-7000-8000-000000000002';

const luis = {
  photoUploadId: photo,
  phone: '(617) 555-0177',
  vehicleType: 'SCOOTER',
  plate: '7kt 342',
  idNumber: 'S4820 4821',
  idExpiresOn: '2029-03-03',
  idDocumentUploadId: idPhoto,
  termsVersion: 1,
  adult: true,
  agreeTerms: true,
  turnstileToken: 'token',
} as const;

const errorsOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]),
  );

describe('sending an application (P2 to P5)', () => {
  it("stores Luis's application in its tidy form", () => {
    expect(submitApplicationInput.parse(luis)).toMatchObject({
      phone: '+16175550177',
      plate: '7KT 342',
      idDocumentType: 'DRIVER_LICENSE',
      idNumber: 'S48204821',
    });
  });

  it('drops the plate for a bicycle and lets the rider choose the ID', () => {
    const parsed = submitApplicationInput.parse({
      ...luis,
      vehicleType: 'BICYCLE',
      idDocumentType: 'PASSPORT',
    });
    expect(parsed.plate).toBeNull();
    expect(parsed.idDocumentType).toBe('PASSPORT');
  });

  it('always needs a driver license for a motor vehicle, whatever was sent', () => {
    const parsed = submitApplicationInput.parse({ ...luis, idDocumentType: 'PASSPORT' });
    expect(parsed.idDocumentType).toBe('DRIVER_LICENSE');
  });

  it('asks a bicycle rider which ID they will use', () => {
    const result = submitApplicationInput.safeParse({ ...luis, vehicleType: 'BICYCLE' });
    expect(errorsOf(result)).toMatchObject({ idDocumentType: "Choose which ID you'll use." });
  });

  it('words every field problem as the form shows it', () => {
    const result = submitApplicationInput.safeParse({
      ...luis,
      phone: '',
      plate: '',
      idNumber: 'S48/2048',
      adult: false,
      agreeTerms: false,
    });
    expect(errorsOf(result)).toMatchObject({
      phone: 'Enter a mobile number we can call.',
      plate: 'Enter your plate number.',
      idNumber: "Enter the number exactly as it's printed on your license.",
      adult: "Confirm you're 18 or older.",
      agreeTerms: 'Agree to the Partner Terms to continue.',
    });
  });

  it('never accepts a date of birth, an SSN, a partner id or any other field (P5.8, P15.3)', () => {
    expect(submitApplicationInput.safeParse({ ...luis, ssn: '123-45-6789' }).success).toBe(false);
    expect(submitApplicationInput.safeParse({ ...luis, status: 'APPROVED' }).success).toBe(false);
  });
});

describe('editing (P6.3)', () => {
  it('keeps the stored number when the field is left empty', () => {
    const {
      adult: _adult,
      agreeTerms: _terms,
      turnstileToken: _token,
      termsVersion: _v,
      ...rest
    } = luis;
    const parsed = updateApplicationInput.parse({ ...rest, idNumber: '', expectedVersion: 3 });
    expect(parsed.idNumber).toBeNull();
    expect(
      updateApplicationInput.safeParse({ ...rest, idNumber: 'S1', expectedVersion: 3 }).success,
    ).toBe(false);
  });
});

describe('location bodies (P16.5)', () => {
  const point = {
    lat: 42.3505,
    lng: -71.045,
    accuracy: 15,
    recordedAt: '2026-11-20T23:00:00.000Z',
  };

  it('fills heading and speed with null and refuses anything else', () => {
    expect(locationsInput.parse({ points: [point] }).points[0]).toMatchObject({
      heading: null,
      speed: null,
    });
    expect(locationsInput.safeParse({ points: [{ ...point, partnerId: photo }] }).success).toBe(
      false,
    );
    expect(locationsInput.safeParse({ points: [point], partnerId: photo }).success).toBe(false);
  });

  it('refuses out-of-range or non-finite values and oversized batches', () => {
    expect(locationsInput.safeParse({ points: [{ ...point, lat: 91 }] }).success).toBe(false);
    expect(locationsInput.safeParse({ points: [{ ...point, lng: Number.NaN }] }).success).toBe(
      false,
    );
    expect(
      locationsInput.safeParse({ points: [{ ...point, accuracy: Number.POSITIVE_INFINITY }] })
        .success,
    ).toBe(false);
    expect(locationsInput.safeParse({ points: [{ ...point, speed: 101 }] }).success).toBe(false);
    expect(
      locationsInput.safeParse({ points: Array.from({ length: 51 }, () => point) }).success,
    ).toBe(false);
    expect(locationsInput.safeParse({ points: [] }).success).toBe(false);
  });

  it('goes online with a point and offline with nothing', () => {
    expect(availabilityInput.safeParse({ online: true, point }).success).toBe(true);
    expect(availabilityInput.safeParse({ online: true }).success).toBe(true);
    expect(availabilityInput.safeParse({ online: false }).success).toBe(true);
    expect(availabilityInput.safeParse({ online: false, point }).success).toBe(false);
    expect(availabilityInput.safeParse({ online: false, giveBack: true }).success).toBe(true);
    expect(availabilityInput.safeParse({ online: true, giveBack: true }).success).toBe(false);
  });
});
