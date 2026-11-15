'use server';

import { userAction } from '@/server/action';
import { requirePermission } from '@/server/auth/session';
import { forbidden } from '@/server/errors';
import { UPLOAD_POLICIES } from './policy';
import { requestUploadInput, uploadIdInput } from './schema';
import { confirmUpload, getUpload, requestUpload } from './service';

/** Step 1: permission depends on what the file is for (menu photos need menu rights, ...). */
export const requestUploadAction = userAction
  .metadata({ name: 'uploads.request', rateLimit: 'upload.request' })
  .inputSchema(requestUploadInput)
  .action(async ({ parsedInput, ctx }) => {
    const { permission } = UPLOAD_POLICIES[parsedInput.purpose];
    const actor = permission ? await requirePermission(permission) : ctx.actor;
    // Demo accounts are shared, so they never store files.
    if (actor.isDemo) throw forbidden();
    return requestUpload(actor, parsedInput);
  });

/** Step 2: the file is in place; queue the check. */
export const confirmUploadAction = userAction
  .metadata({ name: 'uploads.confirm', rateLimit: 'upload.request' })
  .inputSchema(uploadIdInput)
  .action(async ({ parsedInput, ctx }) => confirmUpload(ctx.actor, parsedInput));

/** Polled until the upload is ready or rejected. */
export const uploadStatusAction = userAction
  .metadata({ name: 'uploads.status' })
  .inputSchema(uploadIdInput)
  .action(async ({ parsedInput, ctx }) => getUpload(ctx.actor, parsedInput));
