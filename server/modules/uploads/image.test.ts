import sharp, { type Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkAndReencode } from './image';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 4, g: 185, b: 11 } } });

/** A phone-style photo: landscape pixels, a "rotate 90°" orientation tag and GPS coordinates. */
function phonePhoto() {
  return solid(400, 200)
    .withExif({
      IFD0: { Make: 'PhoneCo', Model: 'Phone 15' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '42/1 20/1 4/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '71/1 5/1 26/1',
      },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

describe('checkAndReencode', () => {
  it('re-encodes a photo to WebP with no metadata left, upright', async () => {
    const input = await phonePhoto();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await checkAndReencode(input, 2000);
    if (!result.ok) throw new Error(result.reason);

    const output = await sharp(result.data).metadata();
    expect(output.format).toBe('webp');
    expect(output.exif).toBeUndefined();
    expect(output.icc).toBeUndefined();
    expect(output.orientation).toBeUndefined();
    // The orientation tag was applied to the pixels before it was dropped.
    expect([result.width, result.height]).toEqual([200, 400]);
    expect(result.data.includes('PhoneCo')).toBe(false);
  });

  it('shrinks large images to the purpose limit and never enlarges small ones', async () => {
    const large = await checkAndReencode(await solid(4000, 3000).png().toBuffer(), 1600);
    expect(large.ok && [large.width, large.height]).toEqual([1600, 1200]);

    const small = await checkAndReencode(await solid(120, 80).webp().toBuffer(), 1600);
    expect(small.ok && [small.width, small.height]).toEqual([120, 80]);
  });

  it('accepts JPEG, PNG, WebP and AVIF', async () => {
    for (const encode of [
      (i: Sharp) => i.jpeg(),
      (i: Sharp) => i.png(),
      (i: Sharp) => i.webp(),
      (i: Sharp) => i.avif(),
    ]) {
      expect((await checkAndReencode(await encode(solid(64, 64)).toBuffer(), 512)).ok).toBe(true);
    }
  });

  it.each([
    [
      'an SVG with a script',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
      ),
    ],
    ['an HTML page', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['plain text', Buffer.from('just some text')],
    ['an empty file', Buffer.alloc(0)],
  ])('rejects %s', async (_label, input) => {
    expect(await checkAndReencode(input, 512)).toEqual({
      ok: false,
      code: 'BAD_TYPE',
      reason: 'Only JPEG, PNG, WebP and AVIF images are accepted.',
    });
  });

  it('rejects GIFs', async () => {
    const gif = await solid(32, 32).gif().toBuffer();
    expect((await checkAndReencode(gif, 512)).ok).toBe(false);
  });

  it('rejects a damaged image', async () => {
    const jpeg = await solid(256, 256).jpeg().toBuffer();
    const result = await checkAndReencode(jpeg.subarray(0, 200), 512);
    expect(result).toEqual({
      ok: false,
      code: 'UNREADABLE',
      reason: 'The image could not be read. Try a different file.',
    });
  });

  it('drops anything hidden after the image data', async () => {
    const jpeg = await solid(64, 64).jpeg().toBuffer();
    const polyglot = Buffer.concat([jpeg, Buffer.from('<script>alert(1)</script>')]);

    const result = await checkAndReencode(polyglot, 512);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.includes('<script>')).toBe(false);
  });

  it('refuses images that would decode to too many pixels', async () => {
    // Tiny on disk, 42 megapixels once decoded.
    const bomb = await solid(7000, 6000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect((await checkAndReencode(bomb, 2000)).ok).toBe(false);
  }, 30_000);
});
