import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import type { UserActor } from '@/server/auth/session';
import { runAs, runAsSystem } from '@/server/db/context';
import { conflict, invalidInput, notFound } from '@/server/errors';
import { inngest, uploadReceived } from '@/server/jobs/client';
import {
  deleteObject,
  objectSize,
  presignDownload,
  presignUpload,
  publicUrl,
  readObject,
  writeObject,
} from '@/server/storage/s3';
import { checkAndReencode } from './image';
import { finalKey, quarantineKey, UPLOAD_POLICIES } from './policy';
import { createPendingUpload, findUpload, markReady, markRejected } from './repo';
import {
  requestUploadInput,
  UPLOAD_REJECT_CODES,
  type UploadRejectCode,
  type UploadStatusView,
  uploadIdInput,
} from './schema';

/*
 * Uploads in three steps:
 *   1. requestUpload: the browser gets a short-lived URL to put one file into quarantine.
 *   2. confirmUpload: once the file is there, a background job is queued.
 *   3. processUpload (the job): checks what the file really is, re-encodes it (dropping all
 *      metadata) and stores the result in the public or private bucket. Nothing in quarantine
 *      is ever served to anyone.
 * Who may upload for which purpose is checked by the server action before step 1.
 */

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

export async function requestUpload(actor: UserActor, input: unknown) {
  const { purpose, contentType, sizeBytes } = requestUploadInput.parse(input);
  const policy = UPLOAD_POLICIES[purpose];
  if (sizeBytes > policy.maxBytes) {
    throw invalidInput('That file is too large.', {
      sizeBytes: [`Files for this can be at most ${mb(policy.maxBytes)} MB.`],
    });
  }

  const uploadId = uuidv7();
  const key = quarantineKey(uploadId);
  await runAs(actor, (ctx) =>
    createPendingUpload(ctx, {
      id: uploadId,
      key,
      bucket: policy.bucket,
      purpose,
      ownerId: actor.userId,
      contentType,
      sizeBytes,
    }),
  );
  const url = await presignUpload('PRIVATE', key, { contentType, sizeBytes });
  return { uploadId, url, method: 'PUT' as const, headers: { 'content-type': contentType } };
}

export async function confirmUpload(actor: UserActor, input: unknown) {
  const { uploadId } = uploadIdInput.parse(input);
  const upload = await runAs(actor, (ctx) => findUpload(ctx, uploadId));
  if (!upload || upload.ownerId !== actor.userId || upload.status !== 'PENDING') {
    throw notFound('That upload');
  }

  const size = await objectSize('PRIVATE', upload.key);
  if (size === null) throw conflict('The file has not finished uploading yet.');

  // One job per upload, however many times the browser confirms.
  await inngest.send(uploadReceived.create({ uploadId }, { id: `upload-${uploadId}` }));
  return { uploadId, status: 'PROCESSING' as const };
}

/** The background job. Returns what happened, for the job log. */
export async function processUpload(uploadId: string): Promise<'ready' | 'rejected' | 'skipped'> {
  const upload = await runAsSystem('upload check', (ctx) => findUpload(ctx, uploadId));
  if (!upload || upload.status !== 'PENDING') return 'skipped';
  const policy = UPLOAD_POLICIES[upload.purpose];

  const reject = async (code: UploadRejectCode, reason: string) => {
    await deleteObject('PRIVATE', upload.key);
    await runAsSystem('upload rejected', (ctx) => markRejected(ctx, uploadId, { code, reason }));
    return 'rejected' as const;
  };

  const size = await objectSize('PRIVATE', upload.key);
  if (size === null) {
    await runAsSystem('upload missing', (ctx) =>
      markRejected(ctx, uploadId, { code: 'NOT_RECEIVED', reason: 'The file never arrived.' }),
    );
    return 'rejected';
  }
  // The upload URL fixes the size, so this only trips if the storage ignored it.
  if (size !== upload.sizeBytes || size > policy.maxBytes) {
    return reject('TOO_LARGE', `Files for this can be at most ${mb(policy.maxBytes)} MB.`);
  }

  const checked = await checkAndReencode(
    await readObject('PRIVATE', upload.key, policy.maxBytes),
    policy.maxDimension,
  );
  if (!checked.ok) return reject(checked.code, checked.reason);

  const key = finalKey(upload.purpose, uploadId);
  await writeObject(policy.bucket, key, checked.data, {
    contentType: 'image/webp',
    cacheControl:
      policy.bucket === 'PUBLIC' ? 'public, max-age=31536000, immutable' : 'private, no-store',
  });
  await runAsSystem('upload ready', (ctx) =>
    markReady(ctx, uploadId, {
      key,
      sizeBytes: checked.data.byteLength,
      width: checked.width,
      height: checked.height,
    }),
  );
  await deleteObject('PRIVATE', upload.key);
  return 'ready';
}

const LINK_SECONDS = 300;

const isRejectCode = (value: string | null): value is UploadRejectCode =>
  value !== null && (UPLOAD_REJECT_CODES as readonly string[]).includes(value);

/**
 * Where an upload stands, for the browser to poll (F6 design 4.4): checking, ready with a fresh
 * 5-minute link for private files, or refused with a code. Only the person who uploaded it may
 * ask (T4): staff reach partner files through the review page.
 */
export async function getUpload(actor: UserActor, input: unknown): Promise<UploadStatusView> {
  const { uploadId } = uploadIdInput.parse(input);
  const upload = await runAs(actor, (ctx) => findUpload(ctx, uploadId));
  if (!upload || upload.ownerId !== actor.userId) throw notFound('That upload');

  if (upload.status === 'PENDING') return { uploadId, status: 'CHECKING' };
  if (upload.status === 'REJECTED') {
    return {
      uploadId,
      status: 'REJECTED',
      code: isRejectCode(upload.rejectCode) ? upload.rejectCode : 'UNREADABLE',
      reason: upload.rejectedReason ?? 'The image could not be read. Try a different file.',
    };
  }
  if (upload.bucket === 'PUBLIC') {
    return { uploadId, status: 'READY', url: publicUrl(upload.key), expiresAt: null };
  }
  return {
    uploadId,
    status: 'READY',
    url: await presignDownload('PRIVATE', upload.key, LINK_SECONDS),
    expiresAt: new Date(Date.now() + LINK_SECONDS * 1000).toISOString(),
  };
}
