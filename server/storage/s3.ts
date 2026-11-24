import 'server-only';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3ClientConfig } from './s3-config';

/**
 * Object storage through the S3 API: RustFS locally (access keys), Amazon S3 on AWS (the task role).
 *
 * PUBLIC holds images anyone may see (menu, banners, blog covers) and is served straight from
 * the bucket. PRIVATE holds everything personal (ID documents, refund photos, avatars) plus
 * the quarantine area for files that have not been checked yet; it is only ever read through
 * short-lived signed links.
 */
export type BucketKind = 'PUBLIC' | 'PRIVATE';

function createClient() {
  return new S3Client({
    ...s3ClientConfig(process.env),
    // Default checksums add query parameters that browsers, R2 and RustFS do not handle.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // Without these a stalled storage server hangs the request indefinitely. A timed-out call is
    // retried on a new connection, then fails. throwOnRequestTimeout is needed: without it the SDK
    // only logs a warning and keeps waiting.
    requestHandler: {
      connectionTimeout: 3_000,
      requestTimeout: 10_000,
      throwOnRequestTimeout: true,
    },
    maxAttempts: 3,
  });
}

let client: S3Client | undefined;
const s3 = () => (client ??= createClient());

export function bucketName(kind: BucketKind) {
  const name = kind === 'PUBLIC' ? process.env.S3_PUBLIC_BUCKET : process.env.S3_PRIVATE_BUCKET;
  if (!name) throw new Error(`S3_${kind}_BUCKET is not set`);
  return name;
}

/**
 * A URL the browser can PUT one file to. The content type and exact size are part of the
 * signature, so a different or larger file is refused by the storage server.
 */
export function presignUpload(
  kind: BucketKind,
  key: string,
  file: { contentType: string; sizeBytes: number },
  expiresInSeconds = 300,
) {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucketName(kind),
      Key: key,
      ContentType: file.contentType,
      ContentLength: file.sizeBytes,
    }),
    { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

/** Size in bytes, or null when there is no such object. */
export async function objectSize(kind: BucketKind, key: string): Promise<number | null> {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucketName(kind), Key: key }));
    return head.ContentLength ?? 0;
  } catch (error) {
    if (error instanceof NotFound || (error instanceof Error && error.name === 'NotFound')) {
      return null;
    }
    throw error;
  }
}

/** Reads a whole object, refusing anything larger than `maxBytes`. */
export async function readObject(kind: BucketKind, key: string, maxBytes: number) {
  const object = await s3().send(new GetObjectCommand({ Bucket: bucketName(kind), Key: key }));
  if (!object.Body) throw new Error('Empty object');
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength > maxBytes) throw new Error('Object is larger than allowed');
  return Buffer.from(bytes);
}

export async function writeObject(
  kind: BucketKind,
  key: string,
  body: Buffer,
  options: { contentType: string; cacheControl?: string },
) {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucketName(kind),
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
    }),
  );
}

export async function deleteObject(kind: BucketKind, key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucketName(kind), Key: key }));
}

/** A short-lived link to a private object, for staff reviewing documents or photos. */
export function presignDownload(kind: BucketKind, key: string, expiresInSeconds = 300) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucketName(kind), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export function publicUrl(key: string) {
  return `${(process.env.S3_PUBLIC_URL ?? '').replace(/\/+$/, '')}/${key}`;
}
