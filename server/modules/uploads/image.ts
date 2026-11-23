import 'server-only';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { ACCEPTED_IMAGE_TYPES } from './policy';
import type { UploadRejectCode } from './schema';

export type CheckedImage =
  | { ok: true; data: Buffer; width: number; height: number }
  | { ok: false; code: UploadRejectCode; reason: string };

/** Refuses images that would decode to more pixels than this (decompression bombs). */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Decides what a file really is from its bytes (never its name or declared type), then
 * re-encodes accepted images to WebP. Re-encoding drops every bit of metadata, including EXIF
 * GPS positions in phone photos, and anything hidden after the image data.
 */
export async function checkAndReencode(input: Buffer, maxDimension: number): Promise<CheckedImage> {
  const type = await fileTypeFromBuffer(input);
  if (!type || !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type.mime)) {
    return {
      ok: false,
      code: 'BAD_TYPE',
      reason: 'Only JPEG, PNG, WebP and AVIF images are accepted.',
    };
  }

  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    })
      .rotate() // apply the camera orientation before the orientation tag is dropped
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, data, width: info.width, height: info.height };
  } catch {
    return {
      ok: false,
      code: 'UNREADABLE',
      reason: 'The image could not be read. Try a different file.',
    };
  }
}
