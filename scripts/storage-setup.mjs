#!/usr/bin/env node
// Prepares the object storage buckets. Safe to run again.
//   - S3_PUBLIC_BUCKET: anyone may read objects (menu, banner and blog images)
//   - S3_PRIVATE_BUCKET: no public access; files left in quarantine/ expire after a day
// Locally this runs against RustFS; for Cloudflare R2 the same settings are made in its dashboard.
import 'dotenv/config';
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

if (!process.env.S3_ENDPOINT) {
  // On AWS the infrastructure code creates the buckets, their policies and lifecycle rules.
  console.warn('S3_ENDPOINT is not set; leaving the buckets to the infrastructure.');
  process.exit(0);
}

const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT'),
  region: process.env.S3_REGION ?? 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
  },
});
const publicBucket = env('S3_PUBLIC_BUCKET');
const privateBucket = env('S3_PRIVATE_BUCKET');

async function createBucket(Bucket) {
  try {
    await s3.send(new CreateBucketCommand({ Bucket }));
  } catch (error) {
    const exists =
      error instanceof BucketAlreadyOwnedByYou || error?.name === 'BucketAlreadyOwnedByYou';
    if (!exists) throw error;
  }
}

/** The storage container may still be starting; keep trying for about 30 seconds. */
async function createWhenReady(Bucket, attempt = 1) {
  try {
    await createBucket(Bucket);
  } catch (error) {
    if (attempt >= 30) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await createWhenReady(Bucket, attempt + 1);
  }
}

async function main() {
  await createWhenReady(publicBucket);
  await createBucket(privateBucket);

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: publicBucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${publicBucket}/*`],
          },
        ],
      }),
    }),
  );

  try {
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: privateBucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-quarantine',
              Status: 'Enabled',
              Filter: { Prefix: 'quarantine/' },
              Expiration: { Days: 1 },
            },
          ],
        },
      }),
    );
  } catch (error) {
    // Not every S3-compatible server supports lifecycle rules; uploads still work without it.
    console.warn(`Could not set the quarantine expiry rule: ${error?.name ?? error}`);
  }
  console.warn('Storage buckets are ready.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
