import { describe, expect, it } from 'vitest';
import {
  type ApplyUploads,
  type ApplyValues,
  clampStep,
  documentOf,
  expiryNote,
  firstIncompleteStep,
  stepErrors,
  stepOfField,
  typedLast4,
} from './apply-rules';

const TODAY = '2026-11-20';

const EMPTY: ApplyValues = {
  phone: '',
  phoneCountry: 'US',
  vehicleType: '',
  plate: '',
  idDocumentType: '',
  idNumber: '',
  idExpiresOn: '',
  adult: false,
  agreeTerms: false,
};

const LUIS: ApplyValues = {
  phone: '(617) 555-0177',
  phoneCountry: 'US',
  vehicleType: 'SCOOTER',
  plate: '7kt 342',
  idDocumentType: '',
  idNumber: 'S4820 4821',
  idExpiresOn: '2029-03-03',
  adult: true,
  agreeTerms: true,
};

const NONE: ApplyUploads = { photo: null, idPhoto: null };
const BOTH: ApplyUploads = {
  photo: { uploadId: 'p', status: 'ready' },
  idPhoto: { uploadId: 'i', status: 'checking' },
};

describe('each step checks only its own fields (design 4.1)', () => {
  it('step 1: a photo and a phone we can call', () => {
    expect(stepErrors(1, EMPTY, NONE, 'new', TODAY)).toEqual({
      photoUploadId: 'Add a photo of your face.',
      phone: 'Enter a mobile number we can call.',
    });
    expect(stepErrors(1, { ...EMPTY, phone: '12' }, BOTH, 'new', TODAY)).toEqual({
      phone: 'Enter a number we can call, like (617) 555-0142.',
    });
  });

  it('step 2: a vehicle, and a plate for a motor vehicle', () => {
    expect(stepErrors(2, EMPTY, NONE, 'new', TODAY)).toEqual({
      vehicleType: "Choose what you'll deliver with.",
    });
    expect(stepErrors(2, { ...EMPTY, vehicleType: 'CAR' }, NONE, 'new', TODAY)).toEqual({
      plate: 'Enter your plate number.',
    });
    expect(
      stepErrors(2, { ...EMPTY, vehicleType: 'CAR', plate: '!!' }, NONE, 'new', TODAY),
    ).toEqual({ plate: 'Use the letters and numbers on your plate, like 7KT 342.' });
    expect(stepErrors(2, { ...EMPTY, vehicleType: 'BICYCLE' }, NONE, 'new', TODAY)).toEqual({});
  });

  it('step 3: the document, number, expiry and front photo', () => {
    const bike = { ...EMPTY, vehicleType: 'BICYCLE' as const };
    expect(stepErrors(3, bike, NONE, 'new', TODAY)).toEqual({
      idDocumentType: "Choose which ID you'll use.",
      idNumber: "Enter the number exactly as it's printed on your license.",
      idExpiresOn: 'Enter the expiry date.',
      idDocumentUploadId: 'Add a photo of the front of your license.',
    });
    const passport = { ...bike, idDocumentType: 'PASSPORT' as const, idExpiresOn: '2026-11-19' };
    expect(stepErrors(3, passport, NONE, 'new', TODAY)).toMatchObject({
      idNumber: "Enter the number exactly as it's printed on your passport.",
      idExpiresOn: 'This passport has expired. You need a valid one to deliver.',
      idDocumentUploadId: 'Add a photo of the front of your passport.',
    });
  });

  it('accepts an ID valid through today, and a photo still being checked (P2.5)', () => {
    expect(stepErrors(3, { ...LUIS, idExpiresOn: TODAY }, BOTH, 'new', TODAY)).toEqual({});
  });

  it('keeps the stored number when editing with the field empty', () => {
    expect(stepErrors(3, { ...LUIS, idNumber: '' }, BOTH, 'edit', TODAY)).toEqual({});
    expect(stepErrors(3, { ...LUIS, idNumber: '12' }, BOTH, 'fix', TODAY)).toEqual({
      idNumber: "Enter the number exactly as it's printed on your license.",
    });
  });

  it('step 4: both agreements, only for a new application', () => {
    expect(stepErrors(4, EMPTY, NONE, 'new', TODAY)).toEqual({
      adult: "Confirm you're 18 or older.",
      agreeTerms: 'Agree to the Partner Terms to continue.',
    });
    expect(stepErrors(4, EMPTY, NONE, 'reapply', TODAY)).toHaveProperty('adult');
    expect(stepErrors(4, EMPTY, NONE, 'edit', TODAY)).toEqual({});
  });
});

describe('moving between steps', () => {
  it('opens a typed later step at the first incomplete one, with no error', () => {
    expect(firstIncompleteStep(4, EMPTY, NONE, 'new', TODAY)).toBe(1);
    expect(firstIncompleteStep(4, { ...LUIS, idNumber: '' }, BOTH, 'new', TODAY)).toBe(3);
    expect(firstIncompleteStep(4, LUIS, BOTH, 'new', TODAY)).toBe(4);
    expect(firstIncompleteStep(2, EMPTY, BOTH, 'new', TODAY)).toBe(1);
  });

  it('reads the step from the address leniently', () => {
    expect(clampStep(Number('x'))).toBe(1);
    expect(clampStep(0)).toBe(1);
    expect(clampStep(3)).toBe(3);
    expect(clampStep(9)).toBe(4);
  });

  it('places a server field error on its step', () => {
    expect(stepOfField('photoUploadId')).toBe(1);
    expect(stepOfField('phoneCountry')).toBe(1);
    expect(stepOfField('plate')).toBe(2);
    expect(stepOfField('idDocumentUploadId')).toBe(3);
    expect(stepOfField('agreeTerms')).toBe(4);
  });
});

describe('the document and the summary', () => {
  it('forces a license for motor vehicles', () => {
    expect(documentOf({ vehicleType: 'MOTORBIKE', idDocumentType: 'PASSPORT' })).toBe(
      'DRIVER_LICENSE',
    );
    expect(documentOf({ vehicleType: 'BICYCLE', idDocumentType: 'PASSPORT' })).toBe('PASSPORT');
    expect(documentOf({ vehicleType: 'BICYCLE', idDocumentType: '' })).toBeNull();
  });

  it('notes an ID expiring within 30 days (P4.4)', () => {
    expect(expiryNote('2026-12-10', TODAY)).toBe(
      "It expires on Dec 10, 2026. You'll need to send us a new one before then.",
    );
    expect(expiryNote('2029-03-03', TODAY)).toBeNull();
    expect(expiryNote('', TODAY)).toBeNull();
  });

  it('shows only the last four of what was typed', () => {
    expect(typedLast4('S4820 4821')).toBe('4821');
    expect(typedLast4('12')).toBeNull();
  });
});
