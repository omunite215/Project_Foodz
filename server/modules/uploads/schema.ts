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
