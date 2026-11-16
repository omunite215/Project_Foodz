import type { Permission } from '@/server/auth/roles';
import type { BucketKind } from '@/server/storage/s3';

export const UPLOAD_PURPOSES = [
  'MENU_IMAGE',
  'BANNER',
  'BLOG_COVER',
  'AVATAR',
  'PARTNER_PHOTO',
  'PARTNER_DOCUMENT',
  'REFUND_PHOTO',
  'REPORT_PHOTO',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Formats people may upload. Everything is re-encoded to WebP before it is used. */
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export interface UploadPolicy {
  bucket: BucketKind;
  maxBytes: number;
  /** Longest side after resizing, in pixels. */
  maxDimension: number;
  /** Needed on top of being signed in; undefined means any signed-in user. */
  permission?: Permission;
}

const MB = 1024 * 1024;

export const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
  MENU_IMAGE: {
    bucket: 'PUBLIC',
    maxBytes: 8 * MB,
    maxDimension: 2000,
    permission: { menu: ['update'] },
  },
  BANNER: {
    bucket: 'PUBLIC',
    maxBytes: 8 * MB,
    maxDimension: 2400,
    permission: { campaign: ['update'] },
  },
  BLOG_COVER: {
    bucket: 'PUBLIC',
    maxBytes: 8 * MB,
    maxDimension: 2400,
    permission: { blog: ['update'] },
  },
  AVATAR: { bucket: 'PRIVATE', maxBytes: 5 * MB, maxDimension: 512 },
  PARTNER_PHOTO: {
    bucket: 'PRIVATE',
    maxBytes: 5 * MB,
    maxDimension: 1024,
    permission: { partner: ['apply'] },
  },
  // Readable ID scans need more pixels than a profile photo.
  PARTNER_DOCUMENT: {
    bucket: 'PRIVATE',
    maxBytes: 10 * MB,
    maxDimension: 2400,
    permission: { partner: ['apply'] },
  },
  REFUND_PHOTO: {
    bucket: 'PRIVATE',
    maxBytes: 10 * MB,
    maxDimension: 1600,
    permission: { order: ['create'] },
  },
  REPORT_PHOTO: {
    bucket: 'PRIVATE',
    maxBytes: 10 * MB,
    maxDimension: 1600,
    permission: { order: ['create'] },
  },
};

/** Where files wait, unread by anyone, until the background check has run. */
export const quarantineKey = (uploadId: string) => `quarantine/${uploadId}`;

export const finalKey = (purpose: UploadPurpose, uploadId: string) =>
  `${purpose.toLowerCase().replace(/_/g, '-')}/${uploadId}.webp`;
