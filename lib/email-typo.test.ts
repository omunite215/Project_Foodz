import { describe, expect, it } from 'vitest';
import { editDistance, suggestEmail } from './email-typo';
import { EMAIL_HANDOFF_KEY, forgetEmail, recalledEmail, rememberEmail } from './email-handoff';

describe('suggestEmail', () => {
  it('suggests a common domain one edit away', () => {
    expect(suggestEmail('maya@gmial.com')).toBe('maya@gmail.com');
    expect(suggestEmail('maya@gmail.co')).toBe('maya@gmail.com');
    expect(suggestEmail('Maya@Hotmial.com ')).toBe('maya@hotmail.com');
    expect(suggestEmail('maya@yahooo.com')).toBe('maya@yahoo.com');
  });

  it('stays quiet for correct, unusual or unfinished addresses', () => {
    expect(suggestEmail('maya@gmail.com')).toBeNull();
    expect(suggestEmail('maya@example.com')).toBeNull();
    expect(suggestEmail('maya@')).toBeNull();
    expect(suggestEmail('@gmail.co')).toBeNull();
  });

  it('counts a swap of neighbours as one edit', () => {
    expect(editDistance('gmial.com', 'gmail.com')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
});

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe('email hand-off', () => {
  it('keeps, recalls and forgets the typed email', () => {
    const store = memory();
    rememberEmail('  maya@example.com ', store);
    expect(store.values.get(EMAIL_HANDOFF_KEY)).toBe('maya@example.com');
    expect(recalledEmail(store)).toBe('maya@example.com');
    forgetEmail(store);
    expect(recalledEmail(store)).toBe('');
  });

  it('survives blocked storage', () => {
    const blocked = {
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
    expect(() => rememberEmail('a@b.co', blocked)).not.toThrow();
    expect(recalledEmail(blocked)).toBe('');
    expect(recalledEmail(null)).toBe('');
  });
});
