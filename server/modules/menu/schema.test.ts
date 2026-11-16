import { describe, expect, it } from 'vitest';
import { dishIdsInput, dishSlugSchema, dishSuggestionsInput, openingHoursSchema } from './schema';

const id = '0196a1b2-0000-7000-8000-000000000001';

describe('openingHoursSchema', () => {
  it('accepts a week with closed days left out or null', () => {
    const hours = {
      mon: { open: '11:00', close: '22:00' },
      tue: null,
      sun: { open: '12:00', close: '00:00' },
    };
    expect(openingHoursSchema.parse(hours)).toEqual(hours);
  });

  it.each(['24:00', '9:00', '11:60', '11h00', ''])('rejects the time %j', (time) => {
    expect(openingHoursSchema.safeParse({ mon: { open: time, close: '22:00' } }).success).toBe(
      false,
    );
  });
});

describe('dishSlugSchema', () => {
  it('accepts canonical slugs only', () => {
    expect(dishSlugSchema.safeParse('banh-khot').success).toBe(true);
    for (const slug of ['Banh-Khot', 'bánh-khọt', '', 'a'.repeat(101), 'a b']) {
      expect(dishSlugSchema.safeParse(slug).success).toBe(false);
    }
  });
});

describe('dishIdsInput', () => {
  it('accepts up to 50 dish ids', () => {
    expect(dishIdsInput.parse({ ids: [id] })).toEqual({ ids: [id] });
    expect(dishIdsInput.safeParse({ ids: Array.from({ length: 50 }, () => id) }).success).toBe(
      true,
    );
  });

  it('rejects empty, oversized, malformed or extra input', () => {
    expect(dishIdsInput.safeParse({ ids: [] }).success).toBe(false);
    expect(dishIdsInput.safeParse({ ids: Array.from({ length: 51 }, () => id) }).success).toBe(
      false,
    );
    expect(dishIdsInput.safeParse({ ids: ['gimbap'] }).success).toBe(false);
    expect(dishIdsInput.safeParse({ ids: [id], priceCents: 1 }).success).toBe(false);
  });
});

describe('dishSuggestionsInput', () => {
  it('defaults to three suggestions and caps the count', () => {
    expect(dishSuggestionsInput.parse({ id, cuisine: 'THAI' })).toEqual({
      id,
      cuisine: 'THAI',
      limit: 3,
    });
    expect(dishSuggestionsInput.safeParse({ id, cuisine: 'THAI', limit: 7 }).success).toBe(false);
    expect(dishSuggestionsInput.safeParse({ id, cuisine: 'PIZZA' }).success).toBe(false);
  });
});
