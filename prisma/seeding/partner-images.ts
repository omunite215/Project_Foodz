import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { fixtureImageSvg, partnerFixtureImages } from './partners';

/*
 * Writes the partner fixtures' drawn photos and sample IDs to the private bucket (F6 B18). Runs
 * after the seed's transaction, from the seed scripts only. Returns how many files it wrote, or
 * null when storage isn't configured.
 */
export async function writePartnerFixtureImages(
  env: Record<string, string | undefined> = process.env,
): Promise<number | null> {
  const bucket = env.S3_PRIVATE_BUCKET;
  if (!env.S3_ENDPOINT || !bucket) return null;
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const images = partnerFixtureImages();
  await Promise.all(
    images.map(async (image) => {
      const body = await sharp(Buffer.from(fixtureImageSvg(image)))
        .webp({ quality: 82 })
        .toBuffer();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: image.key,
          Body: body,
          ContentType: 'image/webp',
          CacheControl: 'private, no-store',
        }),
      );
    }),
  );
  return images.length;
}
