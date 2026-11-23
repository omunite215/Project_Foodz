import { v7 as uuid } from 'uuid';
import type { PrismaClient } from '@/server/db/generated/client';
import { writeObject } from '@/server/storage/s3';

/*
 * Helpers for the F6 suites: checked uploads ready to attach, and bulk applicants for the long
 * list tests (story A19.7, A19.8). Rows are written by the table owner, the way the seed does.
 */

const WEBP = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'binary');

/** A partner photo or document that has passed the upload check. */
export async function readyUpload(
  migrator: PrismaClient,
  ownerId: string,
  purpose: 'PARTNER_PHOTO' | 'PARTNER_DOCUMENT',
): Promise<string> {
  const id = uuid();
  const key = `${purpose === 'PARTNER_PHOTO' ? 'partner-photo' : 'partner-document'}/${id}.webp`;
  await writeObject('PRIVATE', key, WEBP, {
    contentType: 'image/webp',
    cacheControl: 'private, no-store',
  });
  await migrator.upload.create({
    data: {
      id,
      key,
      bucket: 'PRIVATE',
      purpose,
      status: 'READY',
      ownerId,
      contentType: 'image/webp',
      sizeBytes: WEBP.byteLength,
    },
  });
  return id;
}

/** n sample applicants, "Test Applicant 001" and up, sent over the last 10 days (A19.7). */
export async function seedBulkApplicants(
  migrator: PrismaClient,
  n: number,
  tag = uuid().slice(0, 8),
) {
  const vehicles = ['BICYCLE', 'SCOOTER', 'MOTORBIKE', 'CAR'] as const;
  const now = Date.now();
  const users = Array.from({ length: n }, (_, index) => ({
    id: uuid(),
    name: `Test Applicant ${String(index + 1).padStart(3, '0')}`,
    email: `bulk-${tag}-${index}@test.dev`,
    isSample: true,
    emailVerified: true,
  }));
  await migrator.user.createMany({ data: users });
  await migrator.deliveryPartner.createMany({
    data: users.map((user, index) => {
      const vehicle = vehicles[index % vehicles.length] ?? 'BICYCLE';
      return {
        userId: user.id,
        status: 'APPLIED' as const,
        vehicleType: vehicle,
        vehiclePlate: vehicle === 'BICYCLE' ? null : `BLK ${String(index).padStart(3, '0')}`,
        idDocumentType: 'DRIVER_LICENSE' as const,
        idNumberLast4: String(1000 + (index % 9000)).slice(-4),
        idDocumentExpiresOn: new Date('2030-01-01T00:00:00Z'),
        submittedAt: new Date(now - (index * 10 * 24 * 60 * 60 * 1000) / Math.max(1, n)),
        version: 1,
      };
    }),
  });
  return users.map((user) => user.id);
}
