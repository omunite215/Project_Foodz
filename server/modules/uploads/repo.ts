import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { BucketKind } from '@/server/storage/s3';
import type { UploadPurpose } from './policy';

const fields = {
  id: true,
  key: true,
  bucket: true,
  purpose: true,
  status: true,
  ownerId: true,
  sizeBytes: true,
  rejectedReason: true,
} as const;

export function createPendingUpload(
  ctx: DbContext,
  data: {
    id: string;
    key: string;
    bucket: BucketKind;
    purpose: UploadPurpose;
    ownerId: string;
    contentType: string;
    sizeBytes: number;
  },
) {
  return db(ctx).upload.create({ data, select: { id: true } });
}

/** Row-level security limits this to the caller's own uploads (and staff who may see them). */
export function findUpload(ctx: DbContext, id: string) {
  return db(ctx).upload.findUnique({ where: { id }, select: fields });
}

export function markReady(
  ctx: DbContext,
  id: string,
  data: { key: string; sizeBytes: number; width: number; height: number },
) {
  return db(ctx).upload.update({
    where: { id },
    data: { ...data, status: 'READY', contentType: 'image/webp', processedAt: new Date() },
    select: { id: true },
  });
}

export function markRejected(ctx: DbContext, id: string, reason: string) {
  return db(ctx).upload.update({
    where: { id },
    data: { status: 'REJECTED', rejectedReason: reason, processedAt: new Date() },
    select: { id: true },
  });
}
