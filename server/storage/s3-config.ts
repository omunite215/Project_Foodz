import type { S3ClientConfig } from '@aws-sdk/client-s3';

type Env = Record<string, string | undefined>;

/**
 * How the S3 client connects. With access keys set (RustFS locally, or any S3-compatible store)
 * those keys are used with path-style addressing against `S3_ENDPOINT`. With no keys the SDK's
 * default credential chain applies, which on AWS means the ECS task role; `S3_ENDPOINT` is then
 * left out and the regional AWS endpoint is used.
 */
export function s3ClientConfig(env: Env): S3ClientConfig {
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together or not at all');
  }
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  return {
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    region: env.S3_REGION || (endpoint ? 'auto' : undefined),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  };
}
