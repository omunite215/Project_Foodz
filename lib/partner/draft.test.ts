import { describe, expect, it } from 'vitest';
import {
  APPLY_DRAFT_LIFETIME_MS,
  type ApplyDraft,
  forgetApplyDraft,
  forgetApplyDrafts,
  readApplyDraft,
  saveApplyDraft,
} from './draft';

/** A localStorage stand-in. */
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const DRAFT: ApplyDraft = {
  step: 3,
  phone: '(617) 555-0177',
  phoneCountry: 'US',
  vehicleType: 'SCOOTER',
  plate: '7KT 342',
  idDocumentType: null,
  idExpiresOn: '2029-03-03',
  photoUploadId: '01937c4a-0000-7000-8000-000000000001',
  idDocumentUploadId: null,
};

describe('the application draft on this phone (design 4.2)', () => {
  it('gives the draft back to the same account within 24 hours', () => {
    const store = memory();
    saveApplyDraft('luis', DRAFT, { store, now: 0 });
    expect(readApplyDraft('luis', { store, now: APPLY_DRAFT_LIFETIME_MS - 1 })).toEqual(DRAFT);
  });

  it('never stores the ID number, even when it is handed over', () => {
    const store = memory();
    saveApplyDraft('luis', { ...DRAFT, idNumber: 'S48204821' } as ApplyDraft, { store, now: 0 });
    const raw = [...store.values.values()].join('');
    expect(raw).not.toContain('S48204821');
    expect(raw).not.toContain('idNumber');
  });

  it("never gives one account's draft to another", () => {
    const store = memory();
    saveApplyDraft('luis', DRAFT, { store, now: 0 });
    expect(readApplyDraft('maya', { store, now: 1 })).toBeNull();
  });

  it('forgets a draft older than 24 hours', () => {
    const store = memory();
    saveApplyDraft('luis', DRAFT, { store, now: 0 });
    expect(readApplyDraft('luis', { store, now: APPLY_DRAFT_LIFETIME_MS + 1 })).toBeNull();
    expect(store.values.size).toBe(0);
  });

  it('forgets a damaged draft', () => {
    const store = memory();
    store.setItem('foodz.partner-apply:luis', '{not json');
    expect(readApplyDraft('luis', { store, now: 0 })).toBeNull();
    expect(store.values.size).toBe(0);
  });

  it('deletes one draft on send, and every draft on sign-out', () => {
    const store = memory();
    saveApplyDraft('luis', DRAFT, { store, now: 0 });
    saveApplyDraft('ana', DRAFT, { store, now: 0 });
    store.setItem('other', 'kept');
    forgetApplyDraft('luis', { store });
    expect(readApplyDraft('luis', { store, now: 0 })).toBeNull();
    forgetApplyDrafts({ store });
    expect([...store.values.keys()]).toEqual(['other']);
  });

  it('carries on without storage', () => {
    expect(() => saveApplyDraft('luis', DRAFT, { store: null })).not.toThrow();
    expect(readApplyDraft('luis', { store: null })).toBeNull();
  });
});
