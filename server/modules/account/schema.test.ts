import { describe, expect, it } from 'vitest';
import { nameSchema } from './schema';

const REFUSED = 'Use letters, numbers and punctuation only.';

describe('nameSchema', () => {
  it.each([
    ['Maya Lopez', 'Maya Lopez'],
    ['  Nguyễn   Thị Minh  ', 'Nguyễn Thị Minh'],
    ['김민지', '김민지'],
    ['أحمد علي', 'أحمد علي'],
    // Persian spells "Alireza" with a zero-width non-joiner.
    ['علی\u200Cرضا', 'علی\u200Cرضا'],
    // A byte-order mark counts as white space and is dropped.
    ['\uFEFFMaya', 'Maya'],
    // Emoji sequences hold zero-width joiners.
    ['Sam 👩\u200D🍳', 'Sam 👩\u200D🍳'],
  ])('accepts %j', (raw, stored) => {
    expect(nameSchema.parse(raw)).toBe(stored);
  });

  it.each([
    ['a right-to-left override', 'Maya\u202Emoc.live'],
    ['a left-to-right embedding', 'Maya\u202ALopez'],
    ['a bidi isolate', 'Maya\u2066Lopez\u2069'],
    ['a pop directional formatting', 'Maya\u202C'],
    ['an Arabic letter mark', 'Maya\u061CLopez'],
    ['a zero-width space', 'Ma\u200Bya'],
    ['a left-to-right mark', 'Maya\u200E'],
    ['a soft hyphen', 'Ma\u00ADya'],
    ['a control character', 'Maya\u0007'],
  ])('refuses %s', (_what, raw) => {
    const result = nameSchema.safeParse(raw);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(REFUSED);
  });

  it('refuses an empty or overlong name', () => {
    expect(nameSchema.safeParse('   ').error?.issues[0]?.message).toBe('Enter your name.');
    expect(nameSchema.safeParse('x'.repeat(61)).error?.issues[0]?.message).toBe(
      'Use 60 characters or fewer.',
    );
  });
});
