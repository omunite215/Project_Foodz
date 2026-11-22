import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DRAFT_LIFETIME_MS,
  forgetDraft,
  forgetDrafts,
  hasUnsavedChanges,
  markUnsaved,
  onUnsavedChangesSettled,
  saveDraft,
  takeDraft,
} from './form-draft';

/** A sessionStorage stand-in for one tab. */
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const profile = z.object({ name: z.string(), phone: z.string() });
const MAYA = '0196a1b2-0000-7000-8000-00000000000a';
const PRIYA = '0196a1b2-0000-7000-8000-00000000000b';
const typed = { name: 'Maya Draft Name', phone: '(617) 555-0142' };
const NOW = Date.UTC(2026, 10, 20, 9, 0);

describe('form drafts (S2.12)', () => {
  it('gives the draft back once, to the account that typed it', () => {
    const store = memory();
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    expect(store.values.has('foodz.draft:/account')).toBe(true);
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW + 60_000 })).toEqual(typed);
    // Given back means gone.
    expect(store.values.size).toBe(0);
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW + 60_000 })).toBeNull();
  });

  it('never gives it to someone else signing in on the same device, and drops it', () => {
    const store = memory();
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    expect(takeDraft('/account', PRIYA, profile, { store, now: NOW })).toBeNull();
    expect(store.values.size).toBe(0);
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW })).toBeNull();
  });

  it('keeps a draft for 30 minutes at most', () => {
    const store = memory();
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW + DRAFT_LIFETIME_MS })).toEqual(
      typed,
    );
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    expect(
      takeDraft('/account', MAYA, profile, { store, now: NOW + DRAFT_LIFETIME_MS + 1 }),
    ).toBeNull();
    expect(store.values.size).toBe(0);
    // A clock that went backwards proves nothing about the draft's age.
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW - 1 })).toBeNull();
  });

  it('keeps one draft per form, by its path', () => {
    const store = memory();
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    saveDraft('/account/addresses/new', MAYA, { line2: 'Apt 9' }, { store, now: NOW });
    expect(takeDraft('/account/addresses/new', MAYA, profile, { store, now: NOW })).toBeNull();
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW })).toEqual(typed);
  });

  it('refuses anything that is not a draft of this form', () => {
    const store = memory();
    store.setItem('foodz.draft:/account', 'not json');
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW })).toBeNull();
    store.setItem('foodz.draft:/account', JSON.stringify({ values: typed }));
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW })).toBeNull();
    saveDraft('/account', MAYA, { name: 42 }, { store, now: NOW });
    expect(takeDraft('/account', MAYA, profile, { store, now: NOW })).toBeNull();
    expect(store.values.size).toBe(0);
  });

  it('forgets one form once saved, and every draft on signing out', () => {
    const store = memory();
    store.setItem('foodz.auth.email', 'maya@example.com');
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    saveDraft('/account/addresses/new', MAYA, {}, { store, now: NOW });
    forgetDraft('/account', { store });
    expect([...store.values.keys()]).toEqual([
      'foodz.auth.email',
      'foodz.draft:/account/addresses/new',
    ]);
    saveDraft('/account', MAYA, typed, { store, now: NOW });
    forgetDrafts({ store });
    // Only drafts: other keys belong to other features.
    expect([...store.values.keys()]).toEqual(['foodz.auth.email']);
  });

  it('survives blocked storage', () => {
    const blocked = {
      length: 0,
      key: () => {
        throw new Error('blocked');
      },
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveDraft('/account', MAYA, typed, { store: blocked })).not.toThrow();
    expect(takeDraft('/account', MAYA, profile, { store: blocked })).toBeNull();
    expect(() => forgetDraft('/account', { store: blocked })).not.toThrow();
    expect(() => forgetDrafts({ store: { ...blocked, length: 1 } })).not.toThrow();
    expect(takeDraft('/account', MAYA, profile, { store: null })).toBeNull();
  });
});

describe('unsaved changes', () => {
  it('holds while any form has changes, and says when the last one lets go', () => {
    let settled = 0;
    const stop = onUnsavedChangesSettled(() => settled++);
    expect(hasUnsavedChanges()).toBe(false);
    markUnsaved('profile', true);
    markUnsaved('address', true);
    markUnsaved('profile', false);
    expect(hasUnsavedChanges()).toBe(true);
    expect(settled).toBe(0);
    markUnsaved('address', false);
    expect(hasUnsavedChanges()).toBe(false);
    expect(settled).toBe(1);
    // Nothing to let go of: no news.
    markUnsaved('address', false);
    expect(settled).toBe(1);
    stop();
    markUnsaved('profile', true);
    markUnsaved('profile', false);
    expect(settled).toBe(1);
  });
});
