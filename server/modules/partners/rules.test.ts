import { describe, expect, it } from 'vitest';
import {
  allowedDocuments,
  type ApplicationFacts,
  changedParts,
  changedPartsWords,
  expiryVerdict,
  idLast4,
  mayReapply,
  needsPlate,
  normalizeIdNumber,
  normalizePlate,
  plateKey,
  reapplyDate,
} from './rules';

describe('plates (P3.2, A22.1)', () => {
  it.each([
    ['7kt 342', '7KT 342'],
    ['6vh-450', '6VH 450'],
    ['  fdz   204 ', 'FDZ 204'],
    ['AB', 'AB'],
    ['ABCD1234', 'ABCD1234'],
  ])('%j is shown as %j', (raw, shown) => {
    expect(normalizePlate(raw)).toBe(shown);
  });

  it.each(['', 'A', 'ABCDE12345', '7KT_342', '7KT.342', '<b>1</b>', '----'])(
    'refuses %j',
    (raw) => {
      expect(normalizePlate(raw)).toBeNull();
    },
  );

  it('compares plates without case, spaces or hyphens', () => {
    expect(plateKey('6vh-450')).toBe(plateKey('6VH 450'));
    expect(plateKey('6VH 450')).toBe('6VH450');
  });

  it('asks for a plate for every vehicle but a bicycle', () => {
    expect(needsPlate('BICYCLE')).toBe(false);
    expect(needsPlate('SCOOTER')).toBe(true);
    expect(needsPlate('CAR')).toBe(true);
  });
});

describe('documents (P4.2, P4.3)', () => {
  it('needs a driver license for motor vehicles and offers all three for bicycles', () => {
    expect(allowedDocuments('MOTORBIKE')).toEqual(['DRIVER_LICENSE']);
    expect(allowedDocuments('BICYCLE')).toEqual(['DRIVER_LICENSE', 'STATE_ID', 'PASSPORT']);
  });

  it('drops spaces and hyphens from the number and keeps the last four for display', () => {
    const number = normalizeIdNumber('s4820 4821');
    expect(number).toBe('S48204821');
    expect(idLast4(number ?? '')).toBe('4821');
    expect(normalizeIdNumber('A1-B2')).toBe('A1B2');
  });

  it.each(['abc', 'S4820/4821', 'X'.repeat(21), ''])('refuses the number %j', (raw) => {
    expect(normalizeIdNumber(raw)).toBeNull();
  });
});

describe('expiry (P4.4, A22.3, U34)', () => {
  const today = '2026-11-20';

  it('is expired only before the printed date', () => {
    expect(expiryVerdict('2026-11-19', today)).toEqual({ kind: 'expired' });
    expect(expiryVerdict('2026-11-20', today)).toEqual({ kind: 'soon', inDays: 0 });
  });

  it("flags Sam's license, 20 days out, and leaves Luis's alone", () => {
    expect(expiryVerdict('2026-12-10', today)).toEqual({ kind: 'soon', inDays: 20 });
    expect(expiryVerdict('2029-03-03', today).kind).toBe('fine');
  });

  it('expires on the next day once the clock moves to Dec 11 (A23.4)', () => {
    expect(expiryVerdict('2026-12-10', '2026-12-11')).toEqual({ kind: 'expired' });
  });
});

describe('reapplying (P7.4, P7.6, A24.6)', () => {
  it('opens 30 days after the decision', () => {
    expect(reapplyDate('2026-11-17')).toBe('2026-12-17');
    expect(reapplyDate('2026-11-20')).toBe('2026-12-20');
    expect(reapplyDate('2026-10-20')).toBe('2026-11-19');
  });

  it('is allowed from the date itself', () => {
    expect(mayReapply('2026-12-17', '2026-12-16')).toBe(false);
    expect(mayReapply('2026-12-17', '2026-12-17')).toBe(true);
    expect(mayReapply('2026-11-19', '2026-11-20')).toBe(true);
  });
});

describe('what an edit changed (A31.1)', () => {
  const before: ApplicationFacts = {
    photoUploadId: 'p1',
    phone: '+16175550134',
    vehicleType: 'SCOOTER',
    plate: '7KT 219',
    idDocumentType: 'DRIVER_LICENSE',
    idNumberHash: 'h1',
    idExpiresOn: '2028-08-14',
    idDocumentUploadId: 'd1',
  };

  it('names the parts, in a fixed order, never the values', () => {
    const parts = changedParts(before, { ...before, idDocumentUploadId: 'd2', plate: '7KT 220' });
    expect(parts).toEqual(['idPhoto', 'plate']);
    expect(changedPartsWords(parts)).toBe('new ID photo, plate');
  });

  it('finds nothing when nothing changed', () => {
    expect(changedParts(before, { ...before })).toEqual([]);
  });

  it('sees a new number through its hash only', () => {
    expect(changedParts(before, { ...before, idNumberHash: 'h2' })).toEqual(['idNumber']);
  });
});
