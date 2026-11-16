import sharp from 'sharp';
import { v7 as uuid } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserActor } from '@/server/auth/session';
import { db } from '@/server/db/client';
import { runAsSystem } from '@/server/db/context';
import { objectSize, readObject } from '@/server/storage/s3';

// The job queue is outside this test: the event is recorded and the job is run directly.
const send = vi.hoisted(() => vi.fn<(event: unknown) => Promise<unknown>>());
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send },
}));

const { confirmUpload, getUpload, processUpload, requestUpload } =
  await import('@/server/modules/uploads/service');

const customer = uuid();
const otherCustomer = uuid();
const asUser = (userId: string, role: UserActor['role'] = 'customer'): UserActor => ({
  kind: 'user',
  userId,
  role,
  isDemo: false,
});

/** A phone photo with GPS coordinates in its EXIF data. */
const photoWithGps = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: '#d3f9d5' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '42/1 20/1 4/1' } })
    .jpeg()
    .toBuffer();

const put = (url: string, body: Buffer, contentType: string) =>
  fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: new Uint8Array(body),
  });

/** Requests an upload URL, uploads the file to it and confirms, like the browser does. */
async function upload(
  actor: UserActor,
  purpose: 'REFUND_PHOTO' | 'MENU_IMAGE',
  body: Buffer,
  contentType = 'image/jpeg',
) {
  const request = await requestUpload(actor, { purpose, contentType, sizeBytes: body.byteLength });
  const response = await put(request.url, body, contentType);
  expect(response.status).toBe(200);
  await confirmUpload(actor, { uploadId: request.uploadId });
  return request.uploadId;
}

beforeAll(async () => {
  await runAsSystem('test setup', (ctx) =>
    db(ctx).user.createMany({
      data: [
        { id: customer, name: 'C', email: `c-${customer}@test.dev` },
        { id: otherCustomer, name: 'O', email: `o-${otherCustomer}@test.dev` },
      ],
    }),
  );
});

beforeEach(() => {
  send.mockReset().mockResolvedValue({ ids: ['evt'] });
});

describe('upload pipeline', () => {
  it('stores a private photo without its GPS data and removes the quarantined original', async () => {
    const original = await photoWithGps();
    const uploadId = await upload(asUser(customer), 'REFUND_PHOTO', original);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'upload.received',
        data: { uploadId },
        id: `upload-${uploadId}`,
      }),
    );
    expect(await processUpload(uploadId)).toBe('ready');

    const row = await runAsSystem('check', (ctx) =>
      db(ctx).upload.findUniqueOrThrow({ where: { id: uploadId } }),
    );
    expect(row).toMatchObject({
      status: 'READY',
      bucket: 'PRIVATE',
      key: `refund-photo/${uploadId}.webp`,
      contentType: 'image/webp',
      width: 800,
      height: 600,
    });

    const stored = await readObject('PRIVATE', row.key, 10 * 1024 * 1024);
    const metadata = await sharp(stored).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(await objectSize('PRIVATE', `quarantine/${uploadId}`)).toBeNull();

    // The owner gets a short-lived link that works; nobody else learns it exists.
    const status = await getUpload(asUser(customer), { uploadId });
    expect(status).toMatchObject({ status: 'READY' });
    expect(status.url).toContain('X-Amz-Signature');
    expect((await fetch(status.url!)).status).toBe(200);
    await expect(getUpload(asUser(otherCustomer), { uploadId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('serves menu photos from the public bucket', async () => {
    const image = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#04b90b' },
    })
      .png()
      .toBuffer();
    const editor = asUser(uuid(), 'content_editor');
    await runAsSystem('editor', (ctx) =>
      db(ctx).user.create({
        data: { id: editor.userId, name: 'E', email: `e-${editor.userId}@test.dev` },
      }),
    );

    const uploadId = await upload(editor, 'MENU_IMAGE', image, 'image/png');
    expect(await processUpload(uploadId)).toBe('ready');

    const status = await getUpload(editor, { uploadId });
    expect(status.url).toBe(`${process.env.S3_PUBLIC_URL}/menu-image/${uploadId}.webp`);
    const row = await runAsSystem('check', (ctx) =>
      db(ctx).upload.findUniqueOrThrow({ where: { id: uploadId }, select: { width: true } }),
    );
    expect(row.width).toBe(2000);
  });

  it('rejects a script disguised as a photo and keeps nothing of it', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"><rect/></svg>',
    );
    const uploadId = await upload(asUser(customer), 'REFUND_PHOTO', svg, 'image/png');

    expect(await processUpload(uploadId)).toBe('rejected');
    expect(await getUpload(asUser(customer), { uploadId })).toEqual({
      uploadId,
      status: 'REJECTED',
      reason: 'Only JPEG, PNG, WebP and AVIF images are accepted.',
    });
    expect(await objectSize('PRIVATE', `quarantine/${uploadId}`)).toBeNull();
    expect(await objectSize('PRIVATE', `refund-photo/${uploadId}.webp`)).toBeNull();
  });

  it('processes each upload once', async () => {
    const uploadId = await upload(asUser(customer), 'REFUND_PHOTO', await photoWithGps());
    expect(await processUpload(uploadId)).toBe('ready');
    expect(await processUpload(uploadId)).toBe('skipped');
    expect(await processUpload(uuid())).toBe('skipped');
  });
});

describe('upload URLs', () => {
  it('refuse a file larger than the one announced', async () => {
    const small = await photoWithGps();
    const request = await requestUpload(asUser(customer), {
      purpose: 'REFUND_PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: small.byteLength,
    });
    const bigger = Buffer.concat([small, Buffer.alloc(1024 * 1024)]);
    expect((await put(request.url, bigger, 'image/jpeg')).ok).toBe(false);
  });

  it('refuse a different content type from the one announced', async () => {
    const photo = await photoWithGps();
    const request = await requestUpload(asUser(customer), {
      purpose: 'REFUND_PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: photo.byteLength,
    });
    expect((await put(request.url, photo, 'text/html')).ok).toBe(false);
  });

  it('are not handed out for files over the purpose limit', async () => {
    await expect(
      requestUpload(asUser(customer), {
        purpose: 'REFUND_PHOTO',
        contentType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow(/Too big/);
  });
});

describe('confirming an upload', () => {
  it('is refused before the file has arrived', async () => {
    const request = await requestUpload(asUser(customer), {
      purpose: 'REFUND_PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    await expect(
      confirmUpload(asUser(customer), { uploadId: request.uploadId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(send).not.toHaveBeenCalled();
  });

  it('is refused for someone else’s upload', async () => {
    const photo = await photoWithGps();
    const request = await requestUpload(asUser(customer), {
      purpose: 'REFUND_PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: photo.byteLength,
    });
    await put(request.url, photo, 'image/jpeg');

    await expect(
      confirmUpload(asUser(otherCustomer), { uploadId: request.uploadId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(send).not.toHaveBeenCalled();
  });
});
