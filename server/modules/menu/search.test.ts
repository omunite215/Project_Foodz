import { describe, expect, it } from 'vitest';
import { menuSearchInput } from './schema';
import { searchTerms } from './search';

describe('search terms', () => {
  it('collapses spacing and keeps the last word as the start of a word', () => {
    expect(searchTerms('  pad   THAI ')).toEqual({
      query: 'pad THAI',
      head: 'pad',
      prefix: 'THAI:*',
      letters: 7,
    });
    expect(searchTerms('bul')).toMatchObject({ head: '', prefix: 'bul:*' });
    expect(searchTerms('phở bò')).toMatchObject({ query: 'phở bò', head: 'phở', prefix: 'bò:*' });
    expect(searchTerms('김밥')).toMatchObject({ prefix: '김밥:*', letters: 2 });
  });

  it('never turns query syntax or symbols into a prefix term', () => {
    for (const raw of [
      "' OR 1=1 --",
      '.*',
      '!!!',
      'noodles -pork',
      '"pad thai',
      'pad or',
      'a:*|b',
    ]) {
      expect(searchTerms(raw).prefix).toBeNull();
    }
    // A closed quote is a finished phrase; the word after it can be a prefix.
    expect(searchTerms('"pad thai" no').prefix).toBe('no:*');
  });

  it('ignores control characters and cuts long text to 100 characters (S6.8, S6.14)', () => {
    expect(searchTerms('\u0000').query).toBe('');
    expect(searchTerms('pho\u0000bo')).toMatchObject({ query: 'pho bo', prefix: 'bo:*' });
    const long = searchTerms('a'.repeat(500));
    expect(long.query).toHaveLength(100);
    // Cut by characters, never in the middle of one.
    expect(Array.from(searchTerms('😋'.repeat(150)).query)).toHaveLength(100);
  });

  it('counts letters and digits only', () => {
    expect(searchTerms('!!!').letters).toBe(0);
    expect(searchTerms('the').letters).toBe(3);
  });
});

describe('search input', () => {
  it('accepts up to 1000 characters and refuses anything else', () => {
    expect(menuSearchInput.safeParse({ q: 'x'.repeat(1000) }).success).toBe(true);
    expect(menuSearchInput.safeParse({ q: 'x'.repeat(1001) }).success).toBe(false);
    expect(menuSearchInput.safeParse({ q: 1 }).success).toBe(false);
    expect(menuSearchInput.safeParse({ q: 'pho', regex: '.*' }).success).toBe(false);
  });
});
