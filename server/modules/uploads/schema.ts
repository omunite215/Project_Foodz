import { z } from 'zod';
import { ACCEPTED_IMAGE_TYPES, UPLOAD_PURPOSES } from './policy';

export const requestUploadInput = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    contentType: z.enum(ACCEPTED_IMAGE_TYPES),
    /** Checked again against the purpose's own limit. */
    sizeBytes: z
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();

export const uploadIdInput = z.object({ uploadId: z.uuid() }).strict();

/**
 * Why the check refused a file (F6 design 4.4), so the form can pick its message without
 * reading text: over the purpose's limit, not an accepted image type, or unreadable (a
 * disguised file, a decompression bomb). `NOT_RECEIVED`: the file never arrived.
 */
export const UPLOAD_REJECT_CODES = ['TOO_LARGE', 'BAD_TYPE', 'UNREADABLE', 'NOT_RECEIVED'] as const;
export type UploadRejectCode = (typeof UPLOAD_REJECT_CODES)[number];

/**
 * What `uploadStatusAction` answers (owner only). The browser polls while `CHECKING`; a READY
 * private file comes with a fresh 5-minute link each time. An upload that is gone (unsent for
 * 24 hours, replaced, withdrawn) answers `NOT_FOUND`.
 */
export type UploadStatusView =
  | { uploadId: string; status: 'CHECKING' }
  | { uploadId: string; status: 'READY'; url: string; expiresAt: string | null }
  | { uploadId: string; status: 'REJECTED'; code: UploadRejectCode; reason: string };
