import { describe, expect, it } from 'vitest';
import { s3ClientConfig } from './s3-config';

describe('s3ClientConfig', () => {
  it('uses the given keys and path-style addressing against a custom endpoint', () => {
    expect(
      s3ClientConfig({
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
      region: 'auto',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    });
  });

  it('falls back to the default credential chain and the AWS endpoint without keys', () => {
    const config = s3ClientConfig({ S3_REGION: 'us-east-1' });
    expect(config.credentials).toBeUndefined();
    expect(config.endpoint).toBeUndefined();
    expect(config.forcePathStyle).toBeUndefined();
    expect(config.region).toBe('us-east-1');
  });

  it('treats empty strings as unset', () => {
    const config = s3ClientConfig({
      S3_ENDPOINT: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      S3_REGION: 'eu-west-1',
    });
    expect(config).toEqual({ region: 'eu-west-1' });
  });

  it('refuses half a key pair', () => {
    expect(() => s3ClientConfig({ S3_ACCESS_KEY_ID: 'key' })).toThrow(/together/);
    expect(() => s3ClientConfig({ S3_SECRET_ACCESS_KEY: 'secret' })).toThrow(/together/);
  });
});
