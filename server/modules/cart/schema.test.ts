import { describe, expect, it } from 'vitest';
import { cleanFlavor, cleanNote, normalizeCode, quoteInput } from './schema';

const GIMBAP = '01933b2e-7c4a-7d10-9b1a-2c3d4e5f6a7b';
const line = (extra: Record<string, unknown> = {}) => ({
  key: 'a',
  menuItemId: GIMBAP,
  quantity: 2,
  ...extra,
});

describe('promo codes as typed (S4.2)', () => {
  it('ignores case, spaces, line breaks and invisible characters', () => {
    for (const typed of [' kbbq5 ', 'KBBQ 5', 'kbbq5\n', 'kb\tbq5', 'k​bbq5', 'ＫＢＢＱ５']) {
      expect(normalizeCode(typed)).toBe('KBBQ5');
    }
    expect(normalizeCode('credit-priya-7q2xk9')).toBe('CREDIT-PRIYA-7Q2XK9');
  });

  it('treats an empty code as no code and refuses one longer than 32 characters', () => {
    expect(quoteInput.parse({ lines: [], code: '   ' }).code).toBe('');
    expect(quoteInput.parse({ lines: [], code: ' kbbq 5 ' }).code).toBe('KBBQ5');
    expect(quoteInput.safeParse({ lines: [], code: 'A'.repeat(33) }).success).toBe(false);
    expect(quoteInput.safeParse({ lines: [], code: 'A'.repeat(65) }).success).toBe(false);
    // Spaces don't count towards the 32.
    expect(quoteInput.safeParse({ lines: [], code: 'A '.repeat(32) }).success).toBe(true);
  });
});

describe('kitchen notes and flavors (S1.16)', () => {
  it('removes control characters from a note and keeps everything else as typed', () => {
    expect(cleanNote('No cucumber\u0000 please')).toBe('No cucumber  please');
    expect(cleanNote('Line one\r\nLine two')).toBe('Line one Line two');
    expect(cleanNote('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(cleanNote('  ‮evil‬  ')).toBe('evil');
    // The joiners some scripts need stay.
    expect(cleanNote('क्‍ष')).toBe('क्‍ष');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });

  it('cleans flavor names before comparing them with the dish', () => {
    expect(cleanFlavor(' Gochujang\u0007 ')).toBe('Gochujang');
    expect(cleanFlavor('​')).toBe('');
  });
});

describe('quote input', () => {
  it('accepts a cart and defaults the delivery to the default address', () => {
    const parsed = quoteInput.parse({
      lines: [line({ flavors: ['Gochujang'], note: 'Extra napkins' })],
    });
    expect(parsed.delivery).toEqual({ kind: 'default' });
    expect(parsed.lines[0]).toMatchObject({ quantity: 2, flavors: ['Gochujang'] });
  });

  it('refuses tampered lines with a plain error, pricing nothing', () => {
    const refused = [
      { lines: [line({ quantity: 999 })] },
      { lines: [line({ quantity: 0 })] },
      { lines: [line({ quantity: 1.5 })] },
      { lines: [line({ note: 'x'.repeat(201) })] },
      { lines: [line({ flavors: ['a', 'b', 'c', 'd', 'e', 'f'] })] },
      { lines: [line({ flavors: ['x'.repeat(41)] })] },
      { lines: [line({ menuItemId: 'gimbap' })] },
      // A price or a discount from the browser is never accepted.
      { lines: [line({ unitPriceCents: 1 })] },
      { lines: [line()], discountCents: 500 },
      { lines: [line()], totalCents: 1 },
      { lines: [line(), line()] },
      { lines: Array.from({ length: 101 }, (_, i) => line({ key: String(i) })) },
      { lines: [], delivery: { kind: 'saved', addressId: 'home' } },
      { lines: [], delivery: { kind: 'point', lat: 95, lng: 0 } },
      { lines: [], delivery: { kind: 'saved', addressId: GIMBAP, userId: GIMBAP } },
    ];
    for (const input of refused) expect(quoteInput.safeParse(input).success).toBe(false);
  });

  it('leaves the 25-line and 50-item limits to the service, which names the phone number', () => {
    const lines = Array.from({ length: 26 }, (_, i) => line({ key: String(i), quantity: 1 }));
    expect(quoteInput.safeParse({ lines }).success).toBe(true);
  });
});
